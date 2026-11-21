import * as Data from "effect/Data";

import type * as Query from "./Query.js";

/**
 * Thrown when a key holds a query, a family or a group, such as
 * `Query.invalidate([wallet, transactions])`. Its segments are compared
 * with the query keys, so as a key it would match nothing: the targets were
 * meant to be one target. Combine them with {@link Query.group}.
 *
 * Everything that takes a {@link Query.Target} checks it, and reports it
 * in its own way:
 *
 * - the `Query` functions, such as `Query.invalidate`, die with it, and so
 *   does `Mutation.run` for a key in `invalidates`;
 * - the client's methods, such as `client.refetch`, reject with it;
 * - `useRefetch`, `useIsFetching`, `QueryClient.dehydrate`'s `queries` and
 *   `connectQueryClient`'s `queries` throw it when called.
 *
 * @example
 * ```ts
 * import * as Cause from "effect/Cause";
 * import * as Effect from "effect/Effect";
 *
 * import { Query } from "@monarcode/effetch-query";
 *
 * declare const refresh: Effect.Effect<void, never, never>;
 *
 * // Turns the defect into a message, for a log or a test.
 * export const explained = refresh.pipe(
 *   Effect.catchCause((cause) =>
 *     Effect.succeed(
 *       Cause.squash(cause) instanceof Query.KeyHoldsTargetError
 *         ? "Pass a Query.group, not an array of queries"
 *         : Cause.pretty(cause),
 *     ),
 *   ),
 * );
 * ```
 *
 * @since 0.1.0
 */
export class KeyHoldsTargetError extends Data.TaggedError(
	"KeyHoldsTargetError",
)<{
	/** The key that holds a target. */
	readonly key: Query.Key;
	/** What went wrong and how to fix it, for logs. */
	readonly message: string;
}> {}
