import * as Effect from "effect/Effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Query from "../Query.js";
import { clearQuery, resetQuery, settled } from "./cache.js";
import { matching } from "./keyIndex.js";
import { isQuery, wake } from "./queryAtom.js";
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
	const ordered: Array<Query.Query<any, any>> = [];
	const seen = new Set<AtomRegistry.Node<any>>();
	const visit = (node: AtomRegistry.Node<any>): void => {
		seen.add(node);
		for (const child of node.children) {
			if (!seen.has(child)) {
				visit(child);
			}
		}
		if (isQuery(node.atom)) {
			ordered.push(node.atom);
		}
	};
	const nodes = registry.getNodes();
	for (const query of queries) {
		const node = nodes.get(query);
		if (node !== undefined && !seen.has(node)) {
			visit(node);
		}
	}
	return ordered;
};
