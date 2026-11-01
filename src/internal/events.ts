import type * as Exit from "effect/Exit";

import type { Mutation } from "../Mutation.js";
import type { Key as QueryKey } from "../Query.js";
import type { ClientState } from "./runtime.js";

/**
 * What happens in a client's cache. SSR streaming, router redirects and
 * devtools build on this channel; it's internal until devtools. A fetch's
 * `fetchId` pairs its `FetchStarted` with its `FetchSettled`, whose exit is
 * an interruption when the fetch was replaced or the client disposed, and
 * whose `awaited` says an Effect waits on it (`Query.fetch`, a router
 * loader's): that Effect gets a failure itself. A mutation run's `runId`
 * pairs its events the same way.
 */
export type CacheEvent =
	| { readonly _tag: "QueryAdded"; readonly key: QueryKey }
	| { readonly _tag: "QueryRemoved"; readonly key: QueryKey }
	| {
			readonly _tag: "FetchStarted";
			readonly key: QueryKey;
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

/**
 * Calls the listeners. Events are emitted inside atom builds and fetches, so
 * a listener that throws is reported on its own rather than failing them.
 */
export const emit = (state: ClientState, event: CacheEvent): void => {
	for (const listener of state.listeners) {
		try {
			listener(event);
		} catch (error) {
			queueMicrotask(() => {
				throw error;
			});
		}
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
