import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as HttpMethod from "effect/http/HttpMethod";
import * as Atom from "effect/reactivity/Atom";
import type * as Schema from "effect/Schema";

import type * as Fetch from "@monarcode/effetch";

import type * as InfiniteQuery from "../InfiniteQuery.js";
import { infiniteSchema, makeCodec } from "../internal/hydration.js";
import { makeInfiniteQuery } from "../internal/infiniteQuery.js";
import { KeyMatcherId } from "../internal/keyIndex.js";
import { isMember, makeQuery, runOnce } from "../internal/queryAtom.js";
import {
	canonicalArgs,
	type RouteArgs,
	routeKey,
	routeKeyPrefix,
	type Segment,
	segments,
	withoutQueryField,
} from "../internal/routeKey.js";
import * as Mutation from "../Mutation.js";
import type * as Query from "../Query.js";
import type * as QueryClient from "../QueryClient.js";
import { wireErrors } from "./wireErrors.js";

/**
 * A schema whose decoding and encoding need nothing outside your registered
 * services (`Register["services"]`) and the client. The adapter accepts only
 * these, so an endpoint whose schema needs another service is a compile
 * error where its query or mutation is defined ({@link Endpoints.query},
 * {@link Endpoints.mutation}).
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema";
 *
 * import type { RegisteredSchema } from "@monarcode/effetch-query/effetch";
 *
 * export const Todo = Schema.Struct({
 *   id: Schema.Finite,
 * }) satisfies RegisteredSchema;
 * ```
 *
 * @since 0.1.0
 */
export interface RegisteredSchema extends Fetch.AnySchema {
	/** What decoding needs: only registered services. */
	readonly DecodingServices: QueryClient.Requirements;
	/** What encoding needs: only registered services. */
	readonly EncodingServices: QueryClient.Requirements;
}

/**
 * Options for {@link endpoints}.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema";
 *
 * import type { EndpointsOptions } from "@monarcode/effetch-query/effetch";
 *
 * const ApiError = Schema.Struct({ message: Schema.String });
 *
 * export const options: EndpointsOptions<typeof ApiError> = {
 *   key: ["wallet"],
 *   defaultError: ApiError,
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface EndpointsOptions<EB extends Fetch.AnySchema> {
	/**
	 * Put before every key these endpoints make, when another backend has
	 * the same paths: with `["wallet"]`, `GET /accounts/:id` is
	 * `["wallet", "accounts", 1]`.
	 */
	readonly key?: Query.Key | undefined;
	/**
	 * The client's `defaultError`, for queries whose endpoint has no `error`
	 * schema of its own. A definition can't read it from the client, which
	 * only exists once its layer is built. It's typed as the client's, and
	 * shown as {@link EndpointQuery.error}.
	 */
	readonly defaultError?: EB | undefined;
}

/**
 * Options for {@link Endpoints.query}: a query's options, and the headers
 * and plugin overrides `client.bind` takes.
 *
 * @example
 * ```ts
 * import type { EndpointQueryOptions } from "@monarcode/effetch-query/effetch";
 *
 * export const options: EndpointQueryOptions<never, []> = {
 *   staleTime: "1 minute",
 *   headers: { accept: "application/json" },
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface EndpointQueryOptions<
	E,
	Ps extends ReadonlyArray<Fetch.Plugin.Any>,
>
	extends Query.Options<E>, Fetch.BindOptions<Ps> {}

/**
 * Options for {@link Endpoints.infiniteQuery}: an infinite query's page
 * options and query options, the query field each page's param is sent in,
 * and the headers and plugin overrides `client.bind` takes.
 *
 * @example
 * ```ts
 * import type { EndpointInfiniteQueryOptions } from "@monarcode/effetch-query/effetch";
 *
 * interface Page {
 *   readonly skip: number;
 *   readonly limit: number;
 *   readonly total: number;
 * }
 *
 * export const options: EndpointInfiniteQueryOptions<Page, never, number, []> = {
 *   pageParam: "skip",
 *   initialPageParam: 0,
 *   nextPageParam: (last) =>
 *     last.skip + last.limit < last.total ? last.skip + last.limit : undefined,
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface EndpointInfiniteQueryOptions<
	A,
	E,
	P,
	Ps extends ReadonlyArray<Fetch.Plugin.Any>,
>
	extends
		Query.Options<E>,
		InfiniteQuery.PageOptions<A, P>,
		Fetch.BindOptions<Ps> {
	/**
	 * The query field each page's param is sent in, such as `"cursor"` or
	 * `"skip"`. It's set on every page's request, over the call's own value,
	 * and left out of the key. The param must be a value a query field takes
	 * (a string, number, boolean, `null` or `undefined`).
	 */
	readonly pageParam: [P] extends [Fetch.QueryValue] ? string : never;
}

/**
 * Options for {@link Endpoints.mutation}: a mutation's options without
 * `run`, which is the endpoint, and the headers and plugin overrides
 * `client.bind` takes.
 *
 * @example
 * ```ts
 * import type { EndpointMutationOptions } from "@monarcode/effetch-query/effetch";
 *
 * export const options: EndpointMutationOptions<void, unknown, never, []> = {
 *   invalidates: [["todos"]],
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface EndpointMutationOptions<
	Variables,
	A,
	E,
	Ps extends ReadonlyArray<Fetch.Plugin.Any>,
>
	extends
		Omit<Mutation.MakeOptions<Variables, A, E>, "run">,
		Fetch.BindOptions<Ps> {}

/**
 * What a query from route `R` takes: the path's params, and a query object.
 * They make its key, so `headers` and `plugins` are given once, in
 * {@link EndpointQueryOptions}, instead.
 *
 * - `Q`: the type of `query`, checked with `Fetch.QueryOf`, so a value typed
 *   with an `interface` is accepted too. Defaults to `Fetch.QueryInput`.
 *
 * @example
 * ```ts
 * import type { EndpointQueryArgs } from "@monarcode/effetch-query/effetch";
 *
 * export const args: EndpointQueryArgs<"GET /todos/:id"> = {
 *   params: { id: 1 },
 *   query: { expand: "owner" },
 * };
 * ```
 *
 * @since 0.1.0
 */
export type EndpointQueryArgs<
	R extends string,
	Q extends Fetch.QueryOf<Q> = Fetch.QueryInput,
> = Fetch.ParamsOption<Fetch.RoutePath<R>> & {
	readonly query?: Q | undefined;
};

/**
 * What a mutation from route `R` takes when run: the endpoint's call
 * options (`params`, `query`, `body`, `headers`, `plugins`), or nothing
 * when none are required. The variables of {@link Endpoints.mutation}.
 *
 * Its `query` is a `Fetch.QueryInput`, which has an index signature: type a
 * query object you pass with a `type` alias rather than an `interface`.
 *
 * @example
 * ```ts
 * import type { EndpointVariables } from "@monarcode/effetch-query/effetch";
 *
 * export const variables: EndpointVariables<"DELETE /todos/:id", undefined, []> =
 *   { params: { id: 1 } };
 * ```
 *
 * @since 0.1.0
 */
export type EndpointVariables<
	R extends string,
	I extends Fetch.AnySchema | undefined,
	Ps extends ReadonlyArray<Fetch.Plugin.Any>,
> =
	Fetch.EndpointArgs<R, I, Fetch.EndpointOptions<R, I, Ps>> extends [
		options: infer Options,
	]
		? Options
		: Fetch.EndpointOptions<R, I, Ps> | void;

/**
 * The error schema a bound endpoint decodes error bodies with: its own, or
 * the client's `defaultError` (see {@link EndpointsOptions.defaultError}).
 *
 * @example
 * ```ts
 * import type * as Schema from "effect/Schema";
 *
 * import type { ErrorSchema } from "@monarcode/effetch-query/effetch";
 *
 * export type Decoded = ErrorSchema<undefined, Schema.String>; // Schema.String
 * ```
 *
 * @since 0.1.0
 */
export type ErrorSchema<
	Own extends Fetch.AnySchema | undefined,
	Default extends Fetch.AnySchema,
> = Own extends Fetch.AnySchema ? Own : Default;

/**
 * A family of queries, one per call of an effetch endpoint, made by
 * {@link Endpoints.query}. Call it with the endpoint's `params` and `query`
 * to get the query for that call. Its key is the route's path with the
 * params filled in, then the query object: `GET /todos/:id` called with
 * `{ params: { id: 1 } }` is `["todos", 1]`.
 *
 * Calls that send the same request share a query: `null` and `undefined`
 * query values and empty arrays are left out, as effetch leaves them out of
 * the URL. Values are otherwise compared as given, so `{ page: 1 }` and
 * `{ page: "1" }` are two queries.
 *
 * The key has no method, scheme or host, so give a backend of its own a
 * prefix ({@link EndpointsOptions.key}), and make one `EndpointQuery` per
 * endpoint: two would share keys but not their cache.
 *
 * As a target of {@link Query.invalidate}, {@link Query.refetch} or a
 * mutation's `invalidates`, it matches exactly its own queries, not other
 * routes under the same path.
 *
 * @example
 * ```ts
 * import type { EndpointQuery } from "@monarcode/effetch-query/effetch";
 *
 * declare const todo: EndpointQuery<
 *   "GET /todos/:id",
 *   { readonly id: number },
 *   never
 * >;
 *
 * export const first = todo({ params: { id: 1 } }); // key ["todos", 1]
 * ```
 *
 * @since 0.1.0
 */
export interface EndpointQuery<R extends string, A, E> {
	<Q extends Fetch.QueryOf<Q> = Fetch.QueryInput>(
		...args: Fetch.EndpointArgs<R, undefined, EndpointQueryArgs<R, Q>>
	): Query.Query<A, E>;
	/** The start every one of its keys has: the prefix and the path up to its first param. */
	readonly key: Query.Key;
	/** The endpoint definition it calls. */
	readonly endpoint: Fetch.UnboundEndpoint<
		R,
		Fetch.AnySchema | undefined,
		Fetch.AnySchema | undefined,
		Fetch.AnySchema | undefined
	>;
	/**
	 * The schema error bodies are decoded with: the endpoint's, else the
	 * `defaultError` given to {@link endpoints}, else `undefined` (the
	 * client's applies, but isn't known here).
	 */
	readonly error: Fetch.AnySchema | undefined;
}

/**
 * A family of infinite queries, one per call of an effetch endpoint, made by
 * {@link Endpoints.infiniteQuery}. Call it with the endpoint's `params` and
 * `query`, without the page field, to get the {@link InfiniteQuery.InfiniteQuery}
 * for that call. Keys and matching are as for {@link EndpointQuery}.
 *
 * @example
 * ```ts
 * import type { EndpointInfiniteQuery } from "@monarcode/effetch-query/effetch";
 *
 * declare const todoPages: EndpointInfiniteQuery<
 *   "GET /todos",
 *   { readonly todos: ReadonlyArray<string>; readonly skip: number },
 *   never,
 *   number
 * >;
 *
 * export const pages = todoPages({ query: { limit: 20 } }); // key ["todos", { limit: 20 }]
 * ```
 *
 * @since 0.1.0
 */
export interface EndpointInfiniteQuery<R extends string, A, E, P> {
	<Q extends Fetch.QueryOf<Q> = Fetch.QueryInput>(
		...args: Fetch.EndpointArgs<R, undefined, EndpointQueryArgs<R, Q>>
	): InfiniteQuery.InfiniteQuery<A, E, P>;
	/** The start every one of its keys has: the prefix and the path up to its first param. */
	readonly key: Query.Key;
	/** The endpoint definition it calls. */
	readonly endpoint: Fetch.UnboundEndpoint<
		R,
		Fetch.AnySchema | undefined,
		Fetch.AnySchema | undefined,
		Fetch.AnySchema | undefined
	>;
	/** The schema error bodies are decoded with, as {@link EndpointQuery.error}. */
	readonly error: Fetch.AnySchema | undefined;
}

/**
 * Queries and mutations for one effetch client, made by {@link endpoints}.
 *
 * @example
 * ```ts
 * import type * as Fetch from "@monarcode/effetch";
 * import type * as Schema from "effect/Schema";
 *
 * import type { Endpoints } from "@monarcode/effetch-query/effetch";
 *
 * declare const api: Endpoints<[], Schema.Unknown>;
 * declare const getTodo: Fetch.UnboundEndpoint<
 *   "GET /todos/:id",
 *   undefined,
 *   undefined,
 *   undefined
 * >;
 *
 * export const todo = api.query(getTodo);
 * ```
 *
 * @since 0.1.0
 */
export interface Endpoints<
	Ps extends ReadonlyArray<Fetch.Plugin.Any>,
	EB extends Fetch.AnySchema,
> {
	/**
	 * A family of queries that call an endpoint defined with
	 * `Fetch.endpoint`, one query per `params` and `query`. The value is the
	 * endpoint's `output`, and the error every error the call can fail with:
	 * `NetworkError`, `HttpError` with the decoded error body, `DecodeError`
	 * when it has an `output`, and the client's plugins' errors.
	 *
	 * Only `GET`, `HEAD`, `OPTIONS` and `TRACE` endpoints: a call with a body
	 * is a {@link Endpoints.mutation}, or a {@link Query.family} of your own.
	 *
	 * With an `output`, its queries cross from server to browser with no
	 * `schema` to write (`QueryClient.dehydrate`): the value with `output`,
	 * and, with `failures: "include"`, effetch's errors: an `HttpError`
	 * without its headers, though with its request URL and response text,
	 * so keep secrets out of the URLs your server calls. A query that failed
	 * with a plugin's error isn't sent.
	 */
	readonly query: <
		const R extends `${HttpMethod.HttpMethod.NoBody} ${string}`,
		O extends RegisteredSchema | undefined,
		Own extends RegisteredSchema | undefined,
		I extends RegisteredSchema | undefined,
	>(
		endpoint: Fetch.UnboundEndpoint<R, O, Own, I>,
		options?: EndpointQueryOptions<
			Fetch.CallError<O, ErrorSchema<Own, EB>, Ps>,
			Ps
		>,
	) => EndpointQuery<
		R,
		Fetch.Success<O>,
		Fetch.CallError<O, ErrorSchema<Own, EB>, Ps>
	>;
	/**
	 * A family of infinite queries that call an endpoint page by page, one
	 * query per `params` and `query`, as {@link Endpoints.query} makes
	 * queries. Each page's param is sent in the query field `pageParam`
	 * names; the value is an {@link InfiniteQuery.InfiniteData} of the
	 * endpoint's `output`. Only endpoints without a body. Its queries cross
	 * from server to browser as {@link Endpoints.query}'s do, the page
	 * params as JSON.
	 */
	readonly infiniteQuery: <
		const R extends `${HttpMethod.HttpMethod.NoBody} ${string}`,
		O extends RegisteredSchema | undefined,
		Own extends RegisteredSchema | undefined,
		I extends RegisteredSchema | undefined,
		P,
	>(
		endpoint: Fetch.UnboundEndpoint<R, O, Own, I>,
		options: EndpointInfiniteQueryOptions<
			Fetch.Success<O>,
			Fetch.CallError<O, ErrorSchema<Own, EB>, Ps>,
			P,
			Ps
		>,
	) => EndpointInfiniteQuery<
		R,
		Fetch.Success<O>,
		Fetch.CallError<O, ErrorSchema<Own, EB>, Ps>,
		P
	>;
	/**
	 * A mutation that calls an endpoint defined with `Fetch.endpoint`. Its
	 * variables are the call's options (`params`, `query`, `body`, …), and
	 * it has a mutation's options, such as `invalidates` and `optimistic`;
	 * nothing is invalidated unless you say so.
	 */
	readonly mutation: <
		const R extends string,
		O extends RegisteredSchema | undefined,
		Own extends RegisteredSchema | undefined,
		I extends RegisteredSchema | undefined,
	>(
		endpoint: Fetch.UnboundEndpoint<R, O, Own, I>,
		options?: EndpointMutationOptions<
			EndpointVariables<R, I, Ps>,
			Fetch.Success<O>,
			Fetch.CallError<O, ErrorSchema<Own, EB>, Ps>,
			Ps
		>,
	) => Mutation.Mutation<
		EndpointVariables<R, I, Ps>,
		Fetch.Success<O>,
		Fetch.CallError<O, ErrorSchema<Own, EB>, Ps>
	>;
}

/** A definition or bound endpoint as the adapter uses it, whatever its types. */
interface AnyEndpoint {
	readonly method: string;
	readonly path: string;
	readonly output: Fetch.AnySchema | undefined;
	readonly error: Fetch.AnySchema | undefined;
}

type Call = (options: unknown) => Effect.Effect<unknown, unknown, never>;

interface AnyClient {
	readonly bind: (endpoint: AnyEndpoint, options: unknown) => Call;
}

/**
 * Turns `Fetch.endpoint` definitions into queries and mutations that call
 * them through your effetch client, which a service holds: give it that
 * service. Use it at module level, next to the definitions: the client is
 * only reached when a query fetches or a mutation runs, from your services
 * (so the service must be in `Register["services"]`).
 *
 * The adapter adds no behaviour of its own: a query is a
 * {@link Query.family} member keyed by its route, and a mutation is a
 * {@link Mutation.make} whose `run` calls the endpoint. It needs
 * `@monarcode/effetch` 0.1.
 *
 * @example
 * ```ts
 * import * as Fetch from "@monarcode/effetch";
 * import * as Context from "effect/Context";
 * import * as Schema from "effect/Schema";
 *
 * import { Query } from "@monarcode/effetch-query";
 * import { endpoints } from "@monarcode/effetch-query/effetch";
 *
 * const ApiError = Schema.Struct({ message: Schema.String });
 *
 * class AppApiClient extends Context.Service<
 *   AppApiClient,
 *   Fetch.Client<[], typeof ApiError>
 * >()("AppApiClient") {}
 *
 * declare module "@monarcode/effetch-query" {
 *   interface Register {
 *     readonly services: AppApiClient;
 *   }
 * }
 *
 * const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });
 * const getTodo = Fetch.endpoint("GET /todos/:id", { output: Todo });
 * const createTodo = Fetch.endpoint("POST /todos", {
 *   input: Schema.Struct({ title: Schema.String }),
 *   output: Todo,
 * });
 *
 * const api = endpoints(AppApiClient, { defaultError: ApiError });
 *
 * // todo({ params: { id: 1 } }) is the query keyed ["todos", 1]
 * export const todo = api.query(getTodo, { staleTime: "1 minute" });
 *
 * // run with { body: { title } }; every todos query refetches after
 * export const addTodo = api.mutation(createTodo, { invalidates: [["todos"]] });
 *
 * // refetches every todo({ params }), not the other todos endpoints
 * export const refreshTodos = Query.refetch(todo);
 * ```
 *
 * @since 0.1.0
 */
export const endpoints = <
	Id extends QueryClient.Requirements,
	Ps extends ReadonlyArray<Fetch.Plugin.Any>,
	EB extends RegisteredSchema,
>(
	client: Context.Key<Id, Fetch.Client<Ps, EB>>,
	options?: EndpointsOptions<NoInfer<EB>>,
): Endpoints<Ps, EB> => {
	const prefix = options?.key ?? [];
	// The types above check each call against the client's; past them, one
	// untyped path serves every endpoint.
	const reach = client as unknown as Effect.Effect<AnyClient>;
	const call = (endpoint: AnyEndpoint, bind: Fetch.BindOptions<Ps>) => {
		const bound = new WeakMap<AnyClient, Call>();
		return (args: unknown) =>
			Effect.flatMap(reach, (api) => {
				const send = bound.get(api) ?? api.bind(endpoint, bind);
				bound.set(api, send);
				return send(args);
			});
	};
	// Calls with the same arguments after `toArgs` share a query.
	const endpointFamily = (
		endpoint: AnyEndpoint,
		path: ReadonlyArray<Segment>,
		toArgs: (args: RouteArgs | undefined) => RouteArgs,
		member: (args: RouteArgs, family: object) => Query.Query<any, any>,
	) => {
		const family = Atom.family((args: RouteArgs) => member(args, self));
		const self = Object.assign((args?: RouteArgs) => family(toArgs(args)), {
			key: routeKeyPrefix(prefix, path),
			// Keys can't tell `/todos/:id` from `/todos/comments`, so a family
			// matches the queries it made.
			[KeyMatcherId]: (query: Query.Query<any, any>) =>
				isMember(query, self),
			endpoint,
			error: endpoint.error ?? options?.defaultError,
		});
		return self;
	};
	// An endpoint's queries cross the wire with its `output` and effetch's
	// errors, keyed apart by method: `GET` and `HEAD` of one path share keys.
	const hydrationOf = (
		endpoint: AnyEndpoint,
		schema: (
			output: Schema.Codec<unknown, unknown>,
			error: Schema.Codec<unknown, unknown>,
		) => Query.Schema<any, any>,
	) =>
		endpoint.output === undefined
			? undefined
			: {
					codec: makeCodec(
						schema(
							endpoint.output as Schema.Codec<unknown, unknown>,
							wireErrors(
								(endpoint.error ?? options?.defaultError) as
									| Schema.Codec<unknown, unknown>
									| undefined,
							),
						),
					),
					kind: endpoint.method === "GET" ? undefined : endpoint.method,
				};
	const query = (
		endpoint: AnyEndpoint,
		queryOptions?: EndpointQueryOptions<unknown, Ps>,
	) => {
		const { headers, plugins, ...rest } = queryOptions ?? {};
		const fetch = call(endpoint, { headers, plugins });
		const path = segments(endpoint.path);
		const hydration = hydrationOf(endpoint, (success, error) => ({
			success,
			error,
		}));
		return endpointFamily(
			endpoint,
			path,
			(args) => canonicalArgs(path, args),
			(args, family) =>
				makeQuery({
					key: routeKey(prefix, path, args),
					fetch: runOnce(() => fetch(args)),
					options: rest,
					member: { family, args },
					hydration,
				}),
		);
	};
	const infiniteQuery = (
		endpoint: AnyEndpoint,
		queryOptions: EndpointInfiniteQueryOptions<unknown, unknown, unknown, Ps>,
	) => {
		const {
			headers,
			plugins,
			pageParam: field,
			initialPageParam,
			nextPageParam,
			previousPageParam,
			maxPages,
			...rest
		} = queryOptions;
		const fetch = call(endpoint, { headers, plugins });
		const path = segments(endpoint.path);
		const pages = {
			initialPageParam,
			nextPageParam,
			previousPageParam,
			maxPages,
		};
		const hydration = hydrationOf(endpoint, (page, error) =>
			infiniteSchema({ page, error }),
		);
		return endpointFamily(
			endpoint,
			path,
			(args) => withoutQueryField(canonicalArgs(path, args), field),
			(args, family) =>
				makeInfiniteQuery({
					key: routeKey(prefix, path, args),
					run: (page: unknown) =>
						fetch({ ...args, query: { ...args.query, [field]: page } }),
					pages,
					options: rest,
					member: { family, args },
					hydration,
				}),
		);
	};
	const mutation = (
		endpoint: AnyEndpoint,
		mutationOptions?: EndpointMutationOptions<unknown, unknown, unknown, Ps>,
	) => {
		const { headers, plugins, ...rest } = mutationOptions ?? {};
		return Mutation.make({
			...rest,
			run: call(endpoint, { headers, plugins }),
		});
	};
	return { query, infiniteQuery, mutation } as unknown as Endpoints<Ps, EB>;
};
