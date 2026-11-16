import * as Effect from "effect/Effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Query from "../Query.js";
import { clearQuery, resetQuery } from "./cache.js";
import { matching } from "./keyIndex.js";
import { wake } from "./queryAtom.js";
import { isInUse } from "./usage.js";

/** Marks the matching queries stale: those in use refetch at once. */
export const invalidate = (
	registry: AtomRegistry.AtomRegistry,
	target: Query.Target,
): void => {
	for (const query of matching(registry, target)) {
		// A query `clear` left idle fetches as it wakes.
		if (!wake(registry, query)) {
			registry.refresh(query);
		}
	}
};

/** Refetches the matching queries in use, and waits for them to settle. */
export const refetch = (
	registry: AtomRegistry.AtomRegistry,
	target: Query.Target,
): Effect.Effect<void> =>
	Effect.suspend(() => {
		const used = matching(registry, target).filter((query) =>
			isInUse(registry, query),
		);
		for (const query of used) {
			if (!wake(registry, query)) {
				registry.refresh(query);
			}
		}
		return Effect.forEach(
			used,
			(query) =>
				Effect.exit(
					AtomRegistry.getResult(registry, query, {
						suspendOnWaiting: true,
					}),
				),
			{ concurrency: "unbounded", discard: true },
		);
	});

/** Puts the matching queries back to `Initial`: those in use fetch again. */
export const reset = (
	registry: AtomRegistry.AtomRegistry,
	target: Query.Target,
): void => {
	// Not in a batch: its commit rebuilds every stale node, so the queries
	// not in use would fetch too.
	for (const query of matching(registry, target)) {
		resetQuery(registry, query);
	}
};

/**
 * Drops the matching queries' values without fetching: those in use show an
 * idle `Initial` until something asks for them.
 */
export const clear = (
	registry: AtomRegistry.AtomRegistry,
	target: Query.Target,
): void => {
	for (const query of matching(registry, target)) {
		clearQuery(registry, query);
	}
};
