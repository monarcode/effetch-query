import type * as Exit from "effect/Exit";

import type { Mutation } from "../Mutation.js";
import type { Query, Key as QueryKey } from "../Query.js";
import type { ClientState } from "./runtime.js";

/**
 * What happens in a client's cache. SSR streaming, router redirects, the
 * activity hooks and devtools build on this channel; it's internal until
 * devtools. A fetch's `fetchId` pairs its `FetchStarted` with its
 * `FetchSettled`, whose exit is an interruption when the fetch was replaced
 * or the client disposed, and whose `awaited` says an Effect waits on it
 * (`Query.fetch`, a router loader's): that Effect gets a failure itself. A
 * mutation run's `runId` pairs its events the same way. A run starts when
 * it's asked for, so a queued one has started.
 */
export type CacheEvent =
	| { readonly _tag: "QueryAdded"; readonly key: QueryKey }
	| { readonly _tag: "QueryRemoved"; readonly key: QueryKey }
	| {
			readonly _tag: "FetchStarted";
			readonly key: QueryKey;
			readonly query: Query<any, any>;
			readonly fetchId: number;
	  }
	| {
			readonly _tag: "FetchSettled";
			readonly key: QueryKey;
			readonly fetchId: number;
			readonly exit: Exit.Exit<unknown, unknown>;
			readonly awaited: boolean;
	  }
	| {
			readonly _tag: "MutationStarted";
			readonly mutation: Mutation<never, unknown, unknown>;
			readonly runId: number;
			readonly variables: unknown;
	  }
	| {
			readonly _tag: "MutationSettled";
			readonly mutation: Mutation<never, unknown, unknown>;
			readonly runId: number;
			readonly exit: Exit.Exit<unknown, unknown>;
	  };

/** A mutation run in progress, queued or running. */
export interface ActiveRun {
	readonly mutation: Mutation<never, unknown, unknown>;
	readonly variables: unknown;
}

/**
 * The fetches and mutation runs in progress, kept from the client's start
 * so a hook that subscribes late still counts what began before it.
 * `version` changes with them, at once; listeners hear of it in a
 * microtask, since events are emitted while React renders.
 */
export interface Activity {
	readonly fetching: Map<number, Query<any, any>>;
	readonly runs: Map<number, ActiveRun>;
	version: number;
	readonly listeners: Set<() => void>;
	notifying: boolean;
}

export const makeActivity = (): Activity => ({
	fetching: new Map(),
	runs: new Map(),
	version: 0,
	listeners: new Set(),
	notifying: false,
});

/**
 * Calls the listeners. Events are emitted inside atom builds and fetches, so
 * a listener that throws is reported on its own rather than failing them.
 */
export const emit = (state: ClientState, event: CacheEvent): void => {
	record(state.activity, event);
	for (const listener of state.listeners) {
		call(listener, event);
	}
};

export const subscribe = (
	state: ClientState,
	listener: (event: CacheEvent) => void,
): (() => void) => {
	const { listeners } = state;
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

const record = (activity: Activity, event: CacheEvent): void => {
	switch (event._tag) {
		case "FetchStarted":
			activity.fetching.set(event.fetchId, event.query);
			break;
		case "FetchSettled":
			if (!activity.fetching.delete(event.fetchId)) {
				return;
			}
			break;
		case "MutationStarted":
			activity.runs.set(event.runId, {
				mutation: event.mutation,
				variables: event.variables,
			});
			break;
		case "MutationSettled":
			if (!activity.runs.delete(event.runId)) {
				return;
			}
			break;
		default:
			return;
	}
	activity.version++;
	// A server render has no listeners: nothing to schedule.
	if (activity.listeners.size > 0 && !activity.notifying) {
		activity.notifying = true;
		queueMicrotask(() => {
			activity.notifying = false;
			for (const listener of activity.listeners) {
				call(listener, undefined);
			}
		});
	}
};

const call = <A>(listener: (value: A) => void, value: A): void => {
	try {
		listener(value);
	} catch (error) {
		queueMicrotask(() => {
			throw error;
		});
	}
};
