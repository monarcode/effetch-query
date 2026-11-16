import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Query from "../Query.js";
import { resumePolling, revalidate } from "./mountPolicy.js";
import { isIdle, wake } from "./queryAtom.js";
import { StateAtom } from "./runtime.js";
import { isShowable, queryFailure, whenShowable } from "./suspense.js";

/**
 * One reader of queries, such as a component's `useQuery` (DESIGN.md §4.2,
 * §5.8). Frameworks create one per reader, call {@link QueryUse.mounted}
 * from the reader's mount effect and {@link QueryUse.showed} after it shows a
 * result, and read through {@link QueryUse.show} or {@link QueryUse.suspend}.
 */
export interface QueryUse {
	/**
	 * Runs the mount policy once each time the reader starts reading a query
	 * (`null`: none), and resumes its polling. A query fetched since the reader
	 * last mounted, such as by the reader's own first read, is new to it and
	 * isn't revalidated.
	 */
	readonly mounted: (query: Query.Query<any, any> | null) => void;
	/** Remembers a success the reader showed of a query, for `keepPrevious`. */
	readonly showed: (
		query: Query.Query<any, any> | null,
		result: AsyncResult.AsyncResult<any, any>,
	) => void;
	/**
	 * What the reader shows: the result, or with `keepPrevious` its last
	 * success, as a waiting `Success`, while the result is `Initial`, unless
	 * its query was cleared since. A re-render gets the same object.
	 */
	readonly show: <A, E>(
		result: AsyncResult.AsyncResult<A, E>,
		keepPrevious: boolean,
	) => AsyncResult.AsyncResult<A, E>;
	/**
	 * What a suspense reader shows: a success, or the success before a
	 * failure. Throws a promise to suspend on, or the `QueryFailure` of a
	 * failure with no success before it.
	 */
	readonly suspend: <A, E>(
		query: Query.Query<A, E>,
		result: AsyncResult.AsyncResult<A, E>,
	) => AsyncResult.Success<A, E>;
}

/**
 * `minStaleTime` raises a query's `staleTime` for the mount policy, as
 * suspense readers do, so the value a reader suspended on isn't fetched again
 * as it mounts.
 */
export const makeQueryUse = (
	registry: AtomRegistry.AtomRegistry,
	minStaleTime: Duration.Duration = Duration.zero,
): QueryUse => {
	const state = () => registry.get(StateAtom);
	let mountedAt = state().fetchCount;
	let current: Query.Query<any, any> | null = null;
	let previous:
		| {
				readonly success: AsyncResult.Success<any, any>;
				readonly query: Query.Query<any, any>;
				readonly clears: number | undefined;
		  }
		| undefined;
	// What `clear` dropped doesn't come back as a previous value.
	const kept = (): AsyncResult.Success<any, any> | undefined =>
		previous !== undefined &&
		state().clears.get(previous.query) === previous.clears
			? previous.success
			: undefined;
	// The last waiting copy made, so a re-render gets the same object.
	let copy:
		| {
				readonly of: AsyncResult.Success<any, any>;
				readonly waiting: AsyncResult.Success<any, any>;
		  }
		| undefined;
	const waiting = <A, E>(
		success: AsyncResult.Success<A, E>,
	): AsyncResult.Success<A, E> => {
		if (copy?.of !== success) {
			copy = {
				of: success,
				waiting: AsyncResult.success(success.value, {
					waiting: true,
					timestamp: success.timestamp,
				}),
			};
		}
		return copy.waiting;
	};
	return {
		mounted: (query) => {
			if (query !== null) {
				resumePolling(registry, query);
				const fetchedAt = state().fetchedAt.get(query) ?? 0;
				if (
					query !== current &&
					(isIdle(registry, query) || fetchedAt <= mountedAt)
				) {
					revalidate(registry, query, minStaleTime);
				}
			}
			current = query;
			mountedAt = state().fetchCount;
		},
		showed: (query, result) => {
			if (query !== null && AsyncResult.isSuccess(result)) {
				previous = {
					success: result,
					query,
					clears: state().clears.get(query),
				};
			}
		},
		show: (result, keepPrevious) => {
			const success =
				keepPrevious && AsyncResult.isInitial(result) ? kept() : undefined;
			return success === undefined ? result : waiting(success);
		},
		suspend: (query, result) => {
			// A reader new to a query `clear` left idle fetches it; one already
			// showing it waits, as a `useQuery` reader shows `Initial`. The wake
			// waits for the render to end: it notifies the query's other readers.
			if (query !== current && isIdle(registry, query)) {
				const client = state();
				queueMicrotask(() => {
					if (!client.disposed && isIdle(registry, query)) {
						wake(registry, query);
					}
				});
			}
			if (!isShowable(result)) {
				throw whenShowable(registry, query);
			}
			if (AsyncResult.isSuccess(result)) {
				return result;
			}
			if (Option.isNone(result.previousSuccess)) {
				throw queryFailure(query, result.cause);
			}
			const success = result.previousSuccess.value;
			return result.waiting ? waiting(success) : success;
		},
	};
};
