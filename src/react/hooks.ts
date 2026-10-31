"use client";

import { useAtomValue } from "@effect/atom-react";
import * as Duration from "effect/Duration";
import type * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import * as React from "react";

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
export const useRefetch = (target: Query.QueryTarget): UseRefetchResult => {
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
