import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Mutation from "../Mutation.js";
import type * as Query from "../Query.js";
import type { Activity, ActiveRun } from "./events.js";
import { matcher } from "./keyIndex.js";
import { StateAtom } from "./runtime.js";

/** A mutation run in progress, as `useMutationState` lists it. */
export interface MutationRun<Variables, A, E> {
	readonly variables: Variables;
	readonly result: AsyncResult.AsyncResult<A, E>;
}

/**
 * What a client is doing, for the activity hooks (DESIGN.md §4.7). Each
 * read is a snapshot that stays the same object until what it counts
 * changes, as `useSyncExternalStore` needs. `subscribe`'s listener is called
 * in a microtask after a change.
 */
export interface ActivityHandle {
	readonly subscribe: (listener: () => void) => () => void;
	/** How many queries the target matches are fetching; all of them without one. */
	readonly fetching: (target?: Query.Target | undefined) => number;
	/** How many runs of the mutation are in progress; of every mutation without one. */
	readonly mutating: (
		mutation?: Mutation.Mutation<never, unknown, unknown> | undefined,
	) => number;
	/** The mutation's runs in progress, oldest first. */
	readonly runs: <Variables, A, E>(
		mutation: Mutation.Mutation<Variables, A, E>,
	) => ReadonlyArray<MutationRun<Variables, A, E>>;
}

/** Nothing is in progress while a server renders. */
export const noRuns: ReadonlyArray<MutationRun<never, never, never>> = [];

const running = AsyncResult.initial<never, never>(true);

export const makeActivityHandle = (
	registry: AtomRegistry.AtomRegistry,
): ActivityHandle => {
	const activity: Activity = registry.get(StateAtom).activity;
	// The latest list per mutation, kept while its runs are the same ones.
	const lists = new WeakMap<
		object,
		{
			readonly version: number;
			readonly from: ReadonlyArray<ActiveRun>;
			readonly list: ReadonlyArray<MutationRun<any, any, any>>;
		}
	>();
	return {
		subscribe: (listener) => {
			activity.listeners.add(listener);
			return () => {
				activity.listeners.delete(listener);
			};
		},
		fetching: (target) => {
			const matches = target === undefined ? undefined : matcher(target);
			const queries = new Set<Query.Query<any, any>>();
			for (const query of activity.fetching.values()) {
				if (matches === undefined || matches(query)) {
					queries.add(query);
				}
			}
			return queries.size;
		},
		mutating: (mutation) => {
			if (mutation === undefined) {
				return activity.runs.size;
			}
			let count = 0;
			for (const run of activity.runs.values()) {
				if (run.mutation === mutation) {
					count++;
				}
			}
			return count;
		},
		runs: <Variables, A, E>(mutation: Mutation.Mutation<Variables, A, E>) => {
			const cached = lists.get(mutation);
			if (cached?.version === activity.version) {
				return cached.list;
			}
			const from = Array.from(activity.runs.values()).filter(
				(run) => run.mutation === mutation,
			);
			const list =
				from.length === 0
					? (noRuns as ReadonlyArray<MutationRun<Variables, A, E>>)
					: cached !== undefined &&
						  cached.from.length === from.length &&
						  cached.from.every((run, index) => run === from[index])
						? cached.list
						: from.map((run): MutationRun<Variables, A, E> => ({
								variables: run.variables as Variables,
								result: running,
							}));
			lists.set(mutation, { version: activity.version, from, list });
			return list;
		},
	};
};
