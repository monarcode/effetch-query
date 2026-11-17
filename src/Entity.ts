import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type * as Schema from "effect/Schema";
import type * as Types from "effect/Types";

import * as internal from "./internal/entity.js";
import * as optimistic from "./internal/optimistic.js";
import * as QueryClient from "./QueryClient.js";

/**
 * The type of {@link TypeId}, the property that marks an {@link Entity}.
 *
 * @example
 * ```ts
 * import { Entity } from "@monarcode/effetch-query";
 *
 * export const id: Entity.TypeId = Entity.TypeId;
 * ```
 *
 * @since 0.1.0
 */
export type TypeId = internal.EntityTypeId;

/**
 * The property that marks an {@link Entity}.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema";
 *
 * import { Entity } from "@monarcode/effetch-query";
 *
 * const Todo = Schema.Struct({ id: Schema.Finite });
 * const Todos = Entity.make(Todo, { id: (todo) => todo.id });
 *
 * console.log(Entity.TypeId in Todos); // true
 * ```
 *
 * @see {@link isEntity} to check a value
 *
 * @since 0.1.0
 */
export const TypeId: TypeId = internal.EntityTypeId;

/**
 * Checks whether a value is an {@link Entity}. Its value and id types can't
 * be known from the value, so it narrows to `Entity<unknown, unknown>`.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema";
 *
 * import { Entity } from "@monarcode/effetch-query";
 *
 * const Todos = Entity.make(Schema.Struct({ id: Schema.Finite }), {
 *   id: (todo) => todo.id,
 * });
 *
 * console.log(Entity.isEntity(Todos)); // true
 * console.log(Entity.isEntity({ id: 1 })); // false
 * ```
 *
 * @since 0.1.0
 */
export const isEntity = (value: unknown): value is Entity<unknown, unknown> =>
	Predicate.hasProperty(value, TypeId);

/**
 * A record that many queries hold, such as a todo that's in a list, in a
 * page of a search and in its own detail query, made with {@link make}.
 * {@link update}, {@link set} and {@link remove} write it in every cached
 * query whose schema holds it, and {@link get} reads it from any of them.
 *
 * Nothing is normalized: each query keeps its own value, and an entity
 * write maps it, as `Query.update` does.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema";
 *
 * import { Entity } from "@monarcode/effetch-query";
 *
 * const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });
 *
 * export const Todos: Entity.Entity<typeof Todo.Type, number> = Entity.make(
 *   Todo,
 *   { id: (todo) => todo.id },
 * );
 * ```
 *
 * @since 0.1.0
 */
export interface Entity<A, Id> {
	/** Marks an entity, and carries its types. */
	readonly [TypeId]: {
		readonly _A: Types.Invariant<A>;
		readonly _Id: Types.Covariant<Id>;
	};
	/** The entity's schema, which queries' schemas are searched for. */
	readonly schema: Schema.Schema<A>;
	/** Gets an entity's id, which {@link update}, {@link remove} and {@link get} match with `Equal.equals`. */
	readonly id: (value: A) => Id;
}

/**
 * Options for {@link make}.
 *
 * @example
 * ```ts
 * import type { Entity } from "@monarcode/effetch-query";
 *
 * interface Todo {
 *   readonly id: number;
 *   readonly title: string;
 * }
 *
 * export const options: Entity.MakeOptions<Todo, number> = {
 *   id: (todo) => todo.id,
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface MakeOptions<A, Id> {
	/**
	 * Gets an entity's id. Ids are compared with `Equal.equals`, so a number
	 * doesn't match the same digits as a string: convert route params, such
	 * as `Number(params.id)`, before passing them.
	 */
	readonly id: (value: A) => Id;
}

/**
 * Defines an entity: a schema, and how to get one's id. Define it once,
 * beside the schema, and use that same schema in your queries: a query is
 * searched for the schema itself (or a copy with annotations or checks
 * added), not for another schema with the same fields.
 *
 * A query is reached through its `schema` (`Query.MakeOptions.schema`), or
 * an Effetch endpoint's `output`; a query without one is skipped. The
 * entity is found in arrays, tuples, records, struct fields (optional and
 * `NullOr` ones too), unions, nested and recursive (`Schema.suspend`)
 * schemas, `Schema.Class` instances, infinite queries' pages, and the
 * decoded side of schemas that transform. It isn't found inside `Option`,
 * `Map` or other declarations, nor after a tuple's rest element, nor inside
 * another copy of itself. A value hydrated from the server is reached once
 * a query reads it: until then it's JSON with no schema to search.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema";
 *
 * import { Entity } from "@monarcode/effetch-query";
 *
 * export class Todo extends Schema.Class<Todo>("Todo")({
 *   id: Schema.Finite,
 *   title: Schema.String,
 *   done: Schema.Boolean,
 * }) {}
 *
 * export const Todos = Entity.make(Todo, { id: (todo) => todo.id });
 * ```
 *
 * @see {@link update} to write it everywhere it's cached
 *
 * @since 0.1.0
 */
export const make = <A, Id>(
	schema: Schema.Schema<A>,
	options: MakeOptions<A, Id>,
): Entity<A, Id> => {
	const definition: internal.EntityDefinition<A, Id> = {
		ast: schema.ast,
		id: options.id,
		plans: new WeakMap(),
	};
	return {
		// The types are only for the compiler: at run time the property holds
		// what the walk needs.
		[TypeId]: definition as unknown as Entity<A, Id>[TypeId],
		schema,
		id: options.id,
	};
};

/**
 * Writes a value computed from the entity whose id is `id` into every
 * cached query that holds it: each list, each loaded page, its detail
 * query. A failed run puts every one back when it's written in a mutation's
 * `optimistic`, as `Query.update`'s writes are. Unlike `Query.update`, a
 * query keeps its age: the write doesn't make it fresh, and a query that's
 * invalidated, or has no value or no schema, is left alone, since it
 * fetches when next used. A query whose value doesn't change isn't written.
 * If `f` throws, nothing is written.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import * as Schema from "effect/Schema";
 *
 * import { Entity, Mutation } from "@monarcode/effetch-query";
 *
 * const Todo = Schema.Struct({
 *   id: Schema.Finite,
 *   title: Schema.String,
 *   done: Schema.Boolean,
 * });
 * const Todos = Entity.make(Todo, { id: (todo) => todo.id });
 *
 * declare const saveDone: (id: number) => Effect.Effect<void>;
 *
 * export const markDone = Mutation.make({
 *   run: saveDone,
 *   // Every cached copy shows it done at once, and goes back if saving fails.
 *   optimistic: (id: number) =>
 *     Entity.update(Todos, id, (todo) => ({ ...todo, done: true })),
 * });
 * ```
 *
 * @see {@link set} to write a whole entity, such as a mutation's result
 * @see {@link make} for where an entity is found
 *
 * @since 0.1.0
 */
export const update = <A, Id>(
	entity: Entity<A, Id>,
	id: NoInfer<Id>,
	f: (value: A) => A,
): Effect.Effect<void, never, QueryClient.QueryClient> =>
	optimistic.write((registry) =>
		internal.writeEntity(registry, internal.definition(entity), id, f),
	);

/**
 * Writes an entity over every cached copy with the same id, as
 * {@link update} does: use it with a mutation's result, in `onSuccess`. It
 * only replaces copies: a list that doesn't hold the entity yet doesn't get
 * it, so invalidate lists it should join.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import * as Schema from "effect/Schema";
 *
 * import { Entity, Mutation } from "@monarcode/effetch-query";
 *
 * const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });
 * type Todo = typeof Todo.Type;
 * const Todos = Entity.make(Todo, { id: (todo) => todo.id });
 *
 * declare const rename: (todo: Todo) => Effect.Effect<Todo>;
 *
 * export const renameTodo = Mutation.make({
 *   run: rename,
 *   // The server's copy, everywhere the todo is cached.
 *   onSuccess: (saved) => Entity.set(Todos, saved),
 * });
 * ```
 *
 * @since 0.1.0
 */
export const set = <A, Id>(
	entity: Entity<A, Id>,
	value: NoInfer<A>,
): Effect.Effect<void, never, QueryClient.QueryClient> =>
	update(entity, entity.id(value), () => value);

/**
 * Drops the entity whose id is `id` from every cached query that holds it,
 * as {@link update} writes: from arrays and records, from an `optionalKey`
 * field, which loses its key, and from a field that takes `null` or
 * `undefined` (`NullOr`, `optional`), which becomes that. Where the schema
 * has no way to leave it out, such as a required field, a tuple's element,
 * a non-empty array's last item or a detail query's whole value, it stays.
 * Totals aren't changed, so invalidate the lists too, and have an infinite
 * query's `nextPageParam` count from the page's params, not its length.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import * as Schema from "effect/Schema";
 *
 * import { Entity, Mutation } from "@monarcode/effetch-query";
 *
 * const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });
 * const Todos = Entity.make(Todo, { id: (todo) => todo.id });
 *
 * declare const deleteTodo: (id: number) => Effect.Effect<void>;
 *
 * export const removeTodo = Mutation.make({
 *   run: deleteTodo,
 *   optimistic: (id: number) => Entity.remove(Todos, id),
 *   // Counts and pages are refetched.
 *   invalidates: [["todos"]],
 * });
 * ```
 *
 * @since 0.1.0
 */
export const remove = <A, Id>(
	entity: Entity<A, Id>,
	id: NoInfer<Id>,
): Effect.Effect<void, never, QueryClient.QueryClient> =>
	optimistic.write((registry) =>
		internal.writeEntity(
			registry,
			internal.definition(entity),
			id,
			() => internal.Remove,
		),
	);

/**
 * Reads the entity whose id is `id` from the cached queries that hold it,
 * or `Option.none()` if none does. Where copies differ, the one from the
 * query that fetched or was written last wins. Use it for a detail query's
 * `placeholder`, to show the list's copy while the detail loads.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import * as Schema from "effect/Schema";
 *
 * import { Entity, Query } from "@monarcode/effetch-query";
 *
 * const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });
 * type Todo = typeof Todo.Type;
 * const Todos = Entity.make(Todo, { id: (todo) => todo.id });
 *
 * declare const fetchTodo: (id: number) => Effect.Effect<Todo>;
 *
 * export const todo = Query.family({
 *   key: ["todos", "detail"],
 *   run: fetchTodo,
 *   schema: { success: Todo },
 *   placeholder: (id) => Entity.get(Todos, id),
 * });
 * ```
 *
 * @since 0.1.0
 */
export const get = <A, Id>(
	entity: Entity<A, Id>,
	id: NoInfer<Id>,
): Effect.Effect<Option.Option<A>, never, QueryClient.QueryClient> =>
	QueryClient.QueryClient.useSync(({ registry }) =>
		internal.findEntity(registry, internal.definition(entity), id),
	);
