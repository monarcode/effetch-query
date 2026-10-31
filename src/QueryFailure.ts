import type * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Predicate from "effect/Predicate";

import { isQuery } from "./internal/queryAtom.js";
import type { Query } from "./Query.js";

/**
 * Thrown by `useSuspenseQuery` (from `@monarcode/effetch-query/react`) to the
 * nearest error boundary when a query fails. It carries the query, so the
 * boundary can refetch it with `useResetQueryFailure`, and the full `Cause`.
 * Code outside React never sees it: there, a query's failure keeps its own
 * error type.
 *
 * @example
 * ```ts
 * import { QueryFailure } from "@monarcode/effetch-query";
 *
 * // In an error boundary's fallback.
 * export const describe = (error: unknown): unknown =>
 *   QueryFailure.is(error) ? error.error : error;
 * ```
 *
 * @since 0.1.0
 */
export class QueryFailure extends Data.TaggedError("QueryFailure")<{
	/** The query that failed. */
	readonly query: Query<any, any>;
	/** Why it failed: the error, or a defect. */
	readonly cause: Cause.Cause<unknown>;
	/** The cause squashed to one value (`Cause.squash`), for display. */
	readonly error: unknown;
	/** The query's key and the error, for logs. */
	readonly message: string;
}> {
	/**
	 * Whether a value is a {@link QueryFailure}, such as what an error
	 * boundary caught.
	 *
	 * @example
	 * ```ts
	 * import { QueryFailure } from "@monarcode/effetch-query";
	 *
	 * declare const caught: unknown;
	 *
	 * if (QueryFailure.is(caught)) {
	 *   console.log(caught.query.key);
	 * }
	 * ```
	 *
	 * @since 0.1.0
	 */
	static is(value: unknown): value is QueryFailure {
		return (
			Predicate.isTagged(value, "QueryFailure") &&
			Predicate.hasProperty(value, "query") &&
			isQuery(value.query)
		);
	}
}
