import * as Data from "effect/Data";

import type * as Query from "./Query.js";

/**
 * Thrown when a query key has to become a string, to send a query from the
 * server to the browser, and a segment isn't JSON: a `Date`, a class
 * instance, `undefined` in an array, `NaN` or `Infinity`, a function, a
 * `bigint` or a symbol. Keys of queries that cross the wire hold only
 * strings, finite numbers, booleans, `null`, and arrays and plain objects of
 * them (`undefined` properties are dropped, as `JSON.stringify` drops them).
 *
 * @example
 * ```ts
 * import { QueryClient } from "@monarcode/effetch-query";
 *
 * export const explain = (error: unknown): string =>
 *   error instanceof QueryClient.NonJsonKeyError
 *     ? `Can't send ${String(error.segment)} in a key`
 *     : String(error);
 * ```
 *
 * @since 0.1.0
 */
export class NonJsonKeyError extends Data.TaggedError("NonJsonKeyError")<{
	/** The key that can't be sent. */
	readonly key: Query.Key;
	/** The first value in it that isn't JSON. */
	readonly segment: unknown;
	/** The key and the value, for logs. */
	readonly message: string;
}> {}

/**
 * Thrown by `QueryClient.dehydrate` when two cached queries it would send
 * have one key: two definitions with the same key, such as two
 * `api.query` of one effetch endpoint. The browser finds a query by its
 * key, so it couldn't tell them apart. Give one of them another key (an
 * effetch builder takes a `key` prefix).
 *
 * @example
 * ```ts
 * import { QueryClient } from "@monarcode/effetch-query";
 *
 * export const explain = (error: unknown): string =>
 *   error instanceof QueryClient.DuplicateQueryKeyError
 *     ? `Two queries use the key ${JSON.stringify(error.key)}`
 *     : String(error);
 * ```
 *
 * @since 0.1.0
 */
export class DuplicateQueryKeyError extends Data.TaggedError(
	"DuplicateQueryKeyError",
)<{
	/** The key both queries have. */
	readonly key: Query.Key;
	/** The key, for logs. */
	readonly message: string;
}> {}
