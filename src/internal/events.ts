import type * as Exit from "effect/Exit";

import type { QueryKey } from "../Query.js";
import type { ClientState } from "./runtime.js";

/**
 * What happens in a client's cache. SSR streaming, router redirects and
 * devtools build on this channel; it's internal until devtools. A fetch's
 * `fetchId` pairs its `FetchStarted` with its `FetchSettled`, whose exit is
 * an interruption when the fetch was replaced or the client disposed.
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
