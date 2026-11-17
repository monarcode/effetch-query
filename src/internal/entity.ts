import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";

import type * as Query from "../Query.js";
import { lastSuccess, patchValue, undoAll } from "./cache.js";
import type { Undo } from "./optimistic.js";
import { internals, peek } from "./queryAtom.js";
import { StateAtom } from "./runtime.js";

/**
 * Where an entity sits in a query's value (DESIGN.md §4.13), found once per
 * schema by walking its AST: the decoded side, since a node is the type side
 * and its `encoding` only says how it's reached from the wire.
 */
export type Plan =
	| { readonly _tag: "Entity" }
	| {
			readonly _tag: "Array";
			readonly elements: ReadonlyArray<Plan | undefined>;
			readonly rest: Plan | undefined;
			/** How many elements follow the rest (`[...A[], B]`): not reached. */
			readonly trailing: number;
			/** Every element and the rest are the entity's place (`NonEmptyArray`), so any can go. */
			readonly uniform: boolean;
	  }
	| {
			readonly _tag: "Object";
			readonly fields: ReadonlyArray<Field>;
			/** Every named field's name, which index signatures don't cover. */
			readonly named: ReadonlySet<PropertyKey>;
			readonly indexes: ReadonlyArray<Index>;
	  }
	| {
			readonly _tag: "Union";
			readonly members: ReadonlyArray<Member>;
			/** What a member removed from it becomes: `null` or `undefined`, if the union takes one. */
			readonly empty: Option.Option<null | undefined>;
	  }
	| {
			/** A `Schema.Class` instance, rebuilt with its prototype. */
			readonly _tag: "Class";
			readonly fields: Plan;
	  }
	| {
			/** A node reached again while it's being planned: a recursive schema. */
			readonly _tag: "Lazy";
			readonly cell: { plan: Plan | undefined };
	  };

interface Field {
	readonly name: PropertyKey;
	readonly plan: Plan;
	readonly optional: boolean;
}

interface Index {
	readonly accepts: (key: string) => boolean;
	readonly plan: Plan | undefined;
}

interface Member {
	readonly is: (value: unknown) => boolean;
	readonly plan: Plan;
}

/** What `f` returns to drop an entity where its place allows it. */
export const Remove: unique symbol = Symbol(
	"@monarcode/effetch-query/Entity/Remove",
);

/**
 * The same node, or a copy that only changed how it's annotated, checked,
 * encoded or keyed (`annotate`, `check`, `optionalKey`). Effect's own check
 * for this is internal, so it compares the nodes' own keys.
 */
const sameNode = (ast: SchemaAST.AST, other: SchemaAST.AST): boolean => {
	if (ast === other) {
		return true;
	}
	if (Object.getPrototypeOf(ast) !== Object.getPrototypeOf(other)) {
		return false;
	}
	const copy = ast as unknown as Record<PropertyKey, unknown>;
	const original = other as unknown as Record<PropertyKey, unknown>;
	const keys = new Set([
		...Reflect.ownKeys(copy),
		...Reflect.ownKeys(original),
	]);
	for (const key of keys) {
		if (
			key !== "context" &&
			key !== "encoding" &&
			key !== "annotations" &&
			key !== "checks" &&
			copy[key] !== original[key]
		) {
			return false;
		}
	}
	return true;
};

/**
 * A `Schema.Class`'s fields: it's a declaration that decodes from its only
 * type parameter, a struct. `Option`, `Map` and other declarations have no
 * encoding, so what they hold isn't reached.
 */
const classFields = (ast: SchemaAST.Declaration): SchemaAST.AST | undefined => {
	const [fields] = ast.typeParameters;
	const from = ast.encoding?.[ast.encoding.length - 1]?.to;
	return ast.typeParameters.length === 1 &&
		fields !== undefined &&
		SchemaAST.isObjects(fields) &&
		from !== undefined &&
		sameNode(from, fields)
		? fields
		: undefined;
};

const children = (ast: SchemaAST.AST): ReadonlyArray<SchemaAST.AST> => {
	switch (ast._tag) {
		case "Arrays":
			return [...ast.elements, ...ast.rest.slice(0, 1)];
		case "Objects":
			return [
				...ast.propertySignatures.map((field) => field.type),
				...ast.indexSignatures.map((index) => index.type),
			];
		case "Union":
			return ast.types;
		case "Suspend":
			return [ast.thunk()];
		case "Declaration": {
			const fields = classFields(ast);
			return fields === undefined ? [] : [fields];
		}
		default:
			return [];
	}
};

/** The nodes from which the entity can be reached. */
const reaching = (
	root: SchemaAST.AST,
	entity: SchemaAST.AST,
): ReadonlySet<SchemaAST.AST> => {
	const parents = new Map<SchemaAST.AST, Array<SchemaAST.AST>>();
	const seen = new Set<SchemaAST.AST>();
	const found: Array<SchemaAST.AST> = [];
	const pending = [root];
	for (let ast = pending.pop(); ast !== undefined; ast = pending.pop()) {
		if (seen.has(ast)) {
			continue;
		}
		seen.add(ast);
		if (sameNode(ast, entity)) {
			found.push(ast);
			continue;
		}
		for (const child of children(ast)) {
			const known = parents.get(child);
			if (known === undefined) {
				parents.set(child, [ast]);
			} else {
				known.push(ast);
			}
			pending.push(child);
		}
	}
	const reached = new Set(found);
	for (let ast = found.pop(); ast !== undefined; ast = found.pop()) {
		for (const parent of parents.get(ast) ?? []) {
			if (!reached.has(parent)) {
				reached.add(parent);
				found.push(parent);
			}
		}
	}
	return reached;
};

const primitives = new Set<SchemaAST.AST["_tag"]>([
	"Null",
	"Undefined",
	"Void",
	"String",
	"Number",
	"Boolean",
	"BigInt",
	"Symbol",
	"Literal",
	"UniqueSymbol",
	"Enum",
	"TemplateLiteral",
]);

const guard = (ast: SchemaAST.AST): ((value: unknown) => boolean) => {
	const is = Schema.is(Schema.make(ast));
	return (value) => {
		try {
			return is(value);
		} catch {
			// A guard that needs a service, or runs asynchronously: the value
			// is left as it is.
			return false;
		}
	};
};

/** Which own string keys an index signature's parameter takes. */
const acceptsKey = (parameter: SchemaAST.AST): ((key: string) => boolean) => {
	if (parameter.checks === undefined) {
		switch (parameter._tag) {
			case "String":
				return () => true;
			case "Number":
				return (key) => key.trim() !== "" && !Number.isNaN(Number(key));
			case "Symbol":
				return () => false;
		}
	}
	return guard(parameter);
};

/** The entity's places in a schema, or `undefined` if it holds none. */
export const findPlan = (
	root: SchemaAST.AST,
	entity: SchemaAST.AST,
): Plan | undefined => {
	const reached = reaching(root, entity);
	const planned = new Map<SchemaAST.AST, { plan: Plan | undefined }>();
	const plan = (ast: SchemaAST.AST): Plan | undefined => {
		if (!reached.has(ast)) {
			return undefined;
		}
		if (sameNode(ast, entity)) {
			return { _tag: "Entity" };
		}
		const known = planned.get(ast);
		if (known !== undefined) {
			return known.plan ?? { _tag: "Lazy", cell: known };
		}
		const cell: { plan: Plan | undefined } = { plan: undefined };
		planned.set(ast, cell);
		cell.plan = build(ast);
		return cell.plan;
	};
	const build = (ast: SchemaAST.AST): Plan | undefined => {
		switch (ast._tag) {
			case "Arrays": {
				const [rest] = ast.rest;
				return {
					_tag: "Array",
					elements: ast.elements.map(plan),
					rest: rest === undefined ? undefined : plan(rest),
					trailing: Math.max(0, ast.rest.length - 1),
					uniform:
						rest !== undefined &&
						ast.rest.length === 1 &&
						ast.elements.every((element) => sameNode(element, rest)),
				};
			}
			case "Objects":
				return {
					_tag: "Object",
					fields: ast.propertySignatures.flatMap((field) => {
						const fieldPlan = plan(field.type);
						return fieldPlan === undefined
							? []
							: [
									{
										name: field.name,
										plan: fieldPlan,
										optional: SchemaAST.isOptional(field.type),
									},
								];
					}),
					named: new Set(
						ast.propertySignatures.map((field) => field.name),
					),
					indexes: ast.indexSignatures.map((index) => ({
						accepts: acceptsKey(index.parameter),
						plan: plan(index.type),
					})),
				};
			case "Union": {
				const holding = ast.types.filter((member) => reached.has(member));
				// The usual `Todo | null`: anything that's an object is the member.
				const onlyObjects =
					holding.length === 1 &&
					ast.types.every(
						(member) =>
							reached.has(member) || primitives.has(member._tag),
					);
				return {
					_tag: "Union",
					members: holding.flatMap((member) => {
						const memberPlan = plan(member);
						return memberPlan === undefined
							? []
							: [
									{
										is: onlyObjects
											? Predicate.isObjectOrArray
											: guard(member),
										plan: memberPlan,
									},
								];
					}),
					empty: ast.types.some(SchemaAST.isNull)
						? Option.some(null)
						: ast.types.some(SchemaAST.isUndefined)
							? Option.some(undefined)
							: Option.none(),
				};
			}
			case "Suspend":
				return plan(ast.thunk());
			case "Declaration": {
				const fields = classFields(ast);
				const fieldsPlan = fields === undefined ? undefined : plan(fields);
				return fieldsPlan === undefined
					? undefined
					: { _tag: "Class", fields: fieldsPlan };
			}
			default:
				return undefined;
		}
	};
	return plan(root);
};

/**
 * The value with `f` applied to each entity the plan reaches, the same
 * object where nothing changed. `f` gets only objects, and returns
 * {@link Remove} to drop an entity: from an array (keeping a tuple's fixed
 * elements and a non-empty array's last item) or a record, from an optional
 * field, or to `null` or `undefined` in a union that takes one. Elsewhere it
 * stays, and a whole value that is the entity comes back as `Remove`.
 */
export const applyPlan = (
	plan: Plan,
	value: unknown,
	f: (entity: object) => unknown,
): unknown => {
	switch (plan._tag) {
		case "Entity":
			return Predicate.isObjectKeyword(value)
				? keepClass(value, f(value))
				: value;
		case "Lazy":
			return plan.cell.plan === undefined
				? value
				: applyPlan(plan.cell.plan, value, f);
		case "Array":
			return Array.isArray(value) ? applyArray(plan, value, f) : value;
		case "Object":
			return Predicate.isObject(value) ? applyObject(plan, value, f) : value;
		case "Class":
			return Predicate.isObject(value) ? applyClass(plan, value, f) : value;
		case "Union": {
			const member = plan.members.find((member) => member.is(value));
			if (member === undefined) {
				return value;
			}
			const next = applyPlan(member.plan, value, f);
			return next === Remove && Option.isSome(plan.empty)
				? plan.empty.value
				: next;
		}
	}
};

const applyArray = (
	plan: Extract<Plan, { _tag: "Array" }>,
	value: ReadonlyArray<unknown>,
	f: (entity: object) => unknown,
): ReadonlyArray<unknown> => {
	let next: Array<unknown> | undefined;
	const removed = new Set<number>();
	const end = value.length - plan.trailing;
	value.forEach((item, i) => {
		const element = i < plan.elements.length;
		const itemPlan = element ? plan.elements[i] : plan.rest;
		if (itemPlan === undefined || i >= end) {
			return;
		}
		const updated = applyPlan(itemPlan, item, f);
		if (updated === Remove) {
			// A tuple's element can't go: the elements after it would move
			// into places of another type.
			if (!element || plan.uniform) {
				removed.add(i);
			}
		} else if (updated !== item) {
			(next ??= value.slice())[i] = updated;
		}
	});
	const out = next ?? value;
	// Dropping below a non-empty array's length would break its schema.
	return removed.size === 0 || out.length - removed.size < plan.elements.length
		? out
		: out.filter((_, i) => !removed.has(i));
};

const applyObject = (
	plan: Extract<Plan, { _tag: "Object" }>,
	value: object,
	f: (entity: object) => unknown,
): object => {
	const record = value as Record<PropertyKey, unknown>;
	let next: Record<PropertyKey, unknown> | undefined;
	const write = (name: PropertyKey, updated: unknown, removable: boolean) => {
		if (updated === Remove) {
			if (removable) {
				next ??= { ...record };
				delete next[name];
			}
		} else if (updated !== record[name]) {
			next ??= { ...record };
			next[name] = updated;
		}
	};
	for (const field of plan.fields) {
		if (field.name in record) {
			write(
				field.name,
				applyPlan(field.plan, record[field.name], f),
				field.optional,
			);
		}
	}
	if (plan.indexes.some((index) => index.plan !== undefined)) {
		for (const key of Object.keys(record)) {
			if (plan.named.has(key)) {
				continue;
			}
			const index = plan.indexes.find((index) => index.accepts(key));
			if (index?.plan !== undefined) {
				write(key, applyPlan(index.plan, record[key], f), true);
			}
		}
	}
	return next ?? value;
};

const applyClass = (
	plan: Extract<Plan, { _tag: "Class" }>,
	value: object,
	f: (entity: object) => unknown,
): unknown => {
	// A class over the entity's own struct is the entity: `f` gets the
	// instance itself.
	return keepClass(
		value,
		plan.fields._tag === "Entity"
			? f(value)
			: applyPlan(plan.fields, { ...value }, f),
	);
};

/**
 * `next` with `value`'s class, when `value` is an instance and `next` a
 * plain copy, such as an updater's `{ ...todo, title }`: the class's codec
 * encodes only instances, and its methods would be gone. A copy with the
 * same fields gives back `value` itself.
 */
const keepClass = (value: object, next: unknown): unknown => {
	if (next === Remove || next === value || !Predicate.isObject(next)) {
		return next;
	}
	const prototype: unknown = Object.getPrototypeOf(value);
	if (
		prototype === Object.prototype ||
		prototype === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(next) === prototype
	) {
		return next;
	}
	const names = Object.keys(next);
	return names.length === Object.keys(value).length &&
		names.every(
			(name) =>
				(next as Record<string, unknown>)[name] ===
				(value as Record<string, unknown>)[name],
		)
		? value
		: Object.assign(Object.create(prototype as object), next);
};

/** What a definition needs from an entity: its schema's AST, its id and where it was found. */
export interface EntityDefinition<A, Id> {
	readonly ast: SchemaAST.AST;
	readonly id: (value: A) => Id;
	/** The plan per query schema, `null` for one without the entity. */
	readonly plans: WeakMap<SchemaAST.AST, Plan | null>;
}

const planIn = (
	entity: EntityDefinition<any, any>,
	query: Query.Query<any, any>,
): Plan | undefined => {
	const schema = internals(query).hydration?.codec.success;
	if (schema === undefined) {
		return undefined;
	}
	let plan = entity.plans.get(schema.ast);
	if (plan === undefined) {
		plan = findPlan(schema.ast, entity.ast) ?? null;
		entity.plans.set(schema.ast, plan);
	}
	return plan ?? undefined;
};

/**
 * Each cached query that holds the entity, with its last success, when that
 * was fetched or written, and whether the query shows a failure over it.
 */
const holding = (
	registry: AtomRegistry.AtomRegistry,
	entity: EntityDefinition<any, any>,
): ReadonlyArray<{
	readonly query: Query.Query<any, any>;
	readonly plan: Plan;
	readonly value: unknown;
	readonly timestamp: number;
	readonly failed: boolean;
}> =>
	Array.from(registry.get(StateAtom).index).flatMap((query) => {
		const plan = planIn(entity, query);
		const current =
			plan === undefined ? Option.none() : peek(registry, query);
		const success = Option.flatMap(current, lastSuccess);
		return plan === undefined || Option.isNone(success)
			? []
			: [
					{
						query,
						plan,
						value: success.value.value,
						timestamp: success.value.timestamp,
						failed: Option.exists(current, AsyncResult.isFailure),
					},
				];
	});

/**
 * Writes `f` over every cached copy of the entity whose id is `id`, with
 * {@link patchValue}: a query keeps its timestamp, and one that's
 * invalidated, not cached or failed isn't written: a write would hide its
 * failure, and it fetches when next used. Every value is computed before
 * any is written, so an `f` or `id` that throws writes nothing. Queries
 * whose value doesn't change aren't written. Returns one undo for them all.
 */
export const writeEntity = <A, Id>(
	registry: AtomRegistry.AtomRegistry,
	entity: EntityDefinition<A, Id>,
	id: Id,
	f: (value: A) => A | typeof Remove,
): Undo | undefined => {
	const each = (copy: object) =>
		Equal.equals(entity.id(copy as A), id) ? f(copy as A) : copy;
	const writes = holding(registry, entity).flatMap(
		({ query, plan, value, timestamp, failed }) => {
			if (failed) {
				return [];
			}
			const next = applyPlan(plan, value, each);
			return next === value || next === Remove
				? []
				: [{ query, next, timestamp }];
		},
	);
	return undoAll(
		writes.flatMap(({ query, next, timestamp }) => {
			const undo = patchValue(registry, query, next, timestamp);
			return undo === undefined ? [] : [undo];
		}),
	);
};

/** The cached copy of the entity whose id is `id` from the query fetched or written last. */
export const findEntity = <A, Id>(
	registry: AtomRegistry.AtomRegistry,
	entity: EntityDefinition<A, Id>,
	id: Id,
): Option.Option<A> => {
	let newest: { readonly value: A; readonly timestamp: number } | undefined;
	for (const { plan, value, timestamp } of holding(registry, entity)) {
		applyPlan(plan, value, (copy) => {
			if (
				Equal.equals(entity.id(copy as A), id) &&
				(newest === undefined || timestamp > newest.timestamp)
			) {
				newest = { value: copy as A, timestamp };
			}
			return copy;
		});
	}
	return newest === undefined ? Option.none() : Option.some(newest.value);
};

/** The property that marks an entity, which holds its {@link EntityDefinition}. */
export const EntityTypeId = "~@monarcode/effetch-query/Entity" as const;
export type EntityTypeId = typeof EntityTypeId;

export const definition = <A, Id>(entity: object): EntityDefinition<A, Id> =>
	(entity as Record<EntityTypeId, EntityDefinition<A, Id>>)[EntityTypeId];
