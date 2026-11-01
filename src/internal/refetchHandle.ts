import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import * as Query from "../Query.js";
import { forkWithClient, refreshIfBuilt } from "./runtime.js";

/**
 * One use's refetches, such as a component's `useRefetch` (DESIGN.md §4.8).
 * `refetching` is true only while one of its own refetches runs, not during
 * a background revalidation.
 */
export interface RefetchHandle {
	readonly refetching: Atom.Atom<boolean>;
	/** Refetches the target's queries in use; resolves when they've all settled. */
	readonly refetch: (target: Query.Target) => Promise<void>;
}

export const makeRefetchHandle = (
	registry: AtomRegistry.AtomRegistry,
): RefetchHandle => {
	let running = 0;
	const refetching = Atom.readable(() => running > 0);
	const change = (by: number) => {
		running += by;
		refreshIfBuilt(registry, refetching);
	};
	return {
		refetching,
		refetch: (target) => {
			let fiber;
			try {
				fiber = forkWithClient(registry, Query.refetch(target));
			} catch {
				// The registry throws once its client is disposed: nothing to refetch.
				return Promise.resolve();
			}
			change(1);
			return new Promise((resolve) =>
				fiber.addObserver(() => {
					change(-1);
					resolve();
				}),
			);
		},
	};
};
