import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type * as Scope from "effect/Scope";

import type * as InfiniteQuery from "../InfiniteQuery.js";
import type * as Query from "../Query.js";
import type * as QueryClient from "../QueryClient.js";
import { fetchValue } from "./cache.js";
import { type Member, makeQuery, nodeValue, peek } from "./queryAtom.js";
import { forkWithClient } from "./runtime.js";

export const InfiniteQueryTypeId =
	"~@monarcode/effetch-query/InfiniteQuery" as const;
export type InfiniteQueryTypeId = typeof InfiniteQueryTypeId;

const PagingId = "~@monarcode/effetch-query/InfiniteQuery/paging";

export type Direction = "next" | "previous";

/**
 * A page asked for with `fetchNextPage` / `fetchPreviousPage`: requested,
 * then running once the fetch atom picks it up. Any other build of the
 * fetch atom is a refetch of every page, and replaces it.
 */
export type Paging =
	| { readonly _tag: "Idle" }
	| { readonly _tag: "Requested" | "Running"; readonly direction: Direction };

const idle: Paging = { _tag: "Idle" };

export interface Pages<A, P> {
	readonly initialPageParam: P;
	readonly nextPageParam: InfiniteQuery.PageParamFunction<A, P>;
	readonly previousPageParam?:
		| InfiniteQuery.PageParamFunction<A, P>
		| undefined;
	readonly maxPages?: number | undefined;
}

interface PagingInternals<A, P> {
	readonly paging: Atom.Writable<Paging>;
	readonly pages: Pages<A, P>;
}

type InfiniteWithPaging<A, E, P> = InfiniteQuery.InfiniteQuery<A, E, P> & {
	readonly [PagingId]: PagingInternals<A, P>;
};

const pagingOf = <A, E, P>(
	query: InfiniteQuery.InfiniteQuery<A, E, P>,
): PagingInternals<A, P> => (query as InfiniteWithPaging<A, E, P>)[PagingId];

export const isInfiniteQuery = (
	value: unknown,
): value is InfiniteQuery.InfiniteQuery<unknown, unknown, unknown> =>
	Atom.isAtom(value) && InfiniteQueryTypeId in value;

/**
 * The param of the page after the last one, or before the first: none when
 * the param function gives `undefined` or `null`, as in TanStack.
 */
export const pageParam = <A, P>(
	pages: Pages<A, P>,
	data: InfiniteQuery.InfiniteData<A, P>,
	direction: Direction,
): Option.Option<P> => {
	const { pages: loaded, pageParams } = data;
	if (loaded.length === 0) {
		return Option.none();
	}
	if (direction === "next") {
		const last = loaded.length - 1;
		return Option.fromNullishOr(
			pages.nextPageParam(
				loaded[last]!,
				loaded,
				pageParams[last]!,
				pageParams,
			),
		);
	}
	return pages.previousPageParam === undefined
		? Option.none()
		: Option.fromNullishOr(
				pages.previousPageParam(
					loaded[0]!,
					loaded,
					pageParams[0]!,
					pageParams,
				),
			);
};

/** Whether there's a page to fetch another from: with none, a fetch starts again from the first. */
const hasPages = (data: InfiniteQuery.InfiniteData<unknown, unknown>) =>
	data.pages.length > 0;

/** Adds a page at one end, dropping one from the other past `maxPages`. */
const addPage = <A, P>(
	pages: Pages<A, P>,
	data: InfiniteQuery.InfiniteData<A, P>,
	direction: Direction,
	page: A,
	param: P,
): InfiniteQuery.InfiniteData<A, P> => {
	const added =
		direction === "next"
			? {
					pages: [...data.pages, page],
					pageParams: [...data.pageParams, param],
				}
			: {
					pages: [page, ...data.pages],
					pageParams: [param, ...data.pageParams],
				};
	const { maxPages = 0 } = pages;
	if (maxPages <= 0 || added.pages.length <= maxPages) {
		return added;
	}
	return direction === "next"
		? { pages: added.pages.slice(1), pageParams: added.pageParams.slice(1) }
		: {
				pages: added.pages.slice(0, -1),
				pageParams: added.pageParams.slice(0, -1),
			};
};

type RunPage<A, E, P> = (
	pageParam: P,
	ctx: Query.RunContext,
) => Effect.Effect<A, E, QueryClient.Requirements | Scope.Scope>;

/**
 * Builds an infinite query (DESIGN.md §3.11): a query whose fetch is a page
 * when one is requested, and otherwise every loaded page again.
 */
export const makeInfiniteQuery = <A, E, P>(definition: {
	readonly key: Query.QueryKey;
	readonly run: RunPage<A, E, P>;
	readonly pages: Pages<A, P>;
	readonly options: Query.Options<E>;
	readonly member?: Member | undefined;
}): InfiniteQuery.InfiniteQuery<A, E, P> => {
	const { key, run, pages, options, member } = definition;
	const paging = Atom.make<Paging>(idle);
	const query = makeQuery<InfiniteQuery.InfiniteData<A, P>, E>({
		key,
		options,
		member,
		// The query keeps `paging` alive without depending on it: a request
		// refetches only through the refresh `fetchPage` makes.
		mounts: [paging],
		fetch: ({ get, previous, attempt }) => {
			const page = (param: P) => attempt((ctx) => run(param, ctx));
			const request = get.once(paging);
			const shown = previous();
			if (
				request._tag === "Requested" &&
				Option.isSome(shown) &&
				hasPages(shown.value)
			) {
				const { direction } = request;
				const running: Paging = { _tag: "Running", direction };
				get.set(paging, running);
				const data = shown.value;
				// `pageParam` runs user code: in the Effect, a throw is a defect.
				const fetch = Effect.suspend(() =>
					Option.match(pageParam(pages, data, direction), {
						onNone: () => Effect.succeed(data),
						// Added to the data shown when it lands, so a write made
						// while it loaded stays.
						onSome: (param) =>
							Effect.map(page(param), (loaded) =>
								addPage(
									pages,
									Option.getOrElse(previous(), () => data),
									direction,
									loaded,
									param,
								),
							),
					}),
				);
				return Effect.onExit(fetch, (exit) =>
					Effect.sync(() => {
						// An interrupted page was replaced by a refetch or a reset,
						// whose build has cleared the request already.
						if (
							!Exit.hasInterrupts(exit) &&
							Option.getOrUndefined(nodeValue(get.registry, paging)) ===
								running
						) {
							get.registry.set(paging, idle);
						}
					}),
				);
			}
			if (request._tag !== "Idle") {
				get.set(paging, idle);
			}
			return refetchPages(pages, shown, page);
		},
	});
	return Object.assign(query, {
		[InfiniteQueryTypeId]: InfiniteQueryTypeId,
		[PagingId]: { paging, pages },
	}) as InfiniteWithPaging<A, E, P>;
};

/**
 * Fetches as many pages as are loaded (at least one), one after the other:
 * the first from its stored param (`initialPageParam` with none), each later
 * one from `nextPageParam` of the page before, as TanStack v5 does, so
 * cursors stay consistent when the list changed. Stops early when there's
 * no next page.
 */
const refetchPages = <A, E, P>(
	pages: Pages<A, P>,
	shown: Option.Option<InfiniteQuery.InfiniteData<A, P>>,
	page: (param: P) => Effect.Effect<A, E, QueryClient.Requirements>,
): Effect.Effect<
	InfiniteQuery.InfiniteData<A, P>,
	E,
	QueryClient.Requirements
> =>
	Effect.gen(function* () {
		const loaded = Option.getOrUndefined(shown);
		const count = Math.max(1, loaded?.pages.length ?? 0);
		let param =
			loaded !== undefined && loaded.pageParams.length > 0
				? loaded.pageParams[0]!
				: pages.initialPageParam;
		let data: InfiniteQuery.InfiniteData<A, P> = {
			pages: [],
			pageParams: [],
		};
		for (;;) {
			const fetched = yield* page(param);
			data = {
				pages: [...data.pages, fetched],
				pageParams: [...data.pageParams, param],
			};
			if (data.pages.length >= count) {
				return data;
			}
			const next = pageParam(pages, data, "next");
			if (Option.isNone(next)) {
				return data;
			}
			param = next.value;
		}
	});

/**
 * Fetches the page after the last one, or before the first (DESIGN.md
 * §3.11). Joins a fetch of a page in the same direction, and waits for any
 * other fetch first. Without data it's the query's first fetch (joined while
 * it runs), and with no pages a fetch from the first page, as in TanStack;
 * without a page there it returns the data as it is.
 */
export const fetchPage = <A, E, P>(
	registry: AtomRegistry.AtomRegistry,
	query: InfiniteQuery.InfiniteQuery<A, E, P>,
	direction: Direction,
): Effect.Effect<InfiniteQuery.InfiniteData<A, P>, E> =>
	Effect.suspend(() => {
		const current = peek(registry, query);
		if (Option.isNone(current)) {
			return fetchValue(registry, query);
		}
		const { paging, pages } = pagingOf(query);
		const settle = AtomRegistry.getResult(registry, query, {
			suspendOnWaiting: true,
		});
		const data = AsyncResult.value(current.value);
		if (current.value.waiting) {
			const request = Option.getOrElse(
				nodeValue(registry, paging),
				() => idle,
			);
			const joins =
				Option.isNone(data) ||
				(request._tag !== "Idle" && request.direction === direction);
			return joins
				? settle
				: Effect.andThen(
						Effect.exit(settle),
						fetchPage(registry, query, direction),
					);
		}
		if (Option.isNone(data)) {
			return fetchValue(registry, query);
		}
		if (!hasPages(data.value)) {
			registry.refresh(query);
			return settle;
		}
		if (Option.isNone(pageParam(pages, data.value, direction))) {
			return Effect.succeed(data.value);
		}
		registry.set(paging, { _tag: "Requested", direction });
		registry.refresh(query);
		return settle;
	});

/**
 * What a reader of an infinite query shows besides its result
 * (`useInfiniteQuery`): whether there's a page at either end of the shown
 * data, and whether one is being fetched.
 */
export interface PageState {
	readonly hasNextPage: boolean;
	readonly hasPreviousPage: boolean;
	readonly isFetchingNextPage: boolean;
	readonly isFetchingPreviousPage: boolean;
}

const noPages: PageState = {
	hasNextPage: false,
	hasPreviousPage: false,
	isFetchingNextPage: false,
	isFetchingPreviousPage: false,
};

/** An infinite query's paging atom: readers subscribe to it for {@link pageState}. */
export const pagingAtom = (
	query: InfiniteQuery.InfiniteQuery<any, any, any> | null,
): Atom.Atom<Paging> => (query === null ? idlePaging : pagingOf(query).paging);

const idlePaging = Atom.readable((): Paging => idle);

/** The {@link PageState} of a result, given its query's paging atom's value. */
export const pageState = <A, E, P>(
	query: InfiniteQuery.InfiniteQuery<A, E, P> | null,
	result: AsyncResult.AsyncResult<InfiniteQuery.InfiniteData<A, P>, E>,
	paging: Paging,
): PageState => {
	const data = AsyncResult.value(result);
	if (query === null || Option.isNone(data)) {
		return noPages;
	}
	const { pages } = pagingOf(query);
	const fetching = (direction: Direction) =>
		result.waiting &&
		paging._tag === "Running" &&
		paging.direction === direction;
	return {
		hasNextPage: Option.isSome(pageParam(pages, data.value, "next")),
		hasPreviousPage: Option.isSome(pageParam(pages, data.value, "previous")),
		isFetchingNextPage: fetching("next"),
		isFetchingPreviousPage: fetching("previous"),
	};
};

/**
 * Fetches a page for a reader, such as `useInfiniteQuery`'s `fetchNextPage`.
 * Resolves when it settles; never rejects, since a failure shows in the
 * query's result. Resolves at once once the client is disposed.
 */
export const fetchPageFor = (
	registry: AtomRegistry.AtomRegistry,
	query: InfiniteQuery.InfiniteQuery<any, any, any>,
	direction: Direction,
): Promise<void> => {
	let fiber;
	try {
		fiber = forkWithClient(
			registry,
			Effect.ignore(fetchPage(registry, query, direction)),
		);
	} catch {
		// The registry throws once its client is disposed: nothing to fetch.
		return Promise.resolve();
	}
	return new Promise((resolve) => fiber.addObserver(() => resolve()));
};
