import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schema from "effect/Schema";

import { NonJsonKey } from "../HydrationError.js";
import type * as InfiniteQuery from "../InfiniteQuery.js";
import type * as Query from "../Query.js";

/**
 * A query's result to and from JSON (DESIGN.md §3.12), with its schema's
 * JSON codec as `AsyncResult.Schema` builds it. Both throw `SchemaError` for
 * a value the schema doesn't fit.
 */
export interface Codec<A, E> {
	readonly encode: (result: AsyncResult.AsyncResult<A, E>) => Schema.Json;
	readonly decode: (json: Schema.Json) => AsyncResult.AsyncResult<A, E>;
}

/** How a definition's queries cross the wire: its codec, and the kind its keys hash under. */
export interface Hydration<A, E> {
	readonly codec: Codec<A, E>;
	readonly kind?: string | undefined;
}

/**
 * The codec of a schema, built the first time it's used: a definition's
 * members share it, and a definition that never crosses the wire never
 * builds one.
 */
export const makeCodec = <A, E>(
	schema: Query.QuerySchema<A, E>,
): Codec<A, E> => {
	let built: Codec<A, E> | undefined;
	const codec = (): Codec<A, E> => {
		if (built === undefined) {
			const json = Schema.toCodecJson(
				AsyncResult.Schema({
					success: schema.success,
					error: schema.error,
				}),
			);
			built = {
				encode: Schema.encodeSync(json) as Codec<A, E>["encode"],
				decode: Schema.decodeSync(json) as Codec<A, E>["decode"],
			};
		}
		return built;
	};
	return {
		encode: (result) => codec().encode(result),
		decode: (json) => codec().decode(json),
	};
};

/**
 * An infinite query's schema as a query's: its pages and their params, the
 * params as JSON values unless it names their schema.
 */
export const infiniteSchema = <A, E, P>(
	schema: InfiniteQuery.PageSchema<A, E, P>,
): Query.QuerySchema<InfiniteQuery.InfiniteData<A, P>, E> => ({
	success: Schema.Struct({
		pages: Schema.Array(schema.page),
		pageParams: Schema.Array(schema.pageParam ?? Schema.Json),
	}) as unknown as Schema.Codec<InfiniteQuery.InfiniteData<A, P>, unknown>,
	error: schema.error,
});

/**
 * A result as JSON, or none when the codec can't encode it: the schema
 * doesn't fit the value, or needs a service, which a sync codec has no way
 * to provide (an effetch endpoint's `output` may). The query then fetches in
 * the browser.
 */
export const encodeResult = <A, E>(
	codec: Codec<A, E>,
	result: AsyncResult.AsyncResult<A, E>,
): Option.Option<Schema.Json> => {
	try {
		return Option.some(codec.encode(result));
	} catch {
		return Option.none();
	}
};

/** A JSON value decoded with a codec, or none when it can't be, as {@link encodeResult}. */
export const decodeResult = <A, E>(
	codec: Codec<A, E>,
	json: unknown,
): Option.Option<AsyncResult.AsyncResult<A, E>> => {
	try {
		return Option.some(codec.decode(json as Schema.Json));
	} catch {
		return Option.none();
	}
};

/**
 * A query's hash, or none when its key isn't JSON: the browser only looks
 * queries up, and the server never sends such a one.
 */
export const hashOption = (hash: () => string): Option.Option<string> => {
	try {
		return Option.some(hash());
	} catch (error) {
		if (error instanceof NonJsonKey) {
			return Option.none();
		}
		throw error;
	}
};
