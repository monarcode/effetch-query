"use client";

import { useAtomValue } from "@effect/atom-react";
import type * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import type * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import * as React from "react";

import type * as InfiniteQuery from "../InfiniteQuery.js";
import { makeActivityHandle, noRuns } from "../internal/activity.js";
import {
	fetchPageFor,
	pageState,
	pagingAtom,
} from "../internal/infiniteQuery.js";
import { matcher } from "../internal/keyIndex.js";
import { makeHandle } from "../internal/mutationHandle.js";
import { makeQueriesUse } from "../internal/queriesUse.js";
import { queryState } from "../internal/queryState.js";
import { makeQueryUse, type QueryUse } from "../internal/queryUse.js";
import { makeRefetchHandle } from "../internal/refetchHandle.js";
import { resetQueryFailure } from "../internal/suspense.js";
import type * as Mutation from "../Mutation.js";
import type * as Query from "../Query.js";
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
 * Options for {@link useInfiniteQuery}, and the base of
 * {@link UseQuerySelectOptions}, which {@link useQuery} and
 * {@link useQueryState} take.
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
	 * If true, while the query has no value yet (say, the next page of a
	 * family), the hook shows the last success it showed, as a waiting
	 * `Success`, instead of `Initial`: TanStack's
	 * `placeholderData: keepPreviousData`. A failure is shown as it is, and
	 * a `null` query still reads `Initial`. Default: `false`.
	 */
	readonly keepPrevious?: boolean | undefined;
	/**
	 * If true, the hook keeps showing what it last showed and stops counting
	 * as a use of the query: an invalidation, focus, reconnect or
	 * `refetchInterval` doesn't refetch it for this component, nor does
	 * the component re-render. What it shows isn't `waiting`, since nothing
	 * fetches for it, and a `clear` replaces it with what the cache has. Use
	 * it for a screen that stays mounted under another, as React Native's
	 * stack navigators keep them. Paused from its first render, it shows what
	 * the cache has, without fetching. `useInfiniteQuery`'s page functions
	 * still fetch pages when called.
	 *
	 * A query whose readers are all paused isn't in use, so it's dropped
	 * after `gcTime` like any other, though the paused readers still show
	 * what they had. When `paused` turns false, the mount policy runs as on a
	 * mount: the query refetches if it's stale or failed, unless another
	 * reader fetched it meanwhile and it's still fresh. Default: `false`.
	 */
	readonly paused?: boolean | undefined;
}

/**
 * Options for {@link useQuery} and {@link useQueryState}: those of
 * {@link UseQueryOptions}, and `select`.
 *
 * @example
 * ```ts
 * import type { UseQuerySelectOptions } from "@monarcode/effetch-query/react";
 *
 * export const options: UseQuerySelectOptions<ReadonlyArray<string>, number> = {
 *   select: (todos) => todos.length,
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface UseQuerySelectOptions<A, B> extends UseQueryOptions {
	/**
	 * Derives what the component shows from the query's value, such as one
	 * field or a count: the hook returns its result instead of the value, and
	 * a failure's previous success is selected too. The cache keeps the whole
	 * value, so other readers of the query see it unchanged.
	 *
	 * The component re-renders when the selection changes or a fetch starts or
	 * ends (`waiting`), not when the value changes in a way the selection
	 * doesn't show: a selection equal to the last one (`Equal.equals`, which
	 * compares plain objects and arrays by their contents) keeps the last
	 * result, timestamp included. An inline function runs on every render;
	 * for a costly selection, pass one defined outside the component or with
	 * `useCallback`, which runs only when the query's result changes.
	 *
	 * If it throws, the hook shows a failure whose cause is the defect, with
	 * no earlier value; if it throws on a failure's previous success, the
	 * failure shows without one. With `keepPrevious`, the last selection
	 * shown is kept. Default: none, the value itself.
	 */
	readonly select?: ((value: A) => B) | undefined;
}

/**
 * Options for {@link useSuspenseQuery}.
 *
 * @example
 * ```ts
 * import type { UseSuspenseQueryOptions } from "@monarcode/effetch-query/react";
 *
 * export const options: UseSuspenseQueryOptions<{ readonly title: string }, string> = {
 *   select: (todo) => todo.title,
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface UseSuspenseQueryOptions<A, B> {
	/**
	 * Derives what the component shows from the query's value, as
	 * {@link UseQuerySelectOptions.select} does. If it throws, the defect is
	 * thrown to the error boundary as a `QueryFailure`, even after an earlier
	 * selection was shown. Default: none, the value itself.
	 */
	readonly select?: ((value: A) => B) | undefined;
}

/**
 * Subscribes to a query's result, with `select` applied by the reader's
 * handle: changes the selection doesn't show don't re-render the component.
 */
const useSelected = <A, E, B>(
	use: QueryUse,
	query: Query.Query<A, E> | null,
	select: ((value: A) => B) | undefined,
): AsyncResult.AsyncResult<B, E> => {
	// Always the selector form: switching forms would change the hooks called.
	const selector = React.useCallback(
		(result: AsyncResult.AsyncResult<A, E>) =>
			use.select(query, result, select),
		[use, query, select],
	);
	return useAtomValue<
		AsyncResult.AsyncResult<A, E>,
		AsyncResult.AsyncResult<B, E>
	>(query ?? idle, selector);
};

/**
 * Reads a query and keeps it up to date while the component is mounted. On
 * mount, and when `query` changes, it refetches the query if it's stale
 * (`refetchOnMount`) or failed (`retryOnMount`), the mount policy, and
 * while mounted it refetches on focus, reconnect and `refetchInterval` as
 * the query's options say.
 *
 * With `select`, it returns the result of the selection instead
 * ({@link UseQuerySelectOptions.select}), and the component doesn't re-render
 * for changes the selection doesn't show.
 *
 * Pass `null` to read nothing: it returns `AsyncResult.initial()` and fetches
 * nothing (TanStack's `enabled: false`). In a server render it reads only the
 * cache and never starts a fetch, and the mount refetch doesn't run. Throws a
 * `MissingQueryProviderError` outside a `QueryProvider`.
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
 * @see {@link useQueryState} for the result as an object of fields
 *
 * @since 0.1.0
 */
export const useQuery = <A, E, B = A>(
	query: Query.Query<A, E> | null,
	options?: UseQuerySelectOptions<A, B> | undefined,
): AsyncResult.AsyncResult<B, E> => {
	const registry = useRegistry();
	const use = useHandle(() => makeQueryUse(registry), [registry]);
	const paused = options?.paused === true && query !== null;
	const source = use.read(query, paused);
	const live = useSelected(use, source, options?.select);
	const result =
		paused && query !== null ? use.paused(query, options?.select) : live;
	React.useEffect(
		function revalidateOnMount() {
			use.mounted(source);
		},
		[use, source],
	);
	React.useEffect(
		function rememberResult() {
			use.showed(query, live, paused);
		},
		[use, query, live, paused],
	);
	return use.show(
		result,
		options?.keepPrevious === true && query !== null,
		paused,
	);
};

/**
 * What {@link useQueries} returns for one entry of its list: the query's
 * result, typed by the query, or `AsyncResult<never, never>` for `null`.
 * An entry that may be one of several queries is a union of their results.
 *
 * @example
 * ```ts
 * import type * as Effect from "effect/Effect";
 *
 * import type { Query } from "@monarcode/effetch-query";
 * import type { UseQueriesEntry } from "@monarcode/effetch-query/react";
 *
 * declare const me: Query.Query<string, Error>;
 *
 * // AsyncResult<string, Error>
 * export type Me = UseQueriesEntry<typeof me>;
 * ```
 *
 * @since 0.1.0
 */
export type UseQueriesEntry<Q> = [Exclude<Q, null>] extends [never]
	? AsyncResult.AsyncResult<never, never>
	: Exclude<Q, null> extends infer Each
		? Each extends Query.Query<infer A, infer E>
			? AsyncResult.AsyncResult<A, E>
			: never
		: never;

/**
 * What {@link useQueries} returns: a result per query, in the same order,
 * as a tuple for a tuple of queries and an array for an array.
 *
 * @example
 * ```ts
 * import type { Query } from "@monarcode/effetch-query";
 * import type { UseQueriesResult } from "@monarcode/effetch-query/react";
 *
 * declare const me: Query.Query<string, Error>;
 * declare const count: Query.Query<number, never>;
 *
 * // readonly [AsyncResult<string, Error>, AsyncResult<number, never>]
 * export type Both = UseQueriesResult<readonly [typeof me, typeof count]>;
 * ```
 *
 * @since 0.1.0
 */
export type UseQueriesResult<
	Queries extends ReadonlyArray<Query.Query<any, any> | null>,
> = { readonly [K in keyof Queries]: UseQueriesEntry<Queries[K]> };

/**
 * Options for {@link useQueries}.
 *
 * @example
 * ```ts
 * import type { UseQueriesOptions } from "@monarcode/effetch-query/react";
 *
 * export const options: UseQueriesOptions = { paused: false };
 * ```
 *
 * @since 0.1.0
 */
export interface UseQueriesOptions {
	/**
	 * If true, the hook keeps showing what it last showed and stops counting
	 * as a use of the queries, as {@link UseQueryOptions.paused} does for one.
	 * Default: `false`.
	 */
	readonly paused?: boolean | undefined;
}

/**
 * Reads a list of queries whose length can change between renders, such as
 * one per selected item, and keeps each up to date as {@link useQuery}
 * does: it returns their results in the same order, and `Initial` for a
 * `null` entry. Each query gets the mount policy when it joins the list. A
 * query listed twice is read once, and shows in both places.
 *
 * The component re-renders when one of the results changes. The array keeps
 * its identity while every result in it does, so it can be a dependency of
 * `useMemo`. Combine the results with `AsyncResult.all`. In a server render
 * it reads only the cache and never starts a fetch. Throws a
 * `MissingQueryProviderError` outside a `QueryProvider`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import * as AsyncResult from "effect/reactivity/AsyncResult";
 *
 * import { Query } from "@monarcode/effetch-query";
 * import { useQueries } from "@monarcode/effetch-query/react";
 *
 * const todo = Query.family({
 *   key: ["todos", "detail"],
 *   run: (id: number) => Effect.succeed({ id, title: `Todo ${id}` }),
 * });
 *
 * export const useSelectedTodos = (ids: ReadonlyArray<number>) =>
 *   // AsyncResult<Array<{ id: number; title: string }>, never>
 *   AsyncResult.all(useQueries(ids.map((id) => todo(id))));
 * ```
 *
 * @see {@link useQuery} for one query
 *
 * @since 0.1.0
 */
export const useQueries = <
	const Queries extends ReadonlyArray<Query.Query<any, any> | null>,
>(
	queries: Queries,
	options?: UseQueriesOptions | undefined,
): UseQueriesResult<Queries> => {
	const registry = useRegistry();
	const use = useHandle(() => makeQueriesUse(registry), [registry]);
	const paused = options?.paused === true;
	const atom = use.read(queries, paused);
	const live = useAtomValue(atom, use.stable);
	const listed = paused ? null : atom;
	React.useEffect(
		function revalidateOnMount() {
			use.mounted(listed === null ? null : queries);
		},
		// `queries` is a new array on most renders; the atom changes only when
		// it lists other queries.
		[use, listed],
	);
	React.useEffect(
		function rememberResults() {
			if (listed !== null) {
				use.showed(queries, live);
			}
		},
		[use, listed, live],
	);
	return (paused ? use.paused(queries) : live) as UseQueriesResult<Queries>;
};

/**
 * Reads a query through React Suspense: it suspends until the query has a
 * value, then returns its `Success`, which stays `waiting` while it
 * refetches. A stale value is shown and refetched in the background
 * (`refetchOnMount`), but one under a second old isn't, as TanStack does, so
 * the value a component suspended on isn't fetched again as it mounts. While
 * suspended, a component keeps its query in use until the fetch settles, even
 * if React abandons the render.
 *
 * A failure with no earlier value is thrown to the nearest error boundary as
 * a `QueryFailure`, as it was cached: it's thrown again until something
 * refetches the query, such as {@link useResetQueryFailure} in the boundary.
 * A refetch that fails after a success keeps showing that success.
 *
 * With `select`, it returns the success of the selection instead
 * ({@link UseSuspenseQueryOptions.select}), and the component doesn't
 * re-render for changes the selection doesn't show.
 *
 * In a server render, unlike {@link useQuery}, it fetches a query the cache
 * doesn't have and suspends on the fetch, for streaming SSR. Throws a
 * `MissingQueryProviderError` outside a `QueryProvider`.
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
 *
 * export const useInitial = () =>
 *   useSuspenseQuery(me, { select: (user) => user.name[0] }).value;
 * ```
 *
 * @see {@link useQuery} to read without suspending
 * @see {@link QueryBoundary} for the loading and failure states around it
 *
 * @since 0.1.0
 */
export const useSuspenseQuery = <A, E, B = A>(
	query: Query.Query<A, E>,
	options?: UseSuspenseQueryOptions<A, B> | undefined,
): AsyncResult.Success<B, E> => {
	const registry = useRegistry();
	const use = useHandle(
		() => makeQueryUse(registry, suspenseStaleTime),
		[registry],
	);
	use.read(query, false);
	const result = useSelected(use, query, options?.select);
	React.useEffect(
		function revalidateOnMount() {
			use.mounted(query);
		},
		[use, query],
	);
	return use.suspend(query, result);
};

/**
 * What {@link useQueryState} returns while the query has no value and no
 * failure: before its first fetch settles, after a `clear`, and for a `null`
 * query.
 *
 * @example
 * ```ts
 * import type { UseQueryStatePending } from "@monarcode/effetch-query/react";
 *
 * export const fetching = (state: UseQueryStatePending<string, Error>) =>
 *   state.isFetching;
 * ```
 *
 * @since 0.1.0
 */
export interface UseQueryStatePending<A, E> {
	/** `"pending"`: no value and no failure yet. */
	readonly status: "pending";
	/** Always `undefined`: there's no value yet. */
	readonly data: undefined;
	/** Always `undefined`: there's no failure. */
	readonly error: undefined;
	/** Always `undefined`: there's no failure. */
	readonly cause: undefined;
	/** Always true. */
	readonly isPending: true;
	/** Always false. */
	readonly isSuccess: false;
	/** Always false. */
	readonly isFailure: false;
	/**
	 * True while a fetch of the query is in progress: the result's
	 * `waiting`. False for a `null` query. In a server render, a query the
	 * cache doesn't have reads as fetching, though nothing fetches it there.
	 */
	readonly isFetching: boolean;
	/** Always false: see {@link UseQueryStateSuccess.isPlaceholder}. */
	readonly isPlaceholder: false;
	/** Refetches the query, as {@link UseQueryStateSuccess.refetch} does. */
	readonly refetch: () => Promise<void>;
	/** The result the fields come from, an `Initial`. */
	readonly result: AsyncResult.Initial<A, E>;
}

/**
 * What {@link useQueryState} returns while the query has a value, including
 * while it refetches.
 *
 * @example
 * ```ts
 * import type { UseQueryStateSuccess } from "@monarcode/effetch-query/react";
 *
 * export const title = (state: UseQueryStateSuccess<{ readonly title: string }, Error>) =>
 *   state.data.title;
 * ```
 *
 * @since 0.1.0
 */
export interface UseQueryStateSuccess<A, E> {
	/** `"success"`: the query has a value. */
	readonly status: "success";
	/** The query's value, or its selection with `select`. */
	readonly data: A;
	/** Always `undefined`: there's no failure. */
	readonly error: undefined;
	/** Always `undefined`: there's no failure. */
	readonly cause: undefined;
	/** Always false. */
	readonly isPending: false;
	/** Always true. */
	readonly isSuccess: true;
	/** Always false. */
	readonly isFailure: false;
	/** True while the query refetches in the background: the result's `waiting`. */
	readonly isFetching: boolean;
	/**
	 * True when `data` isn't the query's own value yet: its placeholder
	 * ({@link Query.MakeOptions.placeholder}), or, with `keepPrevious`, the
	 * value of the query shown before. It stays true until the query's own
	 * value or failure replaces it, and `isFetching` is true meanwhile,
	 * except for a `paused` reader, which fetches nothing: it keeps the
	 * placeholder, not fetching, until it resumes. Use it to dim the data,
	 * or to turn off what needs the real value, such as editing it or paging
	 * past it.
	 */
	readonly isPlaceholder: boolean;
	/**
	 * Refetches the query, as {@link Query.refetch} does, and resolves when
	 * the refetch settles. Never rejects: a failure shows in the fields. It
	 * keeps its identity while the query stays the same. Resolves at once
	 * for a `null` query, and, since a `paused` reader isn't a use, for a
	 * query only paused readers use.
	 */
	readonly refetch: () => Promise<void>;
	/** The result the fields come from, a `Success`. */
	readonly result: AsyncResult.Success<A, E>;
}

/**
 * What {@link useQueryState} returns when the query has failed: its last
 * fetch failed, or a refetch after a success did. A `select` that throws
 * gives one too.
 *
 * @example
 * ```ts
 * import type { UseQueryStateFailure } from "@monarcode/effetch-query/react";
 *
 * export const message = (state: UseQueryStateFailure<string, Error>) =>
 *   state.error?.message ?? "Something went wrong";
 * ```
 *
 * @since 0.1.0
 */
export interface UseQueryStateFailure<A, E> {
	/** `"failure"`: the query's last fetch failed, or `select` threw. */
	readonly status: "failure";
	/**
	 * The last success before the failure, or `undefined` if there was none:
	 * a refetch that fails keeps the value it had.
	 */
	readonly data: A | undefined;
	/**
	 * The typed error the query failed with, or `undefined` when it failed
	 * with a defect or an interruption, which only `cause` holds.
	 */
	readonly error: E | undefined;
	/**
	 * The cause of the failure: the query's error, a defect, or an
	 * interruption.
	 */
	readonly cause: Cause.Cause<E>;
	/** Always false. */
	readonly isPending: false;
	/** Always false. */
	readonly isSuccess: false;
	/** Always true. */
	readonly isFailure: true;
	/** True while a refetch is in progress: the result's `waiting`. */
	readonly isFetching: boolean;
	/** Always false: a failure's `data` is the query's own last success. */
	readonly isPlaceholder: false;
	/** Refetches the query, as {@link UseQueryStateSuccess.refetch} does. */
	readonly refetch: () => Promise<void>;
	/** The result the fields come from, a `Failure`. */
	readonly result: AsyncResult.Failure<A, E>;
}

/**
 * What {@link useQueryState} returns: one of three shapes, told apart by
 * `status` (or `isPending`, `isSuccess` and `isFailure`), which narrows
 * `data`, `error` and `cause`.
 *
 * @example
 * ```ts
 * import type { UseQueryStateResult } from "@monarcode/effetch-query/react";
 *
 * export const label = (state: UseQueryStateResult<number, Error>): string => {
 *   switch (state.status) {
 *     case "pending":
 *       return "Loading…";
 *     case "success":
 *       return `${state.data} todos`;
 *     case "failure":
 *       return state.error?.message ?? "Something went wrong";
 *   }
 * };
 * ```
 *
 * @since 0.1.0
 */
export type UseQueryStateResult<A, E> =
	| UseQueryStatePending<A, E>
	| UseQueryStateSuccess<A, E>
	| UseQueryStateFailure<A, E>;

/**
 * Reads a query as {@link useQuery} does, and returns its result as an object
 * of fields: `status`, `data`, `error`, `isFetching`, `isPlaceholder`,
 * `refetch` and more, close to TanStack Query's shape. It fetches,
 * refetches and takes options as {@link useQuery} does, `select` and
 * `keepPrevious` included.
 *
 * Check `status` before reading `data`: it narrows the object
 * ({@link UseQueryStateResult}). A failure keeps the last success as `data`,
 * and its `error` is typed; match each error by its `_tag`, or use `result`
 * with `AsyncResult.builder`. The object keeps its identity while nothing in
 * it changes. Throws a `MissingQueryProviderError` outside a `QueryProvider`.
 *
 * @example
 * ```tsx
 * import * as Effect from "effect/Effect";
 *
 * import { Query } from "@monarcode/effetch-query";
 * import { useQueryState } from "@monarcode/effetch-query/react";
 *
 * const todos = Query.make({
 *   key: ["todos"],
 *   run: Effect.succeed([{ id: 1, title: "Buy milk" }]),
 * });
 *
 * export function TodoCount() {
 *   const state = useQueryState(todos, { select: (list) => list.length });
 *   if (state.status === "pending") return <p>Loading…</p>;
 *   if (state.status === "failure") {
 *     return <button onClick={() => void state.refetch()}>Try again</button>;
 *   }
 *   return <p>{state.data} todos{state.isFetching ? " (updating)" : ""}</p>;
 * }
 * ```
 *
 * @see {@link useQuery} for the `AsyncResult` itself
 *
 * @since 0.1.0
 */
export const useQueryState = <A, E, B = A>(
	query: Query.Query<A, E> | null,
	options?: UseQuerySelectOptions<A, B> | undefined,
): UseQueryStateResult<B, E> => {
	const registry = useRegistry();
	const result = useQuery(query, options);
	const handle = useHandle(() => makeRefetchHandle(registry), [registry]);
	const refetch = React.useCallback(
		() => (query === null ? Promise.resolve() : handle.refetch(query)),
		[handle, query],
	);
	return React.useMemo(
		() => ({
			...queryState(registry, result),
			refetch,
		}),
		[registry, result, refetch],
	);
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
	/**
	 * Fetches the page before the first one, as
	 * {@link InfiniteQuery.fetchPreviousPage} does. Like `fetchNextPage`, it
	 * resolves when it settles and never rejects.
	 */
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
	paused = false,
): InfinitePageControls => {
	const registry = useRegistry();
	// Paused, the controls follow the result shown, not a page in flight.
	const paging = useAtomValue(pagingAtom(paused ? null : query));
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
 * holds the pages. Pass `null` to read nothing. It fetches, and throws, when
 * {@link useQuery} does.
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
	const controls = usePageControls(
		query,
		result,
		options?.paused === true && query !== null,
	);
	return React.useMemo(() => ({ ...controls, result }), [controls, result]);
};

/**
 * Reads an {@link InfiniteQuery.InfiniteQuery} through React Suspense, as
 * {@link useSuspenseQuery} does, with the same page controls as
 * {@link useInfiniteQuery}. It suspends only until the first page: later
 * pages load while the loaded ones show, through `isFetchingNextPage`. A
 * page that fails isn't thrown, since there are pages to show; only a
 * failure with no pages before it reaches the error boundary, as a
 * `QueryFailure`. It fetches, and throws, when {@link useSuspenseQuery}
 * does.
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
 * @see {@link useInfiniteQuery} to read without suspending
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
 * Callbacks for one run of {@link useMutation}, which its `run` takes:
 * TanStack's `mutate(variables, { onSuccess, onError, onSettled })`. They're
 * called after the mutation's own callbacks, `invalidates` and the client's
 * hooks, before code awaiting `run` carries on.
 *
 * They're dropped if, by the time the run settles, `reset` was called, a
 * newer run started in the component (with `concurrent: "queue"`, one
 * queued after it), or the component unmounted; and for a run that was
 * interrupted, or that never started: dropped by `concurrent: "drop"`, or
 * on a disposed client. The run itself completes all the same. Use them for
 * what matters only to this screen, such as filling in a form field or
 * navigating, and the mutation's own `onSuccess` for what must always
 * happen.
 *
 * A callback that throws is logged with `console.error`; the ones after it
 * still run, and `run` still resolves.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Mutation } from "@monarcode/effetch-query";
 * import { useMutation } from "@monarcode/effetch-query/react";
 *
 * const lookUpMeter = Mutation.make({
 *   run: (meter: string) => Effect.succeed({ meter, name: "Ada Lovelace" }),
 * });
 *
 * export const useMeterLookup = (setName: (name: string) => void) => {
 *   const { result, run, reset } = useMutation(lookUpMeter);
 *   // A lookup still running when the meter number changes never fills
 *   // in its name: `reset` drops its callbacks.
 *   const lookUp = (meter: string) =>
 *     run(meter, { onSuccess: (found) => setName(found.name) });
 *   return { looking: result.waiting, lookUp, meterChanged: reset };
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface UseMutationRunOptions<Variables, A, E> {
	/** Called with the value when the run succeeds. */
	readonly onSuccess?: ((value: A, variables: Variables) => void) | undefined;
	/** Called with the cause when the run fails or dies. */
	readonly onFailure?:
		| ((cause: Cause.Cause<E>, variables: Variables) => void)
		| undefined;
	/** Called with the run's `Exit` after `onSuccess` or `onFailure`. */
	readonly onSettled?:
		| ((exit: Exit.Exit<A, E>, variables: Variables) => void)
		| undefined;
}

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
	/**
	 * The state of this component's latest run: `Initial` before the first
	 * and after {@link UseMutationResult.reset}.
	 */
	readonly result: AsyncResult.AsyncResult<A, E>;
	/**
	 * The variables of the run {@link UseMutationResult.result} shows:
	 * `undefined` before the first run and after
	 * {@link UseMutationResult.reset}. Render the change a run is making from
	 * them, without touching the cache, while `result.waiting` is true.
	 */
	readonly variables: Variables | undefined;
	/**
	 * Starts a run. Resolves with its `Exit`; never rejects. With the
	 * mutation's `concurrent: false`, a run that a newer one replaces resolves
	 * with an interrupted `Exit`; with `concurrent: "drop"`, so does a run
	 * started while the one `result` shows is in progress, at once, and it
	 * changes nothing. On a disposed client the run never starts, and
	 * resolves with a died `Exit`.
	 * `options` are callbacks for this run only: see
	 * {@link UseMutationRunOptions}.
	 */
	readonly run: (
		variables: Variables,
		options?: UseMutationRunOptions<Variables, A, E> | undefined,
	) => Promise<Exit.Exit<A, E>>;
	/** Puts `result` back to `Initial`. Runs in progress carry on. */
	readonly reset: () => void;
}

/**
 * Uses a mutation in this component, with state of its own: two components
 * using one mutation never share a waiting or failed state. A run carries on
 * after the component unmounts, so its `onSuccess` and `invalidates` still
 * happen, though the callbacks given to `run` don't
 * ({@link UseMutationRunOptions}). The mutation's `concurrent` decides
 * how this component's runs overlap: `false` interrupts the previous one,
 * `"queue"` runs them one at a time, and `"drop"` ignores a run while the
 * one `result` shows is in progress. To show runs any component started, use
 * {@link useMutationState}.
 *
 * Define mutations at module level, with {@link Mutation.make}: a new
 * definition on each render starts a new state. Outside React, run one with
 * {@link Mutation.run}. Throws a `MissingQueryProviderError` outside a
 * `QueryProvider`.
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
	const variables = useAtomValue(handle.variables);
	React.useEffect(
		function retainHandle() {
			return handle.retain();
		},
		[handle],
	);
	return React.useMemo(
		() => ({ result, variables, run: handle.run, reset: handle.reset }),
		[result, variables, handle],
	);
};

/**
 * A run of a mutation in progress, as {@link useMutationState} lists it.
 *
 * @example
 * ```ts
 * import type { UseMutationStateRun } from "@monarcode/effetch-query/react";
 *
 * export const title = (run: UseMutationStateRun<{ title: string }, number, never>) =>
 *   run.variables.title;
 * ```
 *
 * @since 0.1.0
 */
export interface UseMutationStateRun<Variables, A, E> {
	/** The variables the run was started with. */
	readonly variables: Variables;
	/**
	 * The run's state. It's listed only while in progress, so this is a
	 * waiting `Initial`.
	 */
	readonly result: AsyncResult.AsyncResult<A, E>;
}

const useActivity = () => {
	const registry = useRegistry();
	return useHandle(() => makeActivityHandle(registry), [registry]);
};

const noneInProgress = () => 0;
const noRunsInProgress = () => noRuns;

/**
 * Lists the runs of a mutation in progress on this client, oldest first,
 * whichever component or Effect started them: a list can show the items a
 * form elsewhere is still saving. A run is listed from when it starts until
 * it settles, however it ends. A run `concurrent: "queue"` holds back is
 * listed while it waits; one that `concurrent: false` makes wait for the run
 * it replaces to roll back is listed once that's done. The list keeps its
 * identity until the runs change.
 *
 * A server render lists none, and so does the first render while the page
 * hydrates. Throws a `MissingQueryProviderError` outside a `QueryProvider`.
 *
 * @example
 * ```tsx
 * import * as Effect from "effect/Effect";
 *
 * import { Mutation } from "@monarcode/effetch-query";
 * import { useMutationState } from "@monarcode/effetch-query/react";
 *
 * const addTodo = Mutation.make({
 *   run: (title: string) => Effect.succeed({ id: 1, title }),
 * });
 *
 * export function SavingTodos() {
 *   const saving = useMutationState(addTodo);
 *   return (
 *     <ul>
 *       {saving.map((run, index) => (
 *         <li key={index} style={{ opacity: 0.5 }}>
 *           {run.variables}
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 *
 * @see {@link useMutation} for one component's own runs
 * @see {@link useIsMutating} to count them
 *
 * @since 0.1.0
 */
export const useMutationState = <Variables, A, E>(
	mutation: Mutation.Mutation<Variables, A, E>,
): ReadonlyArray<UseMutationStateRun<Variables, A, E>> => {
	const activity = useActivity();
	return React.useSyncExternalStore(
		activity.subscribe,
		() => activity.runs(mutation),
		noRunsInProgress,
	);
};

/**
 * Counts the queries with a fetch in progress on this client: those the
 * {@link Query.Target} matches, or all of them without one, as
 * {@link Query.invalidate} matches them. Background refetches count, so it
 * suits an app-wide progress bar. The component re-renders when the count
 * changes.
 *
 * A server render counts none, and so does the first render while the page
 * hydrates. Throws a `MissingQueryProviderError` outside a `QueryProvider`,
 * and a `Query.KeyHoldsTargetError` for a key that holds a query, a family
 * or a group.
 *
 * @example
 * ```tsx
 * import { useIsFetching, useIsMutating } from "@monarcode/effetch-query/react";
 *
 * export function ProgressBar() {
 *   const busy = useIsFetching() + useIsMutating() > 0;
 *   return busy ? <div role="progressbar" aria-label="Loading" /> : null;
 * }
 * ```
 *
 * @see {@link useIsMutating} for mutation runs
 *
 * @since 0.1.0
 */
export const useIsFetching = (target?: Query.Target | undefined): number => {
	const activity = useActivity();
	return React.useSyncExternalStore(
		activity.subscribe,
		() => activity.fetching(target),
		noneInProgress,
	);
};

/**
 * Counts the mutation runs in progress on this client: those of `mutation`,
 * or of every mutation without one, whichever component or Effect started
 * them. A run counts from when it starts until it settles, and a run
 * `concurrent: "queue"` holds back counts while it waits. The component
 * re-renders when the count changes.
 *
 * A server render counts none, and so does the first render while the page
 * hydrates. Throws a `MissingQueryProviderError` outside a `QueryProvider`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { Mutation } from "@monarcode/effetch-query";
 * import { useIsMutating } from "@monarcode/effetch-query/react";
 *
 * const save = Mutation.make({ run: (text: string) => Effect.succeed(text) });
 *
 * export const useUnsavedChanges = () => useIsMutating(save) > 0;
 * ```
 *
 * @see {@link useMutationState} for the runs' variables
 * @see {@link useIsFetching} for queries
 *
 * @since 0.1.0
 */
export const useIsMutating = (
	mutation?: Mutation.Mutation<never, unknown, unknown> | undefined,
): number => {
	const activity = useActivity();
	return React.useSyncExternalStore(
		activity.subscribe,
		() => activity.mutating(mutation),
		noneInProgress,
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
	/**
	 * Refetches the target's queries in use, and resolves when they've
	 * settled. Never rejects. It keeps its identity across renders while the
	 * provider's client stays the same, and uses the target of the latest
	 * render.
	 */
	readonly refetch: () => Promise<void>;
	/**
	 * Whether one of this component's refetches is in progress. A background
	 * refetch (focus, reconnect, polling) doesn't count.
	 */
	readonly isRefetching: boolean;
}

/**
 * Refetches queries on demand, such as for pull to refresh, with a flag that
 * is true only while this component's own refetch is in progress, unlike a
 * query's `waiting`, which a background refetch also sets. It refetches the
 * {@link Query.Target}'s queries in use, as {@link Query.refetch} does. For a
 * screen made of queries with different keys, pass a {@link Query.group} of
 * them: it's refetching until every one has settled. Throws a
 * `MissingQueryProviderError` outside a `QueryProvider`, and a
 * {@link Query.KeyHoldsTargetError} for a key that holds a query, a family
 * or a group, such as `[todos, profile]`: pass a {@link Query.group}.
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
	// Checked as it renders, as `useIsFetching` checks its target: inside
	// the refetch's own fiber, the defect would be lost.
	matcher(target);
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
 * it refetches the query inside a `QueryFailure`, so the boundary can
 * render its children again and have them suspend on the refetch. Other
 * errors are ignored. {@link useSuspenseQuery} and
 * {@link useSuspenseInfiniteQuery} throw the failures it resets. Throws a
 * `MissingQueryProviderError` outside a `QueryProvider`.
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
		(error: unknown) => resetQueryFailure(registry, error),
		[registry],
	);
};
