import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type * as Reactivity from "effect/reactivity/Reactivity";
import type * as Scope from "effect/Scope";

import * as cache from "./internal/cache.js";
import { matching } from "./internal/keyIndex.js";
import * as internal from "./internal/queryAtom.js";
import { isInUse } from "./internal/usage.js";
import * as QueryClient from "./QueryClient.js";

/**
 * Identifies a query in the cache. Keys are hierarchical arrays: each segment
 * is compared with `Equal.equals`, so plain objects and arrays match by
 * structure, and a key matches every longer key it is a prefix of.
 *
 * Keep keys JSON-compatible (strings, numbers, booleans, `null`, and arrays
 * and plain objects of them): with server rendering, they're sent to the
 * browser to find each query again.
 *
 * @example
 * ```ts
 * import { Query } from "@monarcode/effetch-query";
 *
 * const key: Query.QueryKey = ["todos", "detail", 1];
 * ```
 *
 * @since 0.1.0
 */
export type QueryKey = ReadonlyArray<unknown>;

/**
 * The type of {@link QueryTypeId}, the property that marks a {@link Query}.
 *
 * @example
 * ```ts
 * import { Query } from "@monarcode/effetch-query";
 *
 * export const id: Query.QueryTypeId = Query.QueryTypeId;
 * ```
 *
 * @since 0.1.0
 */
export type QueryTypeId = internal.QueryTypeId;

/**
 * The property that marks a {@link Query}, so it can be told apart from other
 * atoms.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Query } from "@monarcode/effetch-query";
 *
 * const me = Query.make({ key: ["me"], run: Effect.succeed("Ada") });
 *
 * console.log(Query.QueryTypeId in me); // true
 * ```
 *
 * @see {@link isQuery} to check a value
 *
 * @since 0.1.0
 */
export const QueryTypeId: QueryTypeId = internal.QueryTypeId;

/**
 * Whether a value is a {@link Query}, as opposed to another atom or value.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import * as Atom from "effect/reactivity/Atom";
 *
 * import { Query } from "@monarcode/effetch-query";
 *
 * const me = Query.make({ key: ["me"], run: Effect.succeed("Ada") });
 *
 * Query.isQuery(me); // true
 * Query.isQuery(Atom.make(0)); // false
 * ```
 *
 * @since 0.1.0
 */
export const isQuery: (value: unknown) => value is Query<unknown, unknown> =
	internal.isQuery;

/**
 * A cached query: an atom whose value is the query's `AsyncResult`, with a
 * key. Create one with {@link make}, or one per argument with {@link family}.
 *
 * Because it's an atom, it works with `@effect/atom-react`'s hooks,
 * `Atom.map` and the rest of `effect/reactivity`. Writing to it shows the
 * written value until a fetch that settles after the write. Prefer
 * {@link set}: on a query that isn't cached, a plain atom write (such as
 * `registry.set` or `useAtomSet`) is kept but the query still fetches when
 * it's first read, while {@link set} caches the value without fetching.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import * as AsyncResult from "effect/reactivity/AsyncResult";
 * import * as Atom from "effect/reactivity/Atom";
 *
 * import { Query } from "@monarcode/effetch-query";
 *
 * const todos = Query.make({
 *   key: ["todos"],
 *   run: Effect.succeed<ReadonlyArray<string>>(["Buy milk"]),
 * });
 *
 * // Derive from it like any atom.
 * export const count = Atom.map(todos, AsyncResult.map((list) => list.length));
 * ```
 *
 * @since 0.1.0
 */
export interface Query<A, E> extends Atom.Writable<
	AsyncResult.AsyncResult<A, E>,
	A
> {
	/** Marks the atom as a query. */
	readonly [QueryTypeId]: QueryTypeId;
	/** The query's key: a family's key with the argument appended. */
	readonly key: QueryKey;
}

/**
 * Makes one {@link Query} per argument. Calling it with arguments that are
 * `Equal.equals` (plain objects and arrays compare by structure) returns the
 * same query, whose key is the family's key with the argument appended.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Query } from "@monarcode/effetch-query";
 *
 * const todo: Query.QueryFamily<number, string, never> = Query.family({
 *   key: ["todos", "detail"],
 *   run: (id: number) => Effect.succeed(`Todo ${id}`),
 * });
 *
 * todo(1).key; // ["todos", "detail", 1]
 * ```
 *
 * @since 0.1.0
 */
export interface QueryFamily<Args, A, E> {
	(args: Args): Query<A, E>;
	/** The key every member's key starts with. */
	readonly key: QueryKey;
}

/**
 * What {@link invalidate}, {@link refetch} and {@link reset} act on: a
 * {@link Query} (that key only), a {@link QueryFamily} (all its members), or
 * a {@link QueryKey} (every query whose key starts with it).
 *
 * @example
 * ```ts
 * import { Query } from "@monarcode/effetch-query";
 *
 * // Every query under "todos": lists, details, …
 * export const everyTodo: Query.QueryTarget = ["todos"];
 * ```
 *
 * @since 0.1.0
 */
export type QueryTarget =
	// A query is written with its value, so `Query<never, E>` (one that never
	// succeeds) isn't a `Query<any, any>`: `any` doesn't extend `never`.
	| Query<any, any>
	| Query<never, any>
	| QueryFamily<any, any, any>
	| QueryFamily<any, never, any>
	| QueryKey;

/**
 * What a query's `run` receives, for reading other queries.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Query } from "@monarcode/effetch-query";
 *
 * const me = Query.make({ key: ["me"], run: Effect.succeed({ id: 7 }) });
 *
 * export const myTodos = Query.make({
 *   key: ["todos", "mine"],
 *   run: (ctx: Query.RunContext) =>
 *     Effect.map(ctx.result(me), (user) => [`Todo for ${user.id}`]),
 * });
 * ```
 *
 * @since 0.1.0
 */
export interface RunContext {
	/**
	 * Reads another query's value and makes this query depend on it: when it
	 * changes, this query refetches. Waits while it has no value yet, and
	 * fails if it failed.
	 */
	readonly result: <A, E>(query: Query<A, E>) => Effect.Effect<A, E>;
}

/**
 * The options every query takes besides `key` and `run`. Those shared with
 * the client's `queries.defaults` override them.
 *
 * @example
 * ```ts
 * import type { Query } from "@monarcode/effetch-query";
 *
 * export const options: Query.Options<never> = {
 *   staleTime: "1 minute",
 *   gcTime: "10 minutes",
 *   reactivityKeys: ["todos"],
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface Options<E> extends QueryClient.QueryDefaults<E> {
	/**
	 * How long a query nothing uses stays cached. Default: 5 minutes. Unlike
	 * the other options, there's no client-wide default.
	 */
	readonly gcTime?: Duration.Input | undefined;
	/**
	 * `Reactivity` keys that refetch this query when invalidated, for Effect
	 * code that publishes them (Effect's SQL clients do). Run
	 * `Reactivity.invalidate` through the client, as
	 * {@link QueryClient.QueryClient.runPromise} does, to reach it.
	 */
	readonly reactivityKeys?: Reactivity.KeysInput | undefined;
}

/**
 * Options for {@link make}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import type { Query } from "@monarcode/effetch-query";
 *
 * export const options: Query.MakeOptions<string, never> = {
 *   key: ["session", "me"],
 *   run: Effect.succeed("Ada"),
 *   staleTime: "5 minutes",
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface MakeOptions<A, E> extends Options<E> {
	/** The query's key. */
	readonly key: QueryKey;
	/**
	 * Fetches the value: an Effect, or a function of a {@link RunContext}
	 * for queries that read other queries. It runs with your services and
	 * the client, and its `Scope` closes when the fetch settles.
	 */
	readonly run:
		| Effect.Effect<A, E, QueryClient.Requirements | Scope.Scope>
		| ((
				ctx: RunContext,
		  ) => Effect.Effect<A, E, QueryClient.Requirements | Scope.Scope>);
}

/**
 * Options for {@link family}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import type { Query } from "@monarcode/effetch-query";
 *
 * export const options: Query.FamilyOptions<number, string, never> = {
 *   key: ["todos", "detail"],
 *   run: (id) => Effect.succeed(`Todo ${id}`),
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface FamilyOptions<Args, A, E> extends Options<E> {
	/** The family's key. Each member appends its argument. */
	readonly key: QueryKey;
	/**
	 * Fetches one member's value from its argument. It runs with your
	 * services and the client, and its `Scope` closes when the fetch settles.
	 */
	readonly run: (
		args: Args,
		ctx: RunContext,
	) => Effect.Effect<A, E, QueryClient.Requirements | Scope.Scope>;
}

/**
 * Defines a query with no arguments. Nothing is fetched until it's used.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Query } from "@monarcode/effetch-query";
 *
 * export const me = Query.make({
 *   key: ["session", "me"],
 *   run: Effect.succeed({ id: 7, name: "Ada" }),
 * });
 * ```
 *
 * @see {@link family} for a query per argument
 *
 * @since 0.1.0
 */
export const make = <A, E>(options: MakeOptions<A, E>): Query<A, E> =>
	internal.makeQuery({
		key: options.key,
		run: internal.toRun(options.run),
		options,
	});

/**
 * Defines a {@link QueryFamily}: one query per argument, each cached on its
 * own.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Query } from "@monarcode/effetch-query";
 *
 * interface ListParams {
 *   readonly limit: number;
 * }
 *
 * export const todos = Query.family({
 *   key: ["todos", "list"],
 *   run: (params: ListParams) =>
 *     Effect.succeed(Array.from({ length: params.limit }, (_, i) => i)),
 *   staleTime: "1 minute",
 * });
 *
 * todos({ limit: 20 }) === todos({ limit: 20 }); // true
 * ```
 *
 * @since 0.1.0
 */
export const family = <Args, A, E>(
	options: FamilyOptions<Args, A, E>,
): QueryFamily<Args, A, E> =>
	Object.assign(
		Atom.family((args: Args) =>
			internal.makeQuery({
				key: [...options.key, args],
				run: (ctx) => options.run(args, ctx),
				options,
			}),
		),
		{ key: options.key },
	);

/**
 * Returns a query's value: the cached one if it's fresh (younger than
 * `staleTime`), otherwise the result of a new fetch. Joins a fetch already in
 * progress. Fails with the query's error, and dies on defects, as its own
 * Effect does.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Query } from "@monarcode/effetch-query";
 *
 * const me = Query.make({ key: ["me"], run: Effect.succeed("Ada") });
 *
 * export const greeting = Effect.map(Query.fetch(me), (name) => `Hi, ${name}`);
 * ```
 *
 * @see {@link prefetch} to warm the cache without waiting on the value
 *
 * @since 0.1.0
 */
export const fetch = <A, E>(
	query: Query<A, E>,
): Effect.Effect<A, E, QueryClient.QueryClient> =>
	QueryClient.QueryClient.use(({ registry }) =>
		cache.fetchValue(registry, query),
	);

/**
 * Fetches a query unless its value is fresh, like {@link fetch}, but never
 * fails: use it to warm the cache before the value is needed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Query } from "@monarcode/effetch-query";
 *
 * const todos = Query.make({ key: ["todos"], run: Effect.succeed(["Buy milk"]) });
 *
 * export const onSignIn = Query.prefetch(todos);
 * ```
 *
 * @since 0.1.0
 */
export const prefetch = <A, E>(
	query: Query<A, E>,
): Effect.Effect<void, never, QueryClient.QueryClient> =>
	Effect.asVoid(Effect.exit(fetch(query)));

/**
 * Returns a query's cached value, if it has one. Never fetches. A query whose
 * last fetch failed still returns the value it had before.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import * as Option from "effect/Option";
 *
 * import { Query } from "@monarcode/effetch-query";
 *
 * const todos = Query.make({ key: ["todos"], run: Effect.succeed(["Buy milk"]) });
 *
 * export const count = Effect.map(
 *   Query.get(todos),
 *   Option.match({ onNone: () => 0, onSome: (list) => list.length }),
 * );
 * ```
 *
 * @since 0.1.0
 */
export const get = <A, E>(
	query: Query<A, E>,
): Effect.Effect<Option.Option<A>, never, QueryClient.QueryClient> =>
	QueryClient.QueryClient.useSync(({ registry }) =>
		Option.flatMap(cache.peek(registry, query), AsyncResult.value),
	);

/**
 * Writes a query's value. It's shown until a fetch settles after the write,
 * including while that fetch is in progress; if the fetch fails, it stays as
 * the query's last value. A query that isn't cached yet is cached with the
 * value, without fetching. The value counts as fresh data: a query
 * invalidated while nothing used it isn't refetched for it until it's older
 * than `staleTime`. The client's `queries` hooks don't run for it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Query } from "@monarcode/effetch-query";
 *
 * interface Todo {
 *   readonly id: number;
 *   readonly title: string;
 * }
 *
 * const todo = Query.family({
 *   key: ["todos", "detail"],
 *   run: (id: number): Effect.Effect<Todo> => Effect.succeed({ id, title: "" }),
 * });
 *
 * export const onSaved = (saved: Todo) => Query.set(todo(saved.id), saved);
 * ```
 *
 * @see {@link update} to write a value computed from the current one
 *
 * @since 0.1.0
 */
export const set = <A, E>(
	query: Query<A, E>,
	value: A,
): Effect.Effect<void, never, QueryClient.QueryClient> =>
	QueryClient.QueryClient.useSync(({ registry }) => {
		cache.setValue(registry, query, value);
	});

/**
 * Writes a value computed from a query's cached one, as {@link set} does.
 * Does nothing if the query has no value.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Query } from "@monarcode/effetch-query";
 *
 * const todos = Query.make({
 *   key: ["todos"],
 *   run: Effect.succeed<ReadonlyArray<string>>(["Buy milk"]),
 * });
 *
 * export const add = (title: string) =>
 *   Query.update(todos, (list) => [...list, title]);
 * ```
 *
 * @since 0.1.0
 */
export const update = <A, E>(
	query: Query<A, E>,
	f: (value: A) => A,
): Effect.Effect<void, never, QueryClient.QueryClient> =>
	QueryClient.QueryClient.useSync(({ registry }) => {
		cache.updateValue(registry, query, f);
	});

/**
 * Marks the matching queries stale. Those in use (as {@link refetch}
 * defines it) refetch now; the others refetch the next time they're used.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Query } from "@monarcode/effetch-query";
 *
 * declare const saveTodo: Effect.Effect<void>;
 *
 * // After saving, every query under "todos" is out of date.
 * export const save = Effect.andThen(saveTodo, Query.invalidate(["todos"]));
 * ```
 *
 * @see {@link refetch} to wait for the refetch
 *
 * @since 0.1.0
 */
export const invalidate = (
	target: QueryTarget,
): Effect.Effect<void, never, QueryClient.QueryClient> =>
	QueryClient.QueryClient.useSync(({ registry }) => {
		for (const query of matching(registry, target)) {
			registry.refresh(query);
		}
	});

/**
 * Refetches the matching queries that are in use, and completes when they
 * have all settled. Their failures don't fail it: each query shows its own.
 *
 * A query is in use while something subscribes to it, or to an atom or
 * query that depends on it: a mounted component, say, or a mounted query
 * that reads it through {@link RunContext.result}. A dependent that is only
 * cached doesn't count.
 *
 * @example
 * ```ts
 * import { Query } from "@monarcode/effetch-query";
 *
 * // Pull to refresh: the spinner stops when this completes.
 * export const onRefresh = Query.refetch(["todos", "list"]);
 * ```
 *
 * @see {@link invalidate} to refetch without waiting, including queries not
 * in use
 *
 * @since 0.1.0
 */
export const refetch = (
	target: QueryTarget,
): Effect.Effect<void, never, QueryClient.QueryClient> =>
	QueryClient.QueryClient.use(({ registry }) => {
		const used = matching(registry, target).filter((query) =>
			isInUse(registry, query),
		);
		for (const query of used) {
			registry.refresh(query);
		}
		return Effect.forEach(
			used,
			(query) =>
				Effect.exit(
					AtomRegistry.getResult(registry, query, {
						suspendOnWaiting: true,
					}),
				),
			{ concurrency: "unbounded", discard: true },
		);
	});

/**
 * Puts the matching queries back to `Initial`, dropping their values and
 * any written with {@link set}. Those in use (as {@link refetch} defines it)
 * fetch again straight away, and a fetch in progress is replaced.
 *
 * @example
 * ```ts
 * import { Query } from "@monarcode/effetch-query";
 *
 * // After signing out, nothing under "session" may show.
 * export const onSignOut = Query.reset(["session"]);
 * ```
 *
 * @since 0.1.0
 */
export const reset = (
	target: QueryTarget,
): Effect.Effect<void, never, QueryClient.QueryClient> =>
	QueryClient.QueryClient.useSync(({ registry }) => {
		// Not in a batch: its commit rebuilds every stale node, so the queries
		// not in use would fetch too.
		for (const query of matching(registry, target)) {
			cache.resetQuery(registry, query);
		}
	});
