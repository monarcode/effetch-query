import type * as Cause from "effect/Cause";
import type * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Predicate from "effect/Predicate";
import type * as Types from "effect/Types";

import * as internal from "./internal/mutation.js";
import type * as Query from "./Query.js";
import type * as QueryClient from "./QueryClient.js";

/**
 * The type of {@link TypeId}, the property that marks a {@link Mutation}.
 *
 * @example
 * ```ts
 * import { Mutation } from "@monarcode/effetch-query";
 *
 * export const id: Mutation.TypeId = Mutation.TypeId;
 * ```
 *
 * @since 0.1.0
 */
export type TypeId = internal.MutationTypeId;

/**
 * The property that marks a {@link Mutation}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Mutation } from "@monarcode/effetch-query";
 *
 * const ping = Mutation.make({ run: () => Effect.void });
 *
 * console.log(Mutation.TypeId in ping); // true
 * ```
 *
 * @see {@link isMutation} to check a value
 *
 * @since 0.1.0
 */
export const TypeId: TypeId = internal.MutationTypeId;

/**
 * Whether a value is a {@link Mutation}. A mutation's variables can't be
 * known from the value, so it narrows to `Mutation<never, unknown, unknown>`,
 * which every mutation is.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Mutation } from "@monarcode/effetch-query";
 *
 * const ping = Mutation.make({ run: () => Effect.void });
 *
 * Mutation.isMutation(ping); // true
 * Mutation.isMutation({ run: () => Effect.void }); // false
 * ```
 *
 * @since 0.1.0
 */
export const isMutation = (
	value: unknown,
): value is Mutation<never, unknown, unknown> =>
	Predicate.hasProperty(value, TypeId);

/**
 * A mutation's definition: what a run does with its `Variables`, succeeding
 * with `A` or failing with `E`. Create one with {@link make}, and run it with
 * {@link run} or `useMutation`.
 *
 * A definition holds no state. Each use (each component's `useMutation`)
 * keeps its own, so components never share a pending or failed state.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Mutation } from "@monarcode/effetch-query";
 *
 * export const rename: Mutation.Mutation<string, string, never> =
 *   Mutation.make({ run: (name: string) => Effect.succeed(name.trim()) });
 * ```
 *
 * @since 0.1.0
 */
export interface Mutation<Variables, A, E> {
	/** Marks a mutation, and carries its types. */
	readonly [TypeId]: {
		readonly _Variables: Types.Contravariant<Variables>;
		readonly _A: Types.Covariant<A>;
		readonly _E: Types.Covariant<E>;
	};
}

/**
 * Options for {@link make}. A run calls them in this order:
 *
 * 1. `optimistic`, whose cache writes are recorded;
 * 2. the client's `mutations.onMutate`;
 * 3. `run`, retried on `retry`;
 * 4. on success: `onSuccess`, `invalidates`, then the client's
 *    `mutations.onSuccess`;
 * 5. on failure: the optimistic writes are rolled back, then `onFailure`,
 *    then the client's `mutations.onFailure`;
 * 6. `onSettled`, then the client's `mutations.onSettled`.
 *
 * The run completes after all of them. If one of the callbacks here dies,
 * the run dies with its defect and the steps after it don't happen, except
 * that a run whose `optimistic` dies still has its writes rolled back.
 *
 * An interrupted run (with `concurrent: false`, replaced by a newer one; or
 * its client disposed) calls nothing after the interruption. If `run` hadn't
 * succeeded yet, its optimistic writes are rolled back, unless the client
 * is being disposed: then there's no cache left to put back.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import type { Mutation } from "@monarcode/effetch-query";
 *
 * export const options: Mutation.MakeOptions<string, string, never> = {
 *   run: (name) => Effect.succeed(name.trim()),
 *   invalidates: [["profile"]],
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface MakeOptions<
	Variables,
	A,
	E,
> extends QueryClient.MutationDefaults<E> {
	/** Performs the mutation, with your services and the client. */
	readonly run: (
		variables: Variables,
	) => Effect.Effect<A, E, QueryClient.Requirements>;
	/**
	 * Updates the cache before `run`, so the change shows at once. Its
	 * `Query.set` and `Query.update` calls are recorded, and if the run
	 * fails, the queries they wrote are put back, newest write first. A query
	 * written again in the meantime, even by a fetch, is put back all the
	 * same. Only writes made while it runs count: not those of a fiber it
	 * forks that write after it's done, nor those of a mutation it runs.
	 *
	 * A fetch of the same query already in flight still settles over the
	 * optimistic value, as it does over any `Query.set`, and there's no way
	 * to cancel it in this version: the query then shows what that fetch
	 * returned.
	 */
	readonly optimistic?:
		| ((
				variables: Variables,
		  ) => Effect.Effect<void, never, QueryClient.QueryClient>)
		| undefined;
	/** Runs after a successful `run`, before `invalidates`. */
	readonly onSuccess?:
		| ((
				value: A,
				variables: Variables,
		  ) => Effect.Effect<void, never, QueryClient.Requirements>)
		| undefined;
	/** Runs after a failed `run`, once the optimistic writes are rolled back. */
	readonly onFailure?:
		| ((
				cause: Cause.Cause<E>,
				variables: Variables,
		  ) => Effect.Effect<void, never, QueryClient.Requirements>)
		| undefined;
	/** Runs after `run` succeeds or fails, after `onSuccess` or `onFailure`. */
	readonly onSettled?:
		| ((
				exit: Exit.Exit<A, E>,
				variables: Variables,
		  ) => Effect.Effect<void, never, QueryClient.Requirements>)
		| undefined;
	/**
	 * Queries to invalidate after `onSuccess`, as `Query.invalidate` does:
	 * a list, or a function of the run's value and variables that returns
	 * one.
	 */
	readonly invalidates?:
		| ReadonlyArray<Query.Target>
		| ((value: A, variables: Variables) => ReadonlyArray<Query.Target>)
		| undefined;
}

/**
 * Defines a mutation. Nothing runs until it's used, with {@link run} or
 * `useMutation`. Its types come from `run`: annotate `run`'s parameter to
 * type the variables. Explicit type arguments must give all three, since the
 * value and error types left out are `never`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Mutation, Query } from "@monarcode/effetch-query";
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
 * export const renameTodo = Mutation.make({
 *   run: (next: Todo) => Effect.succeed(next),
 *   // Shown at once; put back if `run` fails.
 *   optimistic: (next) => Query.set(todo(next.id), next),
 *   onSuccess: (saved) => Query.set(todo(saved.id), saved),
 *   invalidates: [["todos", "list"]],
 * });
 * // Mutation<Todo, Todo, never>
 * ```
 *
 * @see {@link MakeOptions} for the order a run calls its options in
 *
 * @since 0.1.0
 */
export const make = <Variables = void, A = never, E = never>(
	options: MakeOptions<Variables, A, E>,
): Mutation<Variables, A, E> => internal.makeMutation(options);

/**
 * Runs a mutation from Effect code, with the steps {@link MakeOptions}
 * lists, and succeeds or fails as its `run` did. A mutation whose `run`
 * takes no variables runs without them. Each call is a run of its own:
 * `concurrent` applies to one use's runs, such as a component's
 * `useMutation`, so calls never interrupt each other.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Mutation } from "@monarcode/effetch-query";
 *
 * const rename = Mutation.make({
 *   run: (name: string) => Effect.succeed(name.trim()),
 * });
 *
 * export const program = Effect.map(
 *   Mutation.run(rename, " Ada "),
 *   (name) => `Renamed to ${name}`,
 * );
 * ```
 *
 * @since 0.1.0
 */
export const run: {
	<A, E>(
		mutation: Mutation<void, A, E>,
	): Effect.Effect<A, E, QueryClient.Requirements>;
	<Variables, A, E>(
		mutation: Mutation<Variables, A, E>,
		variables: Variables,
	): Effect.Effect<A, E, QueryClient.Requirements>;
} = <Variables, A, E>(
	mutation: Mutation<Variables, A, E>,
	variables?: Variables,
): Effect.Effect<A, E, QueryClient.Requirements> =>
	internal.execute(mutation, variables as Variables);
