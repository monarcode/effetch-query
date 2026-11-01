import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";

import type { Key as QueryKey } from "../Query.js";

/** One segment of a route's path: fixed text, or a `:param`'s name. */
export type Segment = Literal | Param;

interface Literal {
	readonly _tag: "Literal";
	readonly text: string;
}

interface Param {
	readonly _tag: "Param";
	readonly name: string;
}

const isLiteral = (segment: Segment): segment is Literal =>
	segment._tag === "Literal";

/** What a key is built from: the call's path params and query object. */
export interface RouteArgs {
	readonly params?:
		| { readonly [name: string]: string | number | undefined }
		| undefined;
	readonly query?: { readonly [name: string]: unknown } | undefined;
}

/**
 * A path's segments, without the scheme and host of a full URL. Params are
 * `:name` segments, as effetch fills them in.
 */
export const segments = (path: string): ReadonlyArray<Segment> =>
	path
		.replace(/^https?:\/\/[^/]*/i, "")
		.split("/")
		.filter((segment) => segment !== "")
		.map((segment) =>
			segment.length > 1 && segment.startsWith(":")
				? { _tag: "Param", name: segment.slice(1) }
				: { _tag: "Literal", text: segment },
		);

/**
 * A query object without what effetch leaves out of the request (`null` and
 * `undefined` values and array items), so two calls that send the same
 * request get the same key. `undefined` when nothing is left.
 */
const sentQuery = (
	query: RouteArgs["query"],
): { readonly [name: string]: unknown } | undefined => {
	if (query === undefined) {
		return undefined;
	}
	const entries = Object.entries(query).flatMap(([name, value]) => {
		if (Array.isArray(value)) {
			const items = value.filter(Predicate.isNotNullish);
			return items.length === 0 ? [] : [[name, items] as const];
		}
		return Predicate.isNotNullish(value) ? [[name, value] as const] : [];
	});
	return entries.length === 0 ? undefined : Object.fromEntries(entries);
};

/**
 * A call's arguments as a family member's: only the route's params and the
 * sent query, so calls that send the same request share a query, even when
 * `params` is a bigger object such as the todo itself.
 */
export const canonicalArgs = (
	path: ReadonlyArray<Segment>,
	args: RouteArgs | undefined,
): RouteArgs => {
	// A missing param stays missing, so effetch reports it.
	const params = path.flatMap((segment) => {
		if (segment._tag === "Literal") {
			return [];
		}
		const value = args?.params?.[segment.name];
		return value === undefined ? [] : [[segment.name, value] as const];
	});
	const query = sentQuery(args?.query);
	return {
		...(params.length === 0 ? {} : { params: Object.fromEntries(params) }),
		...(query === undefined ? {} : { query }),
	};
};

/** Arguments without one query field, the page field of an infinite query. */
export const withoutQueryField = (
	args: RouteArgs,
	field: string,
): RouteArgs => {
	if (args.query === undefined || !(field in args.query)) {
		return args;
	}
	const query = Object.fromEntries(
		Object.entries(args.query).filter(([name]) => name !== field),
	);
	return {
		...(args.params === undefined ? {} : { params: args.params }),
		...(Object.keys(query).length === 0 ? {} : { query }),
	};
};

/** The key of one call: the prefix, the path with params filled in, then the query. */
export const routeKey = (
	prefix: QueryKey,
	path: ReadonlyArray<Segment>,
	args: RouteArgs,
): QueryKey => [
	...prefix,
	...path.map((segment) =>
		segment._tag === "Literal" ? segment.text : args.params?.[segment.name],
	),
	...(args.query === undefined ? [] : [args.query]),
];

/** The fixed start of every key a route makes: the prefix and the literals before its first param. */
export const routeKeyPrefix = (
	prefix: QueryKey,
	path: ReadonlyArray<Segment>,
): QueryKey => [
	...prefix,
	...Arr.takeWhile(path, isLiteral).map((segment) => segment.text),
];
