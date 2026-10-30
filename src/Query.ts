/**
 * Identifies a query in the cache. Keys are hierarchical arrays: each segment
 * is compared with `Equal.equals`, so plain objects and arrays match by
 * structure, and a key matches every longer key it is a prefix of.
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
