import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Query from "../Query.js";
import { settings } from "./cache.js";
import { isStale } from "./freshness.js";
import { internals, nodeValue, peek } from "./queryAtom.js";

/**
 * Resumes `refetchInterval` polling, which stops while nothing uses the
 * query.
 */
export const resumePolling = (
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, any>,
): void => {
	const watcher = nodeValue(registry, internals(query).watcher);
	if (Option.isSome(watcher)) {
		watcher.value.resume();
	}
};

/**
 * Refetches a cached failure (`retryOnMount`) or a stale success
 * (`refetchOnMount`) when something starts using a query (DESIGN.md §4.2,
 * §4.10). A registry only rebuilds a query when its dependencies change, so a
 * query kept by its idle TTL would otherwise show what it had. A query
 * already fetching is left alone. `minStaleTime` raises the query's
 * `staleTime` for this check only.
 */
export const revalidate = (
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, any>,
	minStaleTime: Duration.Duration = Duration.zero,
): void => {
	const current = peek(registry, query);
	if (Option.isNone(current) || current.value.waiting) {
		return;
	}
	const { retryOnMount, refetchOnMount, staleTime } = settings(
		registry,
		query,
	);
	const refetch = AsyncResult.isFailure(current.value)
		? retryOnMount
		: refetchOnMount &&
			isStale(current.value, Duration.max(staleTime, minStaleTime));
	if (refetch) {
		registry.refresh(query);
	}
};

/** {@link resumePolling} and {@link revalidate}. */
export const beforeUse = (
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, any>,
): void => {
	resumePolling(registry, query);
	revalidate(registry, query);
};
