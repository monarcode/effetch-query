import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as Atom from "effect/reactivity/Atom";

import type * as Query from "../Query.js";
import * as Signals from "../Signals.js";
import type { QuerySettings } from "./defaults.js";
import { ConfigAtom } from "./runtime.js";
import { isInUse } from "./usage.js";

/** Whether a result is a settled success younger than `staleTime`. */
export const isFresh = <A, E>(
	result: AsyncResult.AsyncResult<A, E>,
	staleTime: Duration.Duration,
): result is AsyncResult.Success<A, E> =>
	AsyncResult.isSuccess(result) &&
	!result.waiting &&
	Date.now() - result.timestamp < Duration.toMillis(staleTime);

/**
 * Whether a settled result should be refetched, as `Atom.swr` decides: a
 * success, or a failure's last success, older than `staleTime`, or a failure
 * with no success before it. `Initial` and waiting results never are.
 */
export const isStale = (
	result: AsyncResult.AsyncResult<unknown, unknown>,
	staleTime: Duration.Duration,
): boolean => {
	if (result.waiting || AsyncResult.isInitial(result)) {
		return false;
	}
	const success = AsyncResult.isSuccess(result)
		? Option.some(result)
		: result.previousSuccess;
	return (
		Option.isNone(success) ||
		Date.now() - success.value.timestamp >= Duration.toMillis(staleTime)
	);
};

/** What a query's watcher atom holds. */
export interface Watcher<E> {
	readonly settings: QuerySettings<E>;
	/** Starts the `refetchInterval` timer again if it stopped while the query was idle. */
	readonly resume: () => void;
}

/**
 * Refetches a query in use on the client's focus and reconnect signals when
 * it's stale, and every `refetchInterval`. Runs in the query's watcher atom,
 * which the query reads but which depends on nothing that changes: built once
 * per query node, it keeps one set of subscriptions and one timer however
 * often the query rebuilds, and ends them when the node is removed. Polling
 * stops while nothing uses the query; `resume` starts it again.
 */
export const watch = <E>(
	get: Atom.AtomContext,
	query: Query.Query<any, E>,
	settings: QuerySettings<E>,
): Watcher<E> => {
	const { registry } = get;
	const signals = get.once(ConfigAtom).signals ?? Signals.browser;
	// The node's value, which is current while the query is in use, so the
	// cheap staleness check can come before the walk over its dependents.
	const refetchIfStale = () => {
		const current = registry.getNodes().get(query)?.valueOption();
		if (
			current !== undefined &&
			Option.isSome(current) &&
			isStale(current.value, settings.staleTime) &&
			isInUse(registry, query)
		) {
			registry.refresh(query);
		}
	};
	// Each signal is read before it's subscribed to: a subscription doesn't
	// build an atom, and the browser's start listening for events when built.
	if (settings.refetchOnFocus) {
		get.once(signals.focus);
		get.subscribe(signals.focus, refetchIfStale);
	}
	if (settings.refetchOnReconnect) {
		let online = get.once(signals.online);
		get.subscribe(signals.online, (next) => {
			const reconnected = !online && next;
			online = next;
			if (reconnected) {
				refetchIfStale();
			}
		});
	}
	const { refetchInterval } = settings;
	let active = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const resume = () => {
		if (!active || refetchInterval === undefined || timer !== undefined) {
			return;
		}
		timer = setTimeout(() => {
			timer = undefined;
			if (!isInUse(registry, query)) {
				return;
			}
			if (!registry.get(query).waiting) {
				registry.refresh(query);
			}
			resume();
		}, Duration.toMillis(refetchInterval));
	};
	resume();
	get.addFinalizer(() => {
		active = false;
		clearTimeout(timer);
	});
	return { settings, resume };
};
