import * as Effect from "effect/Effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Query from "../Query.js";
import { clearQuery, resetQuery, settled } from "./cache.js";
import { keyOfHash } from "./hashKey.js";
import { matcher, matching } from "./keyIndex.js";
import { cachedQuery, internals, isQuery, wake } from "./queryAtom.js";
import { StateAtom } from "./runtime.js";
import { isInUse } from "./usage.js";

/** Marks the matching queries stale: those in use refetch at once. */
export const invalidate = (
	registry: AtomRegistry.AtomRegistry,
	target: Query.Target,
): void => {
	for (const query of matching(registry, target)) {
		refresh(registry, query);
	}
};

/** Refetches a query, or wakes it if `clear` left it idle, which fetches. */
export const refresh = (
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, any>,
): void => {
	if (!wake(registry, query)) {
		registry.refresh(query);
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
			refresh(registry, query);
		}
		// A query cleared meanwhile counts as settled: nothing fetches it.
		return Effect.forEach(
			used,
			(query) => Effect.exit(settled(registry, query, Effect.void)),
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
 * Drops the matching queries' values without fetching, and those of the
 * queries that read them: those in use show an idle `Initial` until
 * something asks for them.
 */
export const clear = (
	registry: AtomRegistry.AtomRegistry,
	target: Query.Target,
): void => {
	for (const query of withReaders(registry, matching(registry, target))) {
		clearQuery(registry, query);
	}
	dropHydrated(registry, target);
};

/**
 * Drops what `hydrate` left for the matching queries no one has read yet,
 * values and results the server is still sending, so a cleared cache
 * doesn't show them when a query is first read.
 */
const dropHydrated = (
	registry: AtomRegistry.AtomRegistry,
	target: Query.Target,
): void => {
	const { streamed } = registry.get(StateAtom);
	const { preloadedSerializable: preloaded } = registry;
	if (preloaded.size === 0 && streamed.size === 0) {
		return;
	}
	// By key alone: there's no query to ask a family that matches its own.
	const matches = matcher(target, true);
	for (const hash of [...preloaded.keys(), ...streamed.keys()]) {
		const key = keyOfHash(hash);
		if (key !== undefined && matches({ key } as Query.Query<any, any>)) {
			preloaded.delete(hash);
			streamed.delete(hash);
		}
	}
};

/**
 * The queries, and the queries that read them through `ctx.result`, and
 * theirs in turn: a reader's value came from what it read, and a reader in
 * use would otherwise wait for an idle query for ever. Readers come before
 * what they read, so clearing a query doesn't restart a reader's fetch.
 */
const withReaders = (
	registry: AtomRegistry.AtomRegistry,
	queries: ReadonlyArray<Query.Query<any, any>>,
): ReadonlyArray<Query.Query<any, any>> => {
	const ordered = new Set<Query.Query<any, any>>();
	const seen = new Set<AtomRegistry.Node<any>>();
	const visit = (node: AtomRegistry.Node<any>): void => {
		seen.add(node);
		for (const child of node.children) {
			if (!seen.has(child)) {
				visit(child);
			}
		}
		// A live query's cache comes after the query, which reads it.
		const query = isQuery(node.atom) ? node.atom : cachedQuery(node.atom);
		if (query !== undefined) {
			ordered.add(query);
		}
	};
	const nodes = registry.getNodes();
	for (const query of queries) {
		// A live query no one reads has only its cache.
		const node = nodes.get(query) ?? nodes.get(internals(query).cache);
		if (node !== undefined && !seen.has(node)) {
			visit(node);
		}
	}
	return Array.from(ordered);
};
