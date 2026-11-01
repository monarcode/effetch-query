import type * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import type * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import { infiniteSchema, makeCodec } from "./internal/hydration.js";
import * as internal from "./internal/infiniteQuery.js";
import type * as Query from "./Query.js";
import * as QueryClient from "./QueryClient.js";

/**
 * The type of {@link InfiniteQueryTypeId}, the property that marks an
 * {@link InfiniteQuery}.
 *
 * @example
 * ```ts
 * import { InfiniteQuery } from "@monarcode/effetch-query";
 *
 * export const id: InfiniteQuery.InfiniteQueryTypeId =
 *   InfiniteQuery.InfiniteQueryTypeId;
 * ```
 *
 * @since 0.1.0
 */
export type InfiniteQueryTypeId = internal.InfiniteQueryTypeId;

/**
 * The property that marks an {@link InfiniteQuery}, so it can be told apart
 * from other queries.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { InfiniteQuery } from "@monarcode/effetch-query";
 *
 * const pages = InfiniteQuery.make({
 *   key: ["numbers"],
 *   initialPageParam: 0,
 *   run: (page: number) => Effect.succeed([page]),
 *   nextPageParam: (_, __, page) => page + 1,
 * });
 *
 * console.log(InfiniteQuery.InfiniteQueryTypeId in pages); // true
 * ```
 *
 * @see {@link isInfiniteQuery} to check a value
 *
 * @since 0.1.0
 */
export const InfiniteQueryTypeId: InfiniteQueryTypeId =
	internal.InfiniteQueryTypeId;

/**
 * Whether a value is an {@link InfiniteQuery}, as opposed to a plain query
 * or another atom.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { InfiniteQuery, Query } from "@monarcode/effetch-query";
 *
 * const pages = InfiniteQuery.make({
 *   key: ["numbers"],
 *   initialPageParam: 0,
 *   run: (page: number) => Effect.succeed([page]),
 *   nextPageParam: (_, __, page) => page + 1,
 * });
 * const me = Query.make({ key: ["me"], run: Effect.succeed("Ada") });
 *
 * InfiniteQuery.isInfiniteQuery(pages); // true
 * InfiniteQuery.isInfiniteQuery(me); // false
 * ```
 *
 * @since 0.1.0
 */
export const isInfiniteQuery: (
	value: unknown,
) => value is InfiniteQuery<unknown, unknown, unknown> =
	internal.isInfiniteQuery;

/**
 * What an {@link InfiniteQuery} holds: the pages loaded so far, in order,
 * and the param each was fetched with.
 *
 * @example
 * ```ts
 * import type { InfiniteQuery } from "@monarcode/effetch-query";
 *
 * export const data: InfiniteQuery.InfiniteData<ReadonlyArray<string>, number> = {
 *   pages: [["a", "b"], ["c"]],
 *   pageParams: [0, 2],
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface InfiniteData<A, P> {
	/** The pages, first to last. */
	readonly pages: ReadonlyArray<A>;
	/** The param each page was fetched with, in the same order. */
	readonly pageParams: ReadonlyArray<P>;
}

/**
 * A query whose value is a list of pages, for "load more" lists and
 * infinite scroll, as TanStack's `useInfiniteQuery`. Create one with
 * {@link make}, or one per argument with {@link family}.
 *
 * It **is** a {@link Query.Query} of {@link InfiniteData}, so the whole
 * cache API works on it: {@link Query.invalidate} and {@link Query.refetch}
 * fetch its pages again, {@link Query.set} and {@link Query.update} write
 * them (optimistic writes too). {@link fetchNextPage} and
 * {@link fetchPreviousPage} add a page at either end.
 *
 * A refetch fetches as many pages as are loaded, one after the other, and
 * shows them together: the first from its stored param, each later one from
 * `nextPageParam` of the page before it, so cursors stay consistent when
 * the list has changed. A page that fails keeps the loaded pages: the query
 * becomes a failure whose `previousSuccess` holds them.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { InfiniteQuery } from "@monarcode/effetch-query";
 *
 * declare const pages: InfiniteQuery.InfiniteQuery<
 *   ReadonlyArray<string>,
 *   never,
 *   number
 * >;
 *
 * export const titles = Effect.map(InfiniteQuery.fetchNextPage(pages), (data) =>
 *   data.pages.flat(),
 * );
 * ```
 *
 * @since 0.1.0
 */
export interface InfiniteQuery<A, E, P> extends Query.Query<
	InfiniteData<A, P>,
	E
> {
	/** Marks the query as an infinite query. */
	readonly [InfiniteQueryTypeId]: InfiniteQueryTypeId;
}

/**
 * Makes one {@link InfiniteQuery} per argument, as {@link Query.family}
 * does: the same query for arguments that are `Equal.equals`, keyed by the
 * family's key with the argument appended. It's a {@link Query.QueryFamily},
 * so it's a target for {@link Query.invalidate}, and {@link Query.update}
 * writes every cached member.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import type { InfiniteQuery } from "@monarcode/effetch-query";
 *
 * declare const pages: InfiniteQuery.InfiniteQueryFamily<
 *   { readonly limit: number },
 *   ReadonlyArray<string>,
 *   never,
 *   number
 * >;
 *
 * export const first = pages({ limit: 20 }); // key [..., { limit: 20 }]
 * ```
 *
 * @since 0.1.0
 */
export interface InfiniteQueryFamily<Args, A, E, P> extends Query.QueryFamily<
	Args,
	InfiniteData<A, P>,
	E
> {
	(args: Args): InfiniteQuery<A, E, P>;
}

/**
 * Finds the param of the page after the last one (`nextPageParam`) or
 * before the first (`previousPageParam`), from that page, every page, its
 * param and every param. Return `undefined` or `null` when there's no such
 * page, as in TanStack.
 *
 * @example
 * ```ts
 * import type { InfiniteQuery } from "@monarcode/effetch-query";
 *
 * interface Page {
 *   readonly items: ReadonlyArray<string>;
 *   readonly nextCursor: string | null;
 * }
 *
 * export const nextPageParam: InfiniteQuery.PageParamFunction<Page, string> = (
 *   lastPage,
 * ) => lastPage.nextCursor;
 * ```
 *
 * @since 0.1.0
 */
export type PageParamFunction<A, P> = (
	page: A,
	pages: ReadonlyArray<A>,
	pageParam: P,
	pageParams: ReadonlyArray<P>,
) => P | undefined | null;

/**
 * How an infinite query finds its pages, in {@link MakeOptions} and
 * {@link FamilyOptions}.
 *
 * @example
 * ```ts
 * import type { InfiniteQuery } from "@monarcode/effetch-query";
 *
 * interface Page {
 *   readonly skip: number;
 *   readonly limit: number;
 *   readonly total: number;
 * }
 *
 * export const paging: InfiniteQuery.PageOptions<Page, number> = {
 *   initialPageParam: 0,
 *   nextPageParam: (last) =>
 *     last.skip + last.limit < last.total ? last.skip + last.limit : undefined,
 *   previousPageParam: (first) =>
 *     first.skip > 0 ? Math.max(0, first.skip - first.limit) : undefined,
 *   maxPages: 10,
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface PageOptions<A, P> {
	/** The first page's param. */
	readonly initialPageParam: P;
	/** The param of the page after the last one, or `undefined` / `null` for none. */
	readonly nextPageParam: PageParamFunction<A, NoInfer<P>>;
	/**
	 * The param of the page before the first one, or `undefined` / `null` for
	 * none. Without it, there's no previous page.
	 */
	readonly previousPageParam?: PageParamFunction<A, NoInfer<P>> | undefined;
	/**
	 * The most pages to keep. Past it, a page is dropped from the far end: the
	 * first when a next page loads, the last when a previous page does. Give
	 * `previousPageParam` too, so the dropped pages can load again. Default:
	 * no limit.
	 */
	readonly maxPages?: number | undefined;
}

/**
 * How an infinite query's pages are sent from the server to the browser, as
 * {@link Query.QuerySchema} for a query: Schemas for a page and, to send
 * failures too, the error. The page params go as they are, so they must be
 * JSON values (strings, numbers, booleans, `null`), unless `pageParam`
 * names their schema; a query whose params don't fit isn't sent.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema";
 *
 * import type { InfiniteQuery } from "@monarcode/effetch-query";
 *
 * const Page = Schema.Struct({
 *   items: Schema.Array(Schema.String),
 *   nextCursor: Schema.NullOr(Schema.String),
 * });
 *
 * export const schema: InfiniteQuery.PageSchema<typeof Page.Type, never, string | null> = {
 *   page: Page,
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface PageSchema<A, E, P> {
	/** A page's schema. */
	readonly page: Schema.Codec<A, unknown>;
	/** The page params' schema, for params that aren't JSON values. */
	readonly pageParam?: Schema.Codec<P, unknown> | undefined;
	/** The error's schema, needed only to send failures. */
	readonly error?: Schema.Codec<E, unknown> | undefined;
}

/**
 * Options for {@link make}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import type { InfiniteQuery } from "@monarcode/effetch-query";
 *
 * export const options: InfiniteQuery.MakeOptions<ReadonlyArray<number>, never, number> = {
 *   key: ["numbers"],
 *   initialPageParam: 0,
 *   run: (page) => Effect.succeed([page]),
 *   nextPageParam: (_, __, page) => (page < 9 ? page + 1 : undefined),
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface MakeOptions<A, E, P>
	extends Query.Options<E>, PageOptions<A, P> {
	/** The query's key. */
	readonly key: Query.QueryKey;
	/**
	 * Fetches one page from its param. It runs with your services and the
	 * client, and its `Scope` closes when the page settles.
	 */
	readonly run: (
		pageParam: P,
		ctx: Query.RunContext,
	) => Effect.Effect<A, E, QueryClient.Requirements | Scope.Scope>;
	/** How the pages cross from server to browser; without one, they fetch in the browser. */
	readonly schema?: PageSchema<A, E, P> | undefined;
}

/**
 * Options for {@link family}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import type { InfiniteQuery } from "@monarcode/effetch-query";
 *
 * export const options: InfiniteQuery.FamilyOptions<
 *   { readonly size: number },
 *   ReadonlyArray<number>,
 *   never,
 *   number
 * > = {
 *   key: ["numbers"],
 *   initialPageParam: 0,
 *   run: ({ size }, page) => Effect.succeed([page * size]),
 *   nextPageParam: (_, __, page) => page + 1,
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface FamilyOptions<Args, A, E, P>
	extends Query.Options<E>, PageOptions<A, P> {
	/** The family's key. Each member appends its argument. */
	readonly key: Query.QueryKey;
	/**
	 * Fetches one page of one member from its argument and the page's param.
	 * It runs with your services and the client, and its `Scope` closes when
	 * the page settles.
	 */
	readonly run: (
		args: Args,
		pageParam: P,
		ctx: Query.RunContext,
	) => Effect.Effect<A, E, QueryClient.Requirements | Scope.Scope>;
	/** How each member's pages cross from server to browser, as {@link MakeOptions.schema}. */
	readonly schema?: PageSchema<A, E, P> | undefined;
}

const hydrationOf = <A, E, P>(schema: PageSchema<A, E, P> | undefined) =>
	schema && { codec: makeCodec(infiniteSchema(schema)) };

const pageOptions = <A, P>(
	options: PageOptions<A, P>,
): internal.Pages<A, P> => ({
	initialPageParam: options.initialPageParam,
	nextPageParam: options.nextPageParam,
	previousPageParam: options.previousPageParam,
	maxPages: options.maxPages,
});

/**
 * Defines an {@link InfiniteQuery} with no arguments. Nothing is fetched
 * until it's used; then its first page, from `initialPageParam`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { InfiniteQuery } from "@monarcode/effetch-query";
 *
 * interface Page {
 *   readonly items: ReadonlyArray<string>;
 *   readonly nextCursor: string | null;
 * }
 *
 * declare const feedPage: (cursor: string | null) => Effect.Effect<Page>;
 *
 * export const feed = InfiniteQuery.make({
 *   key: ["feed"],
 *   initialPageParam: null as string | null,
 *   run: (cursor) => feedPage(cursor),
 *   nextPageParam: (lastPage) => lastPage.nextCursor,
 * });
 * ```
 *
 * @see {@link family} for an infinite query per argument
 *
 * @since 0.1.0
 */
export const make = <A, E, P>(
	options: MakeOptions<A, E, P>,
): InfiniteQuery<A, E, P> =>
	internal.makeInfiniteQuery({
		key: options.key,
		run: options.run,
		pages: pageOptions(options),
		options,
		hydration: hydrationOf(options.schema),
	});

/**
 * Defines an {@link InfiniteQueryFamily}: one {@link InfiniteQuery} per
 * argument, each with its own pages.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { InfiniteQuery } from "@monarcode/effetch-query";
 *
 * interface TodosPage {
 *   readonly todos: ReadonlyArray<string>;
 *   readonly skip: number;
 *   readonly limit: number;
 *   readonly total: number;
 * }
 *
 * declare const listTodos: (params: {
 *   readonly limit: number;
 *   readonly skip: number;
 * }) => Effect.Effect<TodosPage>;
 *
 * export const todoPages = InfiniteQuery.family({
 *   key: ["todos", "pages"],
 *   initialPageParam: 0,
 *   run: (params: { readonly limit: number }, skip) =>
 *     listTodos({ ...params, skip }),
 *   nextPageParam: (last) =>
 *     last.skip + last.limit < last.total ? last.skip + last.limit : undefined,
 * });
 * ```
 *
 * @since 0.1.0
 */
export const family = <Args, A, E, P>(
	options: FamilyOptions<Args, A, E, P>,
): InfiniteQueryFamily<Args, A, E, P> => {
	const pages = pageOptions(options);
	const hydration = hydrationOf(options.schema);
	const self: InfiniteQueryFamily<Args, A, E, P> = Object.assign(
		Atom.family((args: Args) =>
			internal.makeInfiniteQuery({
				key: [...options.key, args],
				run: (pageParam: P, ctx) => options.run(args, pageParam, ctx),
				pages,
				options,
				member: { family: self, args },
				hydration,
			}),
		),
		{ key: options.key },
	);
	return self;
};

/**
 * Fetches the page after the last one and appends it, dropping the first
 * page past `maxPages`. Returns the new {@link InfiniteData}, and fails with
 * the query's error if the page fails (the loaded pages stay).
 *
 * - With no next page (`nextPageParam` gives `undefined` or `null`), it
 *   returns the data as it is, without fetching.
 * - Without data, it's the query's first fetch, and joins it while it
 *   runs. With no pages (a write left none), it fetches from the first
 *   page, as TanStack does.
 * - While a next page is being fetched, it joins that fetch; while any
 *   other fetch of the query runs, it waits for it, then fetches its page.
 * - A write made while the page loads stays: the page is added to the data
 *   shown when it lands.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { InfiniteQuery } from "@monarcode/effetch-query";
 *
 * declare const pages: InfiniteQuery.InfiniteQuery<
 *   ReadonlyArray<string>,
 *   never,
 *   number
 * >;
 *
 * export const loadMore = Effect.map(
 *   InfiniteQuery.fetchNextPage(pages),
 *   (data) => data.pages.length,
 * );
 * ```
 *
 * @see {@link fetchPreviousPage} for the page before the first
 *
 * @since 0.1.0
 */
export const fetchNextPage = <A, E, P>(
	query: InfiniteQuery<A, E, P>,
): Effect.Effect<InfiniteData<A, P>, E, QueryClient.QueryClient> =>
	QueryClient.QueryClient.use(({ registry }) =>
		internal.fetchPage(registry, query, "next"),
	);

/**
 * Fetches the page before the first one and prepends it, dropping the last
 * page past `maxPages`. Behaves as {@link fetchNextPage} does, in the other
 * direction; without `previousPageParam` there's never a previous page.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { InfiniteQuery } from "@monarcode/effetch-query";
 *
 * declare const messages: InfiniteQuery.InfiniteQuery<
 *   ReadonlyArray<string>,
 *   never,
 *   string
 * >;
 *
 * // Scrolled to the top of a chat: load older messages.
 * export const loadOlder = InfiniteQuery.fetchPreviousPage(messages);
 * ```
 *
 * @since 0.1.0
 */
export const fetchPreviousPage = <A, E, P>(
	query: InfiniteQuery<A, E, P>,
): Effect.Effect<InfiniteData<A, P>, E, QueryClient.QueryClient> =>
	QueryClient.QueryClient.use(({ registry }) =>
		internal.fetchPage(registry, query, "previous"),
	);
