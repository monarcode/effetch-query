"use client";

import { useAtomValue } from "@effect/atom-react";
import * as Duration from "effect/Duration";
import type * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import * as React from "react";

import type * as InfiniteQuery from "../InfiniteQuery.js";
import {
	fetchPageFor,
	pageState,
	pagingAtom,
} from "../internal/infiniteQuery.js";
import { makeHandle } from "../internal/mutationHandle.js";
import { makeQueryUse } from "../internal/queryUse.js";
import { makeRefetchHandle } from "../internal/refetchHandle.js";
import type * as Mutation from "../Mutation.js";
import type * as Query from "../Query.js";
import { QueryFailure } from "../QueryFailure.js";
import { useRegistry } from "./QueryProvider.js";

const idle = Atom.readable(() => AsyncResult.initial<never, never>());

// TanStack's floor for suspense: a value a reader just suspended on isn't
// refetched as it mounts.
const suspenseStaleTime = Duration.seconds(1);

/**
 * Keeps a core handle while its inputs stay the same, and makes a new one
 * when they change. State, unlike `useMemo`, which React may drop, so a
 * handle's state lasts as long as the component.
 */
const useHandle = <H>(make: () => H, inputs: ReadonlyArray<unknown>): H => {
	const [held, setHeld] = React.useState(() => ({ inputs, handle: make() }));
	if (
		held.inputs.length === inputs.length &&
		held.inputs.every((input, index) => Object.is(input, inputs[index]))
	) {
		return held.handle;
	}
	const next = { inputs, handle: make() };
	setHeld(next);
	return next.handle;
};

/**
 * Options for {@link useQuery}.
 *
 * @example
 * ```ts
 * import type { UseQueryOptions } from "@monarcode/effetch-query/react";
 *
 * export const options: UseQueryOptions = { keepPrevious: true };
 * ```
 *
 * @since 0.1.0
 */
export interface UseQueryOptions {
	/**
	 * While the query has no value yet (say, the next page of a family),
	 * show the last success this hook showed, as a waiting `Success`, instead
	 * of `Initial`. TanStack's `placeholderData: keepPreviousData`. A failure
	 * is shown as it is. Default: `false`.
	 */
	readonly keepPrevious?: boolean | undefined;
}

/**
 * Reads a query and keeps it up to date while the component is mounted. On
 * mount it refetches the query if it's stale (`refetchOnMount`) or failed
 * (`retryOnMount`), and while mounted it refetches on focus, reconnect and
 * `refetchInterval` as the query's options say.
 *
 * Pass `null` to read nothing: it returns `AsyncResult.initial()` and fetches
 * nothing (TanStack's `enabled: false`). In a server render it reads only the
 * cache and never starts a fetch.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import * as AsyncResult from "effect/reactivity/AsyncResult";
 *
 * import { Query } from "@monarcode/effetch-query";
 * import { useQuery } from "@monarcode/effetch-query/react";
 *
 * const todo = Query.family({
 *   key: ["todos", "detail"],
 *   run: (id: number) => Effect.succeed({ id, title: "Buy milk" }),
 * });
 *
 * export const useTitle = (id: number | null) =>
 *   AsyncResult.getOrElse(
 *     useQuery(id === null ? null : todo(id)),
 *     () => ({ title: "" }),
 *   ).title;
 * ```
 *
 * @see {@link useSuspenseQuery} to suspend until there's a value
 *
 * @since 0.1.0
 */
export const useQuery = <A, E>(
	query: Query.Query<A, E> | null,
	options?: UseQueryOptions | undefined,
): AsyncResult.AsyncResult<A, E> => {
	const registry = useRegistry();
	const use = useHandle(() => makeQueryUse(registry), [registry]);
	const result = useAtomValue<AsyncResult.AsyncResult<A, E>>(query ?? idle);
	React.useEffect(
		function revalidateOnMount() {
			use.mounted(query);
		},
		[use, query],
	);
	React.useEffect(
		function rememberSuccess() {
			use.showed(result);
		},
		[use, result],
	);
	return use.show(result, options?.keepPrevious === true && query !== null);
};

/**
 * Reads a query through React Suspense: it suspends until the query has a
 * value, then returns its `Success`, which stays `waiting` while it
 * refetches. A stale value is shown and refetched in the background
 * (`refetchOnMount`), but one under a second old isn't, as TanStack does, so
 * the value a reader suspended on isn't fetched again as it mounts. While
 * suspended, a reader keeps its query in use until the fetch settles, even if
 * React abandons the render.
 *
 * A failure with no earlier value is thrown to the nearest error boundary as
 * a {@link QueryFailure}, as it was cached: it's thrown again until something
 * refetches the query, such as {@link useResetQueryFailure} in the boundary.
 * A refetch that fails after a success keeps showing that success.
 *
 * In a server render it may fetch, for streaming SSR: it suspends on the
 * fetch instead of reading only the cache.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Query } from "@monarcode/effetch-query";
 * import { useSuspenseQuery } from "@monarcode/effetch-query/react";
 *
 * const me = Query.make({ key: ["me"], run: Effect.succeed({ name: "Ada" }) });
 *
 * export const useName = () => useSuspenseQuery(me).value.name;
 * ```
 *
 * @since 0.1.0
 */
export const useSuspenseQuery = <A, E>(
	query: Query.Query<A, E>,
): AsyncResult.Success<A, E> => {
	const registry = useRegistry();
	const use = useHandle(
		() => makeQueryUse(registry, suspenseStaleTime),
		[registry],
	);
	const result = useAtomValue(query);
	React.useEffect(
		function revalidateOnMount() {
			use.mounted(query);
		},
		[use, query],
	);
	return use.suspend(query, result);
};

/**
 * The page controls {@link useInfiniteQuery} and
 * {@link useSuspenseInfiniteQuery} return beside the result.
 *
 * @example
 * ```ts
 * import type { InfinitePageControls } from "@monarcode/effetch-query/react";
 *
 * export const onEndReached = (pages: InfinitePageControls) => {
 *   if (pages.hasNextPage && !pages.isFetchingNextPage) {
 *     void pages.fetchNextPage();
 *   }
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface InfinitePageControls {
	/**
	 * Fetches the page after the last one, as
	 * {@link InfiniteQuery.fetchNextPage} does. Resolves when it settles;
	 * never rejects: a failure shows in `result`, which keeps the loaded pages.
	 */
	readonly fetchNextPage: () => Promise<void>;
	/** Fetches the page before the first one, as {@link InfiniteQuery.fetchPreviousPage} does. */
	readonly fetchPreviousPage: () => Promise<void>;
	/** Whether `nextPageParam` gives a param for the shown pages (neither `undefined` nor `null`). */
	readonly hasNextPage: boolean;
	/** Whether `previousPageParam` gives a param for the shown pages. */
	readonly hasPreviousPage: boolean;
	/** Whether a next page is being fetched, as opposed to a refetch of every page. */
	readonly isFetchingNextPage: boolean;
	/** Whether a previous page is being fetched. */
	readonly isFetchingPreviousPage: boolean;
}

/**
 * What {@link useInfiniteQuery} returns.
 *
 * @example
 * ```ts
 * import type { InfiniteQuery } from "@monarcode/effetch-query";
 * import {
 *   useInfiniteQuery,
 *   type UseInfiniteQueryResult,
 * } from "@monarcode/effetch-query/react";
 *
 * declare const feed: InfiniteQuery.InfiniteQuery<ReadonlyArray<string>, Error, number>;
 *
 * export const useFeed = (): UseInfiniteQueryResult<ReadonlyArray<string>, Error, number> =>
 *   useInfiniteQuery(feed);
 * ```
 *
 * @since 0.1.0
 */
export interface UseInfiniteQueryResult<A, E, P> extends InfinitePageControls {
	/** The query's result, as {@link useQuery} returns it. */
	readonly result: AsyncResult.AsyncResult<
		InfiniteQuery.InfiniteData<A, P>,
		E
	>;
}

/**
 * What {@link useSuspenseInfiniteQuery} returns.
 *
 * @example
 * ```ts
 * import type { InfiniteQuery } from "@monarcode/effetch-query";
 * import {
 *   useSuspenseInfiniteQuery,
 *   type UseSuspenseInfiniteQueryResult,
 * } from "@monarcode/effetch-query/react";
 *
 * declare const feed: InfiniteQuery.InfiniteQuery<ReadonlyArray<string>, Error, number>;
 *
 * export const useFeed = (): UseSuspenseInfiniteQueryResult<
 *   ReadonlyArray<string>,
 *   Error,
 *   number
 * > => useSuspenseInfiniteQuery(feed);
 * ```
 *
 * @since 0.1.0
 */
export interface UseSuspenseInfiniteQueryResult<
	A,
	E,
	P,
> extends InfinitePageControls {
	/** The query's success, as {@link useSuspenseQuery} returns it. */
	readonly result: AsyncResult.Success<InfiniteQuery.InfiniteData<A, P>, E>;
}

/** The page controls of a query and the result a reader shows for it. */
const usePageControls = <A, E, P>(
	query: InfiniteQuery.InfiniteQuery<A, E, P> | null,
	result: AsyncResult.AsyncResult<InfiniteQuery.InfiniteData<A, P>, E>,
): InfinitePageControls => {
	const registry = useRegistry();
	const paging = useAtomValue(pagingAtom(query));
	const {
		hasNextPage,
		hasPreviousPage,
		isFetchingNextPage,
		isFetchingPreviousPage,
	} = pageState(query, result, paging);
	const fetchNextPage = React.useCallback(
		() =>
			query === null
				? Promise.resolve()
				: fetchPageFor(registry, query, "next"),
		[registry, query],
	);
	const fetchPreviousPage = React.useCallback(
		() =>
			query === null
				? Promise.resolve()
				: fetchPageFor(registry, query, "previous"),
		[registry, query],
	);
	return React.useMemo(
		() => ({
			fetchNextPage,
			fetchPreviousPage,
			hasNextPage,
			hasPreviousPage,
			isFetchingNextPage,
			isFetchingPreviousPage,
		}),
		[
			fetchNextPage,
			fetchPreviousPage,
			hasNextPage,
			hasPreviousPage,
			isFetchingNextPage,
			isFetchingPreviousPage,
		],
	);
};

/**
 * Reads an {@link InfiniteQuery.InfiniteQuery} as {@link useQuery} does
 * (the mount policy, focus, reconnect and polling refetch every loaded
 * page), with controls to fetch a page at either end: "load more" buttons
 * and infinite scroll.
 *
 * A page fetch keeps the loaded pages shown: `result` stays a waiting
 * `Success`, and `isFetchingNextPage` tells it from a refetch of every page.
 * A page that fails makes `result` a `Failure` whose `previousSuccess` still
 * holds the pages. Pass `null` to read nothing.
 *
 * @example
 * ```tsx
 * import * as Effect from "effect/Effect";
 * import * as AsyncResult from "effect/reactivity/AsyncResult";
 *
 * import { InfiniteQuery } from "@monarcode/effetch-query";
 * import { useInfiniteQuery } from "@monarcode/effetch-query/react";
 *
 * const numbers = InfiniteQuery.make({
 *   key: ["numbers"],
 *   initialPageParam: 0,
 *   run: (page: number) => Effect.succeed([page * 2, page * 2 + 1]),
 *   nextPageParam: (_, __, page) => (page < 4 ? page + 1 : undefined),
 * });
 *
 * export function Numbers() {
 *   const { result, fetchNextPage, hasNextPage, isFetchingNextPage } =
 *     useInfiniteQuery(numbers);
 *   const items = AsyncResult.getOrElse(result, () => ({ pages: [] })).pages.flat();
 *   return (
 *     <>
 *       <ul>{items.map((n) => <li key={n}>{n}</li>)}</ul>
 *       <button
 *         disabled={!hasNextPage || isFetchingNextPage}
 *         onClick={() => void fetchNextPage()}
 *       >
 *         Load more
 *       </button>
 *     </>
 *   );
 * }
 * ```
 *
 * @see {@link useSuspenseInfiniteQuery} to suspend until the first page
 *
 * @since 0.1.0
 */
export const useInfiniteQuery = <A, E, P>(
	query: InfiniteQuery.InfiniteQuery<A, E, P> | null,
	options?: UseQueryOptions | undefined,
): UseInfiniteQueryResult<A, E, P> => {
	const result = useQuery(query, options);
	const controls = usePageControls(query, result);
	return React.useMemo(() => ({ ...controls, result }), [controls, result]);
};

/**
 * Reads an {@link InfiniteQuery.InfiniteQuery} through React Suspense, as
 * {@link useSuspenseQuery} does, with the same page controls as
 * {@link useInfiniteQuery}. It suspends only until the first page: later
 * pages load while the loaded ones show, through `isFetchingNextPage`. A
 * page that fails isn't thrown, since there are pages to show; only a
 * failure with no pages before it reaches the error boundary.
 *
 * @example
 * ```tsx
 * import * as Effect from "effect/Effect";
 *
 * import { InfiniteQuery } from "@monarcode/effetch-query";
 * import { useSuspenseInfiniteQuery } from "@monarcode/effetch-query/react";
 *
 * const numbers = InfiniteQuery.make({
 *   key: ["numbers"],
 *   initialPageParam: 0,
 *   run: (page: number) => Effect.succeed([page * 2, page * 2 + 1]),
 *   nextPageParam: (_, __, page) => (page < 4 ? page + 1 : undefined),
 * });
 *
 * export function Numbers() {
 *   const { result, fetchNextPage, hasNextPage } =
 *     useSuspenseInfiniteQuery(numbers);
 *   return (
 *     <ul>
 *       {result.value.pages.flat().map((n) => <li key={n}>{n}</li>)}
 *       {hasNextPage ? <li onClick={() => void fetchNextPage()}>More</li> : null}
 *     </ul>
 *   );
 * }
 * ```
 *
 * @since 0.1.0
 */
export const useSuspenseInfiniteQuery = <A, E, P>(
	query: InfiniteQuery.InfiniteQuery<A, E, P>,
): UseSuspenseInfiniteQueryResult<A, E, P> => {
	const result = useSuspenseQuery(query);
	const controls = usePageControls(query, result);
	return React.useMemo(() => ({ ...controls, result }), [controls, result]);
};

/**
 * What {@link useMutation} returns.
 *
 * @example
 * ```ts
 * import type * as Effect from "effect/Effect";
 *
 * import type { Mutation } from "@monarcode/effetch-query";
 * import {
 *   useMutation,
 *   type UseMutationResult,
 * } from "@monarcode/effetch-query/react";
 *
 * declare const save: Mutation.Mutation<string, number, Error>;
 *
 * export const useSave = (): UseMutationResult<string, number, Error> =>
 *   useMutation(save);
 * ```
 *
 * @since 0.1.0
 */
export interface UseMutationResult<Variables, A, E> {
	/** This component's latest run: `Initial` before the first and after {@link UseMutationResult.reset}. */
	readonly result: AsyncResult.AsyncResult<A, E>;
	/** Starts a run. Resolves with its `Exit`; never rejects. */
	readonly run: (variables: Variables) => Promise<Exit.Exit<A, E>>;
	/** Puts `result` back to `Initial`. Runs in progress carry on. */
	readonly reset: () => void;
}

/**
 * Uses a mutation in this component, with state of its own: two components
 * using one mutation never share a pending or failed state. A run carries on
 * after the component unmounts, so its `onSuccess` and `invalidates` still
 * happen. With the mutation's `concurrent: false`, a run interrupts this
 * component's previous one.
 *
 * Define mutations at module level, with {@link Mutation.make}: a new
 * definition on each render starts a new state. Outside React, run one with
 * {@link Mutation.run}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import * as Exit from "effect/Exit";
 *
 * import { Mutation } from "@monarcode/effetch-query";
 * import { useMutation } from "@monarcode/effetch-query/react";
 *
 * const rename = Mutation.make({
 *   run: (name: string) => Effect.succeed(name.trim()),
 * });
 *
 * export const useRename = () => {
 *   const { result, run } = useMutation(rename);
 *   const submit = async (name: string) => {
 *     const exit = await run(name);
 *     if (Exit.isSuccess(exit)) console.log("Renamed to", exit.value);
 *   };
 *   return { saving: result.waiting, submit };
 * };
 * ```
 *
 * @since 0.1.0
 */
export const useMutation = <Variables, A, E>(
	mutation: Mutation.Mutation<Variables, A, E>,
): UseMutationResult<Variables, A, E> => {
	const registry = useRegistry();
	const handle = useHandle(
		() => makeHandle(registry, mutation),
		[registry, mutation],
	);
	const result = useAtomValue(handle.result);
	return React.useMemo(
		() => ({ result, run: handle.run, reset: handle.reset }),
		[result, handle],
	);
};

/**
 * What {@link useRefetch} returns.
 *
 * @example
 * ```ts
 * import {
 *   useRefetch,
 *   type UseRefetchResult,
 * } from "@monarcode/effetch-query/react";
 *
 * export const useRefreshTodos = (): UseRefetchResult => useRefetch(["todos"]);
 * ```
 *
 * @since 0.1.0
 */
export interface UseRefetchResult {
	/** Refetches the target's queries in use, and resolves when they've settled. Never rejects. */
	readonly refetch: () => Promise<void>;
	/**
	 * Whether one of this component's refetches is running. A background
	 * revalidation (focus, reconnect, polling) doesn't count.
	 */
	readonly isRefetching: boolean;
}

/**
 * Refetches queries on demand, such as for pull to refresh, with a flag that
 * is true only while this component's own refetch runs, unlike a query's
 * `waiting`, which a background revalidation also sets. It refetches the
 * target's queries in use, as {@link Query.refetch} does.
 *
 * @example
 * ```ts
 * import { useRefetch } from "@monarcode/effetch-query/react";
 *
 * export const usePullToRefresh = () => {
 *   const { refetch, isRefetching } = useRefetch(["todos", "list"]);
 *   return { refreshing: isRefetching, onRefresh: refetch };
 * };
 * ```
 *
 * @since 0.1.0
 */
export const useRefetch = (target: Query.Target): UseRefetchResult => {
	const registry = useRegistry();
	const handle = useHandle(() => makeRefetchHandle(registry), [registry]);
	const isRefetching = useAtomValue(handle.refetching);
	// The latest target, so `refetch` keeps its identity when the caller
	// passes a new key array on each render.
	const latest = React.useRef(target);
	React.useLayoutEffect(function trackTarget() {
		latest.current = target;
	});
	const refetch = React.useCallback(
		() => handle.refetch(latest.current),
		[handle],
	);
	return React.useMemo(
		() => ({ refetch, isRefetching }),
		[refetch, isRefetching],
	);
};

/**
 * Returns a function for an error boundary: given what the boundary caught,
 * it refetches the query inside a {@link QueryFailure}, so the boundary can
 * render its children again and have them suspend on the refetch. Other
 * errors are ignored.
 *
 * @example
 * ```ts
 * import { useResetQueryFailure } from "@monarcode/effetch-query/react";
 *
 * export const useRetry = (error: unknown, retry: () => void) => {
 *   const resetFailure = useResetQueryFailure();
 *   return () => {
 *     resetFailure(error);
 *     retry();
 *   };
 * };
 * ```
 *
 * @since 0.1.0
 */
export const useResetQueryFailure = (): ((error: unknown) => void) => {
	const registry = useRegistry();
	return React.useCallback(
		(error: unknown) => {
			if (QueryFailure.is(error)) {
				registry.refresh(error.query);
			}
		},
		[registry],
	);
};
