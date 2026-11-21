import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import type * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Query from "../Query.js";
import { ageOf, isFetched, now, stampCopies, stampQuery } from "./ages.js";
import {
	applyPlan,
	type EntityDefinition,
	holding,
	type Plan,
	planIn,
} from "./entity.js";
import { dropSyncs, recordPush } from "./live.js";
import {
	cachedQuery,
	internals,
	isCurrent,
	lastSuccess,
	localValue,
	peek,
	syncsEntities,
	writeKeepingAge,
} from "./queryAtom.js";
import {
	type ClientState,
	ConfigAtom,
	type StampWritten,
	StateAtom,
	type SyncFetched,
} from "./runtime.js";

interface Copy {
	readonly copy: object;
	readonly age: number;
}

type Holding = ReturnType<typeof holding>[number];

/** One synced entity in the fetched query, with the other queries that hold it. */
interface Pass {
	readonly entity: EntityDefinition<any, any>;
	readonly plan: Plan;
	readonly others: ReadonlyArray<Holding>;
	/** Each id's copy and age in the fetched value, once newer copies are pulled in. */
	readonly mine: MutableHashMap.MutableHashMap<unknown, Copy>;
	readonly pulled: MutableHashMap.MutableHashMap<unknown, Copy>;
}

/** A sync's write over another query, made once every write is computed. */
interface Write {
	readonly entity: EntityDefinition<any, any>;
	readonly query: Query.Query<any, any>;
	/**
	 * Puts the newer copies into a value: the query's when it's written, so
	 * two entities' writes to one query both stay, and the one an undo puts
	 * back (`live.ts`). `undefined` when every copy was already equal.
	 */
	readonly apply: ((value: unknown) => unknown) | undefined;
	/** The ages of the copies it dates, written or equal. */
	readonly ages: ReadonlyArray<readonly [unknown, number]>;
}

/** Calls `f` with each copy a plan reaches in a value, without changing it. */
const eachCopy = (
	plan: Plan,
	value: unknown,
	f: (copy: object) => void,
): void => {
	applyPlan(plan, value, (copy) => {
		f(copy);
		return copy;
	});
};

/** Keeps the newer of two copies of an id. */
const keepNewer = (
	copies: MutableHashMap.MutableHashMap<unknown, Copy>,
	id: unknown,
	copy: Copy,
): void => {
	const known = MutableHashMap.get(copies, id);
	if (Option.isNone(known) || known.value.age < copy.age) {
		MutableHashMap.set(copies, id, copy);
	}
};

/**
 * The queries the fetch read through `ctx.result`, and theirs: a sync
 * doesn't write them, or the fetch would start again.
 */
const dependencies = (
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<unknown>,
): ReadonlySet<Query.Query<any, any>> => {
	const found = new Set<Query.Query<any, any>>();
	const seen = new Set<unknown>();
	const pending = [...(registry.getNodes().get(atom)?.parents ?? [])];
	for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
		if (seen.has(node)) {
			continue;
		}
		seen.add(node);
		const query = cachedQuery(node.atom);
		if (query !== undefined) {
			found.add(query);
		}
		pending.push(...node.parents);
	}
	return found;
};

/**
 * Dates each copy of the entity in the fetched value and pulls newer
 * copies into it. A copy is dated by the fetch's start, unless it isn't
 * new: one the query already showed (an infinite query's older pages)
 * keeps its age, and one another query holds (read through `ctx.result`)
 * takes that query's. Only fetched copies are pulled: from other queries,
 * and the query's own, synced in while it fetched.
 */
const pull = <A>(
	registry: AtomRegistry.AtomRegistry,
	state: ClientState,
	query: Query.Query<A, any>,
	entity: EntityDefinition<any, any>,
	plan: Plan,
	value: A,
	start: number,
): { readonly value: A; readonly pass: Pass } => {
	const shown = Option.flatMap(peek(registry, query), lastSuccess);
	const carried = new Set<object>();
	const newest = MutableHashMap.empty<unknown, Copy>();
	Option.map(shown, (success) =>
		eachCopy(plan, success.value, (copy) => {
			carried.add(copy);
			const id = entity.id(copy);
			const age = ageOf(state, query, entity, id);
			if (isFetched(age) && age > start) {
				keepNewer(newest, id, { copy, age });
			}
		}),
	);
	const mine = MutableHashMap.empty<unknown, Copy>();
	eachCopy(plan, value, (copy) => {
		const id = entity.id(copy);
		keepNewer(mine, id, {
			copy,
			age: carried.has(copy) ? ageOf(state, query, entity, id) : start,
		});
	});
	const others = holding(registry, entity).filter(
		(other) =>
			other.query !== query &&
			!other.failed &&
			syncsEntities(registry, other.query) &&
			isCurrent(registry, other.query),
	);
	const borrowed = MutableHashMap.empty<unknown, number>();
	for (const other of others) {
		eachCopy(other.plan, other.value, (copy) => {
			const id = entity.id(copy);
			const own = MutableHashMap.get(mine, id);
			if (Option.isNone(own)) {
				return;
			}
			const age = ageOf(state, other.query, entity, id);
			if (own.value.copy === copy && !carried.has(copy)) {
				MutableHashMap.set(borrowed, id, age);
			}
			if (isFetched(age)) {
				keepNewer(newest, id, { copy, age });
			}
		});
	}
	for (const [id, age] of borrowed) {
		const own = Option.getOrThrow(MutableHashMap.get(mine, id));
		MutableHashMap.set(mine, id, { copy: own.copy, age });
	}
	const pulled = MutableHashMap.empty<unknown, Copy>();
	for (const [id, other] of newest) {
		const own = MutableHashMap.get(mine, id);
		if (Option.isSome(own) && other.age > own.value.age) {
			MutableHashMap.set(pulled, id, other);
			MutableHashMap.set(mine, id, other);
		}
	}
	const next =
		MutableHashMap.size(pulled) === 0
			? value
			: (applyPlan(plan, value, (copy) =>
					Option.match(MutableHashMap.get(pulled, entity.id(copy)), {
						onNone: () => copy,
						onSome: ({ copy: newer }) =>
							Equal.equals(copy, newer) ? copy : newer,
					}),
				) as A);
	return { value: next, pass: { entity, plan, others, mine, pulled } };
};

/**
 * The writes of the fetched copies over older copies in other queries,
 * from the value with every entity's newer copies pulled in. Only fetched
 * copies go, not pulled ones, and a query the fetch depends on isn't
 * written.
 */
const push = (
	state: ClientState,
	pass: Pass,
	value: unknown,
	skip: ReadonlySet<Query.Query<any, any>>,
): ReadonlyArray<Write> => {
	const { entity, plan, others, mine, pulled } = pass;
	// A copy another entity's pull rebuilt (an outer copy with a newer
	// inner one) is written as rebuilt.
	const kept = new Set<object>();
	const latest = MutableHashMap.empty<unknown, object>();
	eachCopy(plan, value, (copy) => {
		kept.add(copy);
		MutableHashMap.set(latest, entity.id(copy), copy);
	});
	return others.flatMap((other): ReadonlyArray<Write> => {
		if (skip.has(other.query)) {
			return [];
		}
		const ages: Array<readonly [unknown, number]> = [];
		const changed = MutableHashMap.empty<unknown, object>();
		eachCopy(other.plan, other.value, (copy) => {
			const id = entity.id(copy);
			const own = MutableHashMap.get(mine, id);
			if (
				Option.isNone(own) ||
				!isFetched(own.value.age) ||
				MutableHashMap.has(pulled, id) ||
				own.value.age <= ageOf(state, other.query, entity, id)
			) {
				return;
			}
			const newer = kept.has(own.value.copy)
				? own.value.copy
				: Option.getOrElse(
						MutableHashMap.get(latest, id),
						() => own.value.copy,
					);
			ages.push([id, own.value.age]);
			if (!Equal.equals(copy, newer)) {
				MutableHashMap.set(changed, id, newer);
			}
		});
		if (ages.length === 0) {
			return [];
		}
		return [
			{
				entity,
				query: other.query,
				apply:
					MutableHashMap.size(changed) === 0
						? undefined
						: (current) =>
								applyPlan(other.plan, current, (copy) =>
									Option.getOrElse(
										MutableHashMap.get(changed, entity.id(copy)),
										() => copy,
									),
								),
				ages,
			},
		];
	});
};

/**
 * Entity sync after a successful fetch (DESIGN.md §4.15), for the client's
 * `entities.sync`. Every write is computed before any is made, so an `id`
 * that throws writes nothing. A throw is logged, and the fetch keeps its
 * value. A fetch of a generation the query has left (a `reset` or `clear`
 * since) syncs nothing: its value isn't shown.
 */
export const syncFetched: SyncFetched = (registry, query, value, fetch) =>
	Effect.suspend(() => {
		if (
			!syncsEntities(registry, query) ||
			localValue(registry, query).generation !== fetch.generation
		) {
			return Effect.succeed(value);
		}
		const state = registry.get(StateAtom);
		let synced = value;
		const passes: Array<Pass> = [];
		const writes: Array<Write> = [];
		try {
			for (const entity of registry.get(ConfigAtom).entities) {
				const plan = planIn(entity, query);
				if (plan !== undefined) {
					const pulled = pull(
						registry,
						state,
						query,
						entity,
						plan,
						synced,
						fetch.start,
					);
					synced = pulled.value;
					passes.push(pulled.pass);
				}
			}
			const skip = dependencies(
				registry,
				internals(query).fetchAtom(fetch.generation),
			);
			for (const pass of passes) {
				writes.push(...push(state, pass, synced, skip));
			}
		} catch (cause) {
			stampQuery(state, query, fetch.start);
			return Effect.as(Effect.logError("Entity sync failed", cause), value);
		}
		stampQuery(state, query, fetch.start);
		for (const { entity, mine } of passes) {
			for (const [id, { age }] of mine) {
				if (age !== fetch.start) {
					stampCopies(state, query, [[entity, id]], age);
				}
			}
		}
		// The fetched value is dated after them, so an undo mustn't apply them.
		dropSyncs(state, query);
		try {
			for (const { entity, query: other, apply, ages } of writes) {
				for (const [id, age] of ages) {
					stampCopies(state, other, [[entity, id]], age);
				}
				const current = Option.flatMap(peek(registry, other), lastSuccess);
				if (apply === undefined || Option.isNone(current)) {
					continue;
				}
				const next = apply(current.value.value);
				if (next !== current.value.value) {
					writeKeepingAge(registry, other, next, current.value.timestamp);
					recordPush(state, other, apply, true);
				}
			}
		} catch (cause) {
			return Effect.as(Effect.logError("Entity sync failed", cause), synced);
		}
		return Effect.succeed(synced);
	});

/**
 * Dates as new the synced entities' copies a write put in a query: those
 * that aren't the same objects it showed before (DESIGN.md §4.15).
 */
export const stampWritten: StampWritten = (registry, query, before, after) => {
	if (!syncsEntities(registry, query)) {
		return () => {};
	}
	const state = registry.get(StateAtom);
	const restores = registry.get(ConfigAtom).entities.flatMap((entity) => {
		const plan = planIn(entity, query);
		if (plan === undefined) {
			return [];
		}
		const old = new Set<object>();
		Option.map(before, (value) =>
			eachCopy(plan, value, (copy) => old.add(copy)),
		);
		const written: Array<readonly [object, unknown]> = [];
		eachCopy(plan, after, (copy) => {
			if (!old.has(copy)) {
				written.push([entity, entity.id(copy)]);
			}
		});
		return written.length === 0
			? []
			: [stampCopies(state, query, written, now(state))];
	});
	return () => {
		for (const restore of restores) {
			restore();
		}
	};
};
