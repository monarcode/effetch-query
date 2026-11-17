import type * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as HttpMethod from "effect/http/HttpMethod";
import type * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Atom from "effect/reactivity/Atom";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as Fetch from "@monarcode/effetch";

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
import { statusErrorSchemas, wireErrors } from "./wireErrors.js";

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
 * A `statusErrors` map (`Fetch.StatusErrorMap`) whose schemas need nothing
 * outside your registered services, as {@link RegisteredSchema}. The adapter
 * accepts only these, on the client and on each endpoint: its queries and
 * mutations decode the errors, and its queries send them to the browser (the
 * client's only when {@link endpoints} has them, see
 * {@link EndpointsOptions.statusErrors}).
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema";
 *
 * import type { RegisteredStatusErrors } from "@monarcode/effetch-query/effetch";
 *
 * class TodoNotFound extends Schema.TaggedError<TodoNotFound>()("TodoNotFound", {
 *   message: Schema.String,
 * }) {}
 *
 * export const statusErrors = { 404: TodoNotFound } satisfies RegisteredStatusErrors;
 * ```
 *
 * @since 0.1.0
 */
export type RegisteredStatusErrors = {
	readonly [status: number]:
		| RegisteredSchema
		| ReadonlyArray<RegisteredSchema>;
};

/**
 * A `query` schema an endpoint query can be keyed by: one whose encoding
 * needs no services, since a key is encoded when the family is called,
 * outside any Effect. {@link Endpoints.mutation} takes any query schema
 * whose services are registered.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema";
 *
 * import type { KeyQuerySchema } from "@monarcode/effetch-query/effetch";
 *
 * export const Search = Schema.Struct({
 *   due: Schema.optional(Schema.Date),
 * }) satisfies KeyQuerySchema;
 * ```
 *
 * @since 0.1.0
 */
export type KeyQuerySchema = Fetch.QuerySchema & {
	/** What encoding needs: nothing. */
	readonly EncodingServices: never;
};

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
 *   invalidates: "route",
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface EndpointsOptions<
	EB extends Fetch.AnySchema,
	SE extends Fetch.StatusErrorMap | undefined = undefined,
> {
	/**
	 * A prefix put before every key these endpoints make, when another
	 * backend has the same paths: with `["wallet"]`, `GET /accounts/:id` is
	 * `["wallet", "accounts", 1]`. Default: no prefix.
	 */
	readonly key?: Query.Key | undefined;
	/**
	 * The client's `defaultError`, for queries whose endpoint has no `error`
	 * schema of its own: their `HttpError` bodies go to the browser encoded
	 * with it (`QueryClient.dehydrate` with `failures: "include"`), and it's
	 * shown as {@link EndpointQuery.error}. It's typed as the client's.
	 *
	 * Default: for a `Fetch.Service` class, the one it was declared with
	 * (`Api.config`); this option overrides it, as it must for a class whose
	 * `layer` builds its client from another config. A client behind a
	 * `Context.Service` key can't be read until its layer is built, so give
	 * it here. Without one, the client still decodes and types those bodies,
	 * but they go as JSON, so a query whose body isn't JSON isn't sent.
	 */
	readonly defaultError?: EB | undefined;
	/**
	 * The client's `statusErrors`, so its queries can send those errors to
	 * the browser (`QueryClient.dehydrate` with `failures: "include"`). It's
	 * typed as the client's.
	 *
	 * Default: for a `Fetch.Service` class, the ones it was declared with
	 * (`Api.config`); this option overrides them. A client behind a
	 * `Context.Service` key can't be read until its layer is built, so give
	 * them here. Without them, the client's errors are still decoded and
	 * typed, but a query that fails with one isn't sent: the browser fetches
	 * it again.
	 */
	readonly statusErrors?: SE | undefined;
	/**
	 * If `"route"`, a mutation that succeeds invalidates its route's queries,
	 * as {@link Query.invalidate} does: every query whose key starts with the
	 * route's {@link EndpointQuery.key}, the `key` prefix and the path's
	 * literals before its first param. `PATCH /todos/:id` invalidates
	 * `["todos"]`, so `GET /todos` and `GET /todos/:id` refetch, along with
	 * any other query under that key. A route with no param invalidates its
	 * whole path: `POST /todos/reorder` invalidates `["todos", "reorder"]`,
	 * which no list is keyed under, so give it an `invalidates` of its own. A
	 * route that starts with a param invalidates every query under `key`, or
	 * every query on the client without one.
	 *
	 * It invalidates more than a write changes, on purpose: a query
	 * refetched for nothing costs a request, and one left stale shows old
	 * data. A mutation's own `invalidates` replaces it, and `invalidates: []`
	 * turns it off for that mutation. Default: a mutation invalidates only
	 * what its `invalidates` says.
	 */
	readonly invalidates?: "route" | undefined;
}

/**
 * Options for {@link Endpoints.query}: a query's options
 * ({@link Query.Options}), a `placeholder`, `live` updates, and the headers
 * and plugin overrides `client.bind` takes (`Fetch.BindOptions`). `A` is
 * the query's value and `Args` the call's `params` and `query`
 * ({@link EndpointQueryArgs}), which type `placeholder` and `live`;
 * `api.query` sets both from the endpoint.
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
	A = any,
	Args = unknown,
>
	extends Query.Options<E>, Fetch.BindOptions<Ps> {
	/**
	 * A value to show for a query until it has one, from the call's
	 * `params` and `query`, as {@link Query.MakeOptions.placeholder}: an Effect
	 * that returns `Option.some(value)`, or `Option.none()` for nothing.
	 * It gets the route's `params` and the `query` of the call that made the
	 * query: calls that send the same request share one, so a later call's
	 * extra fields, or a query it gives in another form that encodes the
	 * same, aren't seen. Default: none.
	 */
	readonly placeholder?:
		| ((
				args: Args,
		  ) => Effect.Effect<Option.Option<A>, never, QueryClient.Requirements>)
		| undefined;
	/**
	 * The server pushes that keep a query's value up to date, from the call's
	 * `params` and `query`, as {@link Query.MakeOptions.live}: a `Stream` of
	 * functions, each applied to the value. Default: none.
	 */
	readonly live?:
		| ((
				args: Args,
		  ) => Stream.Stream<
				(value: NoInfer<A>) => NoInfer<A>,
				unknown,
				QueryClient.Requirements
		  >)
		| undefined;
}

/**
 * Options for {@link Endpoints.query} with a stream endpoint (`stream:
 * "sse"` or `"ndjson"`): a stream query's options
 * ({@link Query.StreamOptions}), a `placeholder`, and the headers and plugin
 * overrides `client.bind` takes (`Fetch.BindOptions`). `A` is the value,
 * one element of the stream, and `Args` the call's arguments.
 *
 * @example
 * ```ts
 * import * as Schedule from "effect/Schedule";
 *
 * import type { EndpointStreamOptions } from "@monarcode/effetch-query/effetch";
 *
 * export const options: EndpointStreamOptions<unknown, []> = {
 *   retry: Schedule.spaced("1 second"),
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface EndpointStreamOptions<
	E,
	Ps extends ReadonlyArray<Fetch.Plugin.Any>,
	A = never,
	Args = unknown,
>
	extends Query.StreamOptions<E>, Fetch.BindOptions<Ps> {
	/**
	 * A value to show for a query until its first element, from the call's
	 * `params` and `query`, as {@link EndpointQueryOptions.placeholder}.
	 * Default: none.
	 */
	readonly placeholder?:
		| ((
				args: Args,
		  ) => Effect.Effect<Option.Option<A>, never, QueryClient.Requirements>)
		| undefined;
}

/**
 * Options for {@link Endpoints.infiniteQuery}: an infinite query's page
 * options ({@link InfiniteQuery.PageOptions}) and query options
 * ({@link Query.Options}), the query field each page's param is sent in,
 * and the headers and plugin overrides `client.bind` takes
 * (`Fetch.BindOptions`).
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
	QS extends Fetch.QuerySchema | undefined = undefined,
>
	extends
		Query.Options<E>,
		InfiniteQuery.PageOptions<A, P>,
		Fetch.BindOptions<Ps> {
	/**
	 * The query field each page's param is sent in, such as `"cursor"` or
	 * `"skip"`. It's set on every page's request, over the call's own value,
	 * and left out of the key. The param must be a value a query field takes
	 * (`Fetch.QueryValue`), such as a string or a number. With a `query`
	 * schema on the endpoint, it's an optional field of the schema whose type
	 * takes the param ({@link EndpointPageField}).
	 */
	readonly pageParam: EndpointPageField<QS, P>;
}

/**
 * The query fields an infinite query's {@link EndpointInfiniteQueryOptions.pageParam}
 * can name. The param `P` must be a `Fetch.QueryValue`, such as a string or
 * a number, so pages cross to the browser as JSON. Without a `query` schema
 * (`QS` is `undefined`), any field. With one, the schema's optional fields
 * whose type takes `P` (`undefined` aside, for a first page with no cursor):
 * optional, so a call can leave it out.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema";
 *
 * import type { EndpointPageField } from "@monarcode/effetch-query/effetch";
 *
 * const Search = Schema.Struct({
 *   text: Schema.String,
 *   page: Schema.optional(Schema.Finite),
 * });
 *
 * export const field: EndpointPageField<typeof Search, number> = "page";
 * ```
 *
 * @since 0.1.0
 */
export type EndpointPageField<QS extends Fetch.QuerySchema | undefined, P> = [
	P,
] extends [Fetch.QueryValue]
	? [QS] extends [Fetch.QuerySchema]
		? {
				[K in keyof QS["Type"]]-?: {} extends Pick<QS["Type"], K>
					? [Exclude<P, undefined>] extends [
							Exclude<QS["Type"][K], undefined>,
						]
						? K
						: never
					: never;
			}[keyof QS["Type"]] &
				string
		: string
	: never;

/**
 * Options for {@link Endpoints.mutation}: a mutation's options
 * ({@link Mutation.MakeOptions}) without `run`, which is the endpoint, and
 * the headers and plugin overrides `client.bind` takes
 * (`Fetch.BindOptions`).
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
 *   with an `interface` is accepted too. Default: `Fetch.QueryInput`.
 * - `QS`: the endpoint's `query` schema, if it has one: `query` is then the
 *   schema's type, required when the schema has required fields.
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
	QS extends Fetch.QuerySchema | undefined = undefined,
> = Fetch.ParamsOption<Fetch.RoutePath<R>> & Fetch.EndpointQuery<QS, Q>;

/**
 * What a mutation from route `R` takes when run: the endpoint's call
 * options (`params`, `query`, `body`, `headers`, `plugins`), or nothing
 * when none are required. The variables of {@link Endpoints.mutation}.
 *
 * Without a `query` schema (`QS`), its `query` is a `Fetch.QueryInput`,
 * which has an index signature: type a query object you pass with a `type`
 * alias rather than an `interface`. With one, it's the schema's type.
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
	QS extends Fetch.QuerySchema | undefined = undefined,
> =
	Fetch.EndpointArgs<
		R,
		I,
		Fetch.EndpointOptions<R, I, Ps, Fetch.QueryInput, undefined, QS>,
		QS
	> extends [options: infer Options]
		? Options
		: Fetch.EndpointOptions<R, I, Ps, Fetch.QueryInput, undefined, QS> | void;

/**
 * The error schema a bound endpoint decodes error bodies with: its own, or
 * the client's `defaultError` (see {@link EndpointsOptions.defaultError}).
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema";
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
 * A family of queries, one per call of an Effetch endpoint, made by
 * {@link Endpoints.query}. Call it with the endpoint's `params` and `query`
 * to get the query for that call. Its key is the route's path with the
 * params filled in, then the query object: `GET /todos/:id` called with
 * `{ params: { id: 1 } }` is `["todos", 1]`.
 *
 * Calls that send the same request share a query: what isn't sent doesn't
 * count (`params` the path doesn't name, `null` and `undefined` query
 * values and array items, and arrays left empty). Without a `query` schema,
 * values are otherwise compared as given, so `{ page: 1 }` and
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
 * With a `query` schema on the endpoint (`QS`), `query` is typed by the
 * schema, and the key holds the query as the schema encodes it, as it's
 * sent: each value a string (a `Date` as its ISO string, `2` as `"2"`) and
 * each field by its sent name. Equal requests share a query, and keys stay
 * JSON for server rendering. The query a member was first called with is
 * the one it sends, and the `args` {@link Query.update} gives. A call
 * throws an `EndpointQueryError` (its `_tag`) when its query doesn't match
 * the schema, a field encodes to an object, or a field is `Redacted`: a key
 * would hold the secret and send it to the browser, so send it in a header.
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
export interface EndpointQuery<
	R extends string,
	A,
	E,
	QS extends Fetch.QuerySchema | undefined = undefined,
> {
	/** Returns the query for one call: the same query for the same request. */
	<Q extends Fetch.QueryOf<Q> = Fetch.QueryInput>(
		...args: Fetch.EndpointArgs<R, undefined, EndpointQueryArgs<R, Q, QS>, QS>
	): Query.Query<A, E>;
	/** The start every one of its keys has: the prefix and the path up to its first param. */
	readonly key: Query.Key;
	/** The endpoint definition it calls. */
	readonly endpoint: Fetch.UnboundEndpoint<
		R,
		Fetch.AnySchema | undefined,
		Fetch.AnySchema | undefined,
		Fetch.AnySchema | undefined,
		Fetch.StatusErrorMap | undefined,
		undefined,
		QS
	>;
	/**
	 * The schema error bodies are decoded with: the endpoint's, else the
	 * client's `defaultError` as {@link endpoints} knows it (from its
	 * options, or a `Fetch.Service` class's config), else `undefined` (the
	 * client's applies, but isn't known here).
	 */
	readonly error: Fetch.AnySchema | undefined;
}

/**
 * A family of infinite queries, one per call of an Effetch endpoint, made by
 * {@link Endpoints.infiniteQuery}. Call it with the endpoint's `params` and
 * `query` to get the {@link InfiniteQuery.InfiniteQuery} for that call; a
 * page field given there is ignored. Keys and matching are as for
 * {@link EndpointQuery}.
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
export interface EndpointInfiniteQuery<
	R extends string,
	A,
	E,
	P,
	QS extends Fetch.QuerySchema | undefined = undefined,
> {
	/** Returns the infinite query for one call, as {@link EndpointQuery} does. */
	<Q extends Fetch.QueryOf<Q> = Fetch.QueryInput>(
		...args: Fetch.EndpointArgs<R, undefined, EndpointQueryArgs<R, Q, QS>, QS>
	): InfiniteQuery.InfiniteQuery<A, E, P>;
	/** The start every one of its keys has: the prefix and the path up to its first param. */
	readonly key: Query.Key;
	/** The endpoint definition it calls. */
	readonly endpoint: Fetch.UnboundEndpoint<
		R,
		Fetch.AnySchema | undefined,
		Fetch.AnySchema | undefined,
		Fetch.AnySchema | undefined,
		Fetch.StatusErrorMap | undefined,
		undefined,
		QS
	>;
	/** The schema error bodies are decoded with, as {@link EndpointQuery.error}. */
	readonly error: Fetch.AnySchema | undefined;
}

/**
 * Queries and mutations for one Effetch client, made by {@link endpoints}.
 *
 * @example
 * ```ts
 * import * as Fetch from "@monarcode/effetch";
 * import * as Schema from "effect/Schema";
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
	SE extends Fetch.StatusErrorMap | undefined = undefined,
> {
	/**
	 * Defines a family of queries that call an endpoint defined with
	 * `Fetch.endpoint`, one query per `params` and `query`
	 * ({@link EndpointQuery}). The value is the endpoint's `output` (the raw
	 * `HttpClientResponse` without one), and the error every error the call
	 * can fail with: `NetworkError`, `HttpError` with the decoded error body,
	 * `DecodeError` when it has an `output`, the client's plugins' errors,
	 * and the errors the endpoint's and the client's `statusErrors` decode,
	 * matched by their `_tag` with `Effect.catchTag` or
	 * `AsyncResult.builder`'s `onErrorTag`.
	 *
	 * Only `GET`, `HEAD`, `OPTIONS` and `TRACE` endpoints: a call with a body
	 * is a {@link Endpoints.mutation}, or a {@link Query.family} of your own.
	 * An endpoint with a `query` schema is keyed by the query as it's sent
	 * ({@link EndpointQuery}); its schema can't need services
	 * ({@link KeyQuerySchema}). Not endpoints with `responseMode`: their
	 * calls don't give a value to cache.
	 *
	 * A stream endpoint (`stream: "sse"` or `"ndjson"`) makes stream queries
	 * ({@link Query.stream}): the value is the latest element as Effetch
	 * gives it, a `Fetch.SseEvent` of the `output` for SSE (read its `data`
	 * with `useQuery`'s `select`) or the `output` for NDJSON, and the request
	 * runs while the query is read. Its options are
	 * {@link EndpointStreamOptions}.
	 *
	 * With an `output`, its queries cross from server to browser with no
	 * `schema` to write (`QueryClient.dehydrate`); without one, they aren't
	 * sent. The value goes with `output`, and, with `failures: "include"`,
	 * Effetch's errors go too: an `HttpError` without its headers, though
	 * with its request URL and response text, so keep secrets out of the
	 * URLs your server calls; a `NetworkError` without its `cause`; a
	 * `DecodeError` without its `issue`. Errors from `statusErrors` go as
	 * their schemas encode them, the client's only when {@link endpoints}
	 * has them: read from a `Fetch.Service` class, or given for a
	 * `Context.Service` key ({@link EndpointsOptions.statusErrors}). A query
	 * that failed with a plugin's error isn't sent.
	 */
	readonly query: <
		const R extends `${HttpMethod.HttpMethod.NoBody} ${string}`,
		O extends RegisteredSchema | undefined,
		Own extends RegisteredSchema | undefined,
		I extends RegisteredSchema | undefined,
		OwnSE extends RegisteredStatusErrors | undefined = undefined,
		QS extends KeyQuerySchema | undefined = undefined,
		St extends Fetch.StreamFormat | undefined = undefined,
	>(
		endpoint: Fetch.UnboundEndpoint<R, O, Own, I, OwnSE, undefined, QS, St>,
		options?: [St] extends [Fetch.StreamFormat]
			? EndpointStreamOptions<
					Fetch.CallError<
						Fetch.AnySchema,
						ErrorSchema<Own, EB>,
						Ps,
						OwnSE | SE
					>,
					Ps,
					Fetch.StreamElement<St, O>,
					EndpointQueryArgs<R, Fetch.QueryInput, QS>
				>
			: EndpointQueryOptions<
					Fetch.CallError<O, ErrorSchema<Own, EB>, Ps, OwnSE | SE>,
					Ps,
					Fetch.Success<O>,
					EndpointQueryArgs<R, Fetch.QueryInput, QS>
				>,
	) => EndpointQuery<
		R,
		[St] extends [Fetch.StreamFormat]
			? Fetch.StreamElement<St, O>
			: Fetch.Success<O>,
		Fetch.CallError<
			[St] extends [Fetch.StreamFormat] ? Fetch.AnySchema : O,
			ErrorSchema<Own, EB>,
			Ps,
			OwnSE | SE
		>,
		QS
	>;
	/**
	 * Defines a family of infinite queries that call an endpoint page by
	 * page, one query per `params` and `query` ({@link EndpointInfiniteQuery}),
	 * as {@link Endpoints.query} makes queries. Each page's param is sent in
	 * the query field `pageParam` names; the value is an
	 * {@link InfiniteQuery.InfiniteData} of the endpoint's `output`, and the
	 * error is {@link Endpoints.query}'s. With a `query` schema, `pageParam`
	 * names one of its optional fields ({@link EndpointPageField}). Only
	 * endpoints without a body. Its queries cross from server to browser as
	 * {@link Endpoints.query}'s do, the page params as JSON.
	 */
	readonly infiniteQuery: <
		const R extends `${HttpMethod.HttpMethod.NoBody} ${string}`,
		O extends RegisteredSchema | undefined,
		Own extends RegisteredSchema | undefined,
		I extends RegisteredSchema | undefined,
		P,
		OwnSE extends RegisteredStatusErrors | undefined = undefined,
		QS extends KeyQuerySchema | undefined = undefined,
	>(
		endpoint: Fetch.UnboundEndpoint<R, O, Own, I, OwnSE, undefined, QS>,
		options: EndpointInfiniteQueryOptions<
			Fetch.Success<O>,
			Fetch.CallError<O, ErrorSchema<Own, EB>, Ps, OwnSE | SE>,
			P,
			Ps,
			QS
		>,
	) => EndpointInfiniteQuery<
		R,
		Fetch.Success<O>,
		Fetch.CallError<O, ErrorSchema<Own, EB>, Ps, OwnSE | SE>,
		P,
		QS
	>;
	/**
	 * Defines a mutation that calls an endpoint defined with
	 * `Fetch.endpoint`, whatever its method. Its variables are the call's
	 * options (`params`, `query`, `body`, …: {@link EndpointVariables}), with
	 * `query` typed by the endpoint's `query` schema if it has one, and
	 * it takes a mutation's options ({@link EndpointMutationOptions}), such
	 * as `invalidates` and `optimistic`. It invalidates what its
	 * `invalidates` says, or with {@link EndpointsOptions.invalidates} set to
	 * `"route"` and no `invalidates` of its own, its route's queries. Its
	 * value and errors are those of {@link Endpoints.query}.
	 */
	readonly mutation: <
		const R extends string,
		O extends RegisteredSchema | undefined,
		Own extends RegisteredSchema | undefined,
		I extends RegisteredSchema | undefined,
		OwnSE extends RegisteredStatusErrors | undefined = undefined,
		QS extends (Fetch.QuerySchema & RegisteredSchema) | undefined = undefined,
	>(
		endpoint: Fetch.UnboundEndpoint<R, O, Own, I, OwnSE, undefined, QS>,
		options?: EndpointMutationOptions<
			EndpointVariables<R, I, Ps, QS>,
			Fetch.Success<O>,
			Fetch.CallError<O, ErrorSchema<Own, EB>, Ps, OwnSE | SE>,
			Ps
		>,
	) => Mutation.Mutation<
		EndpointVariables<R, I, Ps, QS>,
		Fetch.Success<O>,
		Fetch.CallError<O, ErrorSchema<Own, EB>, Ps, OwnSE | SE>
	>;
}

/** A definition or bound endpoint as the adapter uses it, whatever its types. */
interface AnyEndpoint {
	readonly method: string;
	readonly path: string;
	readonly output: Fetch.AnySchema | undefined;
	readonly error: Fetch.AnySchema | undefined;
	readonly statusErrors?: Fetch.StatusErrorMap | undefined;
	readonly query?: Fetch.QuerySchema | undefined;
	readonly stream?: Fetch.StreamFormat | undefined;
}

/**
 * Thrown when a call's `query` can't be part of its key: it doesn't match
 * the endpoint's `query` schema, a field encodes to an object, or a field is
 * `Redacted`, whose secret the key would hold and send to the browser.
 */
class EndpointQueryError extends Data.TaggedError("EndpointQueryError")<{
	readonly route: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

/** A call's arguments as its key holds them, and as the call sends them. */
interface CallArgs {
	readonly key: RouteArgs;
	readonly call: RouteArgs;
}

const isSent = (value: unknown): boolean =>
	Predicate.isString(value) ||
	(Array.isArray(value) && value.every(Predicate.isString));

/**
 * How an endpoint's calls become keys. Without a `query` schema, the key
 * holds the call's arguments as sent (`canonicalArgs`), and the call sends
 * them. With one, the key holds the query encoded as Effetch sends it, each
 * value a string, and the call sends the query as given, for Effetch to
 * encode.
 */
const callArgs = (
	endpoint: AnyEndpoint,
	path: ReadonlyArray<Segment>,
): ((args: RouteArgs | undefined) => CallArgs) => {
	const schema = endpoint.query;
	if (schema === undefined) {
		return (args) => {
			const key = canonicalArgs(path, args);
			return { key, call: key };
		};
	}
	const route = `${endpoint.method} ${endpoint.path}`;
	const encode = Schema.encodeUnknownSync(
		Schema.toCodecStringTree(schema) as unknown as Schema.Codec<
			unknown,
			unknown
		>,
	);
	const fail = (message: string, cause?: unknown): never => {
		throw new EndpointQueryError({
			route,
			message: `Invalid query for ${route}: ${message}`,
			cause,
		});
	};
	return (args) => {
		const query = args?.query ?? {};
		for (const [name, value] of Object.entries(query)) {
			const values: ReadonlyArray<unknown> = Array.isArray(value)
				? value
				: [value];
			if (values.some((item) => Redacted.isRedacted(item))) {
				fail(
					`"${name}" is Redacted, and a key would hold its secret: send it in a header`,
				);
			}
		}
		let encoded: unknown;
		try {
			encoded = encode(query);
		} catch (error) {
			fail("it doesn't match the query schema", error);
		}
		for (const [name, value] of Object.entries(
			encoded as Record<string, unknown>,
		)) {
			// Left out, as Effetch leaves it out of the request.
			if (value !== undefined && !isSent(value)) {
				fail(`"${name}" doesn't encode to a string or a list of strings`);
			}
		}
		const { params } = canonicalArgs(path, { params: args?.params });
		return {
			key: canonicalArgs(path, {
				params,
				query: encoded as RouteArgs["query"],
			}),
			call: {
				...(params === undefined ? {} : { params }),
				...(args?.query === undefined ? {} : { query: args.query }),
			},
		};
	};
};

type Call = (options: unknown) => Effect.Effect<unknown, unknown, never>;

/** What a stream endpoint's query holds: an `SseEvent` of `output`, or `output` itself. */
const elementSchema = (
	output: Schema.Codec<unknown, unknown>,
	stream: Fetch.StreamFormat | undefined,
): Schema.Codec<unknown, unknown> =>
	stream === "sse"
		? (Schema.Struct({
				event: Schema.String,
				id: Schema.UndefinedOr(Schema.String),
				data: output,
			}) as unknown as Schema.Codec<unknown, unknown>)
		: output;

interface AnyClient {
	readonly bind: (endpoint: AnyEndpoint, options: unknown) => Call;
}

/**
 * Turns `Fetch.endpoint` definitions into queries and mutations that call
 * them through your Effetch client: give it the client's service, a
 * `Fetch.Service` class or a `Context.Service` key. Use it at module level,
 * next to the definitions: the client is only reached when a query fetches
 * or a mutation runs, from your services (so the service must be in
 * `Register["services"]`). Returns an {@link Endpoints}, whose `query`,
 * `infiniteQuery` and `mutation` make them.
 *
 * The adapter adds no behaviour of its own: a query is a
 * {@link Query.family} member keyed by its route, and a mutation is a
 * {@link Mutation.make} whose `run` calls the endpoint, and that
 * invalidates its route with {@link EndpointsOptions.invalidates}. From a
 * `Fetch.Service` class it reads the `defaultError` and `statusErrors` the
 * client is made with, to send errors to the browser; from a
 * `Context.Service` key, give them in the options ({@link EndpointsOptions}).
 * The definitions of a `Fetch.Endpoints` class (`TodoApi.definitions`) work
 * as any other. It needs `@monarcode/effetch` 0.1, from `0.1.0-rc.3`.
 *
 * @example
 * ```ts
 * import * as Fetch from "@monarcode/effetch";
 * import * as Schema from "effect/Schema";
 *
 * import { Query } from "@monarcode/effetch-query";
 * import { endpoints } from "@monarcode/effetch-query/effetch";
 *
 * const ApiError = Schema.Struct({ message: Schema.String });
 *
 * class Api extends Fetch.Service<Api>()("Api", {
 *   baseUrl: "https://api.example.com",
 *   defaultError: ApiError,
 * }) {}
 *
 * declare module "@monarcode/effetch-query" {
 *   interface Register {
 *     readonly services: Api;
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
 * const api = endpoints(Api);
 *
 * // todo({ params: { id: 1 } }) is the query keyed ["todos", 1]
 * export const todo = api.query(getTodo, { staleTime: "1 minute" });
 *
 * // run with { body: { title } }; on success, invalidates every todos query
 * export const addTodo = api.mutation(createTodo, { invalidates: [["todos"]] });
 *
 * // refetches the todo({ params }) queries in use, not other todos endpoints'
 * export const refreshTodos = Query.refetch(todo);
 * ```
 *
 * @since 0.1.0
 */
export const endpoints = <
	Id extends QueryClient.Requirements,
	Ps extends ReadonlyArray<Fetch.Plugin.Any>,
	EB extends RegisteredSchema,
	SE extends RegisteredStatusErrors | undefined = undefined,
>(
	client: Context.Key<Id, Fetch.Client<Ps, EB, SE>>,
	options?: EndpointsOptions<NoInfer<EB>, NoInfer<SE>>,
): Endpoints<Ps, EB, SE> => {
	const prefix = options?.key ?? [];
	// A `Fetch.Service` class carries the config its client is made with.
	const config = Fetch.isService(client) ? client.config : undefined;
	const defaultError: Fetch.AnySchema | undefined =
		options?.defaultError ?? config?.defaultError;
	const clientStatusErrors: Fetch.StatusErrorMap | undefined =
		options?.statusErrors ?? config?.statusErrors;
	// The types above check each call against the client's; past them, one
	// untyped path serves every endpoint.
	const reach = client as unknown as Effect.Effect<AnyClient>;
	const call = (endpoint: AnyEndpoint, bind: Fetch.BindOptions<Ps>) => {
		const bound = new WeakMap<AnyClient, Call>();
		return (args: unknown) =>
			Effect.map(reach, (api) => {
				const send = bound.get(api) ?? api.bind(endpoint, bind);
				bound.set(api, send);
				return send(args);
			});
	};
	const callEffect =
		(endpoint: AnyEndpoint, bind: Fetch.BindOptions<Ps>) => (args: unknown) =>
			Effect.flatten(call(endpoint, bind)(args));
	// A stream endpoint's call gives a `Stream`; interrupting it aborts the request.
	const callStream =
		(endpoint: AnyEndpoint, bind: Fetch.BindOptions<Ps>) => (args: unknown) =>
			Stream.unwrap(
				call(endpoint, bind)(args) as unknown as Effect.Effect<
					Stream.Stream<unknown, unknown>
				>,
			);
	// Calls with the same arguments after `toArgs` share a query.
	const endpointFamily = (
		endpoint: AnyEndpoint,
		path: ReadonlyArray<Segment>,
		toArgs: (args: RouteArgs | undefined) => CallArgs,
		member: (
			key: RouteArgs,
			call: RouteArgs,
			family: object,
		) => Query.Query<any, any>,
	) => {
		// The call that makes a member, which the family, keyed by `key`
		// alone, doesn't see: with a query schema, a key can't be decoded
		// back into the query that was given.
		let calling: RouteArgs | undefined;
		const family = Atom.family((key: RouteArgs) =>
			member(key, calling ?? key, self),
		);
		const self = Object.assign(
			(args?: RouteArgs) => {
				const { key, call } = toArgs(args);
				calling = call;
				try {
					return family(key);
				} finally {
					calling = undefined;
				}
			},
			{
				key: routeKeyPrefix(prefix, path),
				// Keys can't tell `/todos/:id` from `/todos/comments`, so a family
				// matches the queries it made.
				[KeyMatcherId]: (query: Query.Query<any, any>) =>
					isMember(query, self),
				endpoint,
				error: endpoint.error ?? defaultError,
			},
		);
		return self;
	};
	// An endpoint's queries cross the wire with its `output`, Effetch's
	// errors and the endpoint's and client's status errors, keyed apart by
	// method: `GET` and `HEAD` of one path share keys.
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
							elementSchema(
								endpoint.output as Schema.Codec<unknown, unknown>,
								endpoint.stream,
							),
							wireErrors(
								(endpoint.error ?? defaultError) as
									| Schema.Codec<unknown, unknown>
									| undefined,
								statusErrorSchemas(
									endpoint.statusErrors,
									clientStatusErrors,
								),
							),
						),
					),
					kind: endpoint.method === "GET" ? undefined : endpoint.method,
				};
	const query = (
		endpoint: AnyEndpoint,
		queryOptions?:
			| EndpointQueryOptions<unknown, Ps, unknown, RouteArgs>
			| EndpointStreamOptions<unknown, Ps, unknown, RouteArgs>,
	) => {
		const {
			headers,
			plugins,
			placeholder,
			live,
			...rest
		}: EndpointQueryOptions<unknown, Ps, unknown, RouteArgs> =
			queryOptions ?? {};
		const path = segments(endpoint.path);
		const hydration = hydrationOf(endpoint, (success, error) => ({
			success,
			error,
		}));
		const fetch = callEffect(endpoint, { headers, plugins });
		const stream =
			endpoint.stream === undefined
				? undefined
				: callStream(endpoint, { headers, plugins });
		return endpointFamily(
			endpoint,
			path,
			callArgs(endpoint, path),
			(key, args, family) =>
				makeQuery({
					key: routeKey(prefix, path, key),
					...(stream === undefined
						? {
								fetch: runOnce(() => fetch(args)),
								live: live && { _tag: "Updates", stream: live(args) },
							}
						: { live: { _tag: "Stream", stream: () => stream(args) } }),
					options: rest,
					member: { family, args },
					hydration,
					placeholder: placeholder?.(args),
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
		const fetch = callEffect(endpoint, { headers, plugins });
		const path = segments(endpoint.path);
		const toArgs = callArgs(endpoint, path);
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
			// The page field goes before encoding: the key has no page, under
			// any name the schema sends it by.
			(args) => toArgs(withoutQueryField(args ?? {}, field)),
			(key, args, family) =>
				makeInfiniteQuery({
					key: routeKey(prefix, path, key),
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
			invalidates:
				rest.invalidates ??
				(options?.invalidates === "route"
					? [routeKeyPrefix(prefix, segments(endpoint.path))]
					: undefined),
			run: callEffect(endpoint, { headers, plugins }),
		});
	};
	return { query, infiniteQuery, mutation } as unknown as Endpoints<
		Ps,
		EB,
		SE
	>;
};
