import * as Cause from "effect/Cause";
import * as Formatter from "effect/Formatter";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Query from "../Query.js";
import { QueryFailure } from "../QueryFailure.js";
import { isIdle, isPlaceholder } from "./queryAtom.js";
import { StateAtom } from "./runtime.js";
import { refresh } from "./targets.js";

/**
 * Whether a suspense reader can render a result: a success (even while it
 * refetches), a failure with an earlier success to show, or a settled
 * failure to throw. `Initial`, and a failure with nothing to show that's
 * being refetched (after `useResetQueryFailure`), suspend.
 */
export const isShowable = <A, E>(
	result: AsyncResult.AsyncResult<A, E>,
): result is AsyncResult.Success<A, E> | AsyncResult.Failure<A, E> =>
	result._tag === "Success" ||
	(result._tag === "Failure" &&
		(!result.waiting || Option.isSome(result.previousSuccess)));

/**
 * Resolves once a query has a result a suspense reader can render. It
 * subscribes, then reads the query, which starts its fetch if it isn't
 * cached (a server render reads only the cache, so this is where its fetch
 * starts). The subscription keeps the query in use while the reader is
 * suspended. Readers of one query share one promise, so a render React
 * repeats throws the same one.
 */
export const whenShowable = (
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, any>,
): Promise<void> => {
	const { suspensions } = registry.get(StateAtom);
	const pending = suspensions.get(query);
	if (pending !== undefined) {
		return pending;
	}
	let settle: () => void = () => {};
	const promise = new Promise<void>((resolve) => {
		settle = resolve;
	});
	suspensions.set(query, promise);
	// A `clear` while the reader waits leaves the query idle: the reader
	// renders again and, being new to it, wakes it.
	// A placeholder doesn't count: the server's value and a hydrating
	// render don't show it, so they'd suspend on it again and again.
	const ready = (result: AsyncResult.AsyncResult<any, any>) =>
		isShowable(result) && !isPlaceholder(registry, result);
	const unsubscribe = registry.subscribe(query, (result) => {
		if (ready(result) || isIdle(registry, query)) {
			done();
		}
	});
	const done = () => {
		suspensions.delete(query);
		unsubscribe();
		settle();
	};
	if (ready(registry.get(query))) {
		done();
	}
	return promise;
};

/**
 * The {@link QueryFailure} a suspense reader throws for a failed query. The
 * message uses `Formatter.format`, which never throws: it's built during
 * render, and a key may hold a bigint or a cycle.
 */
export const queryFailure = (
	query: Query.Query<any, any>,
	cause: Cause.Cause<unknown>,
): QueryFailure => {
	const error = Cause.squash(cause);
	return new QueryFailure({
		query,
		cause,
		error,
		message: `Query ${Formatter.format(query.key)} failed: ${
			Predicate.hasProperty(error, "message") &&
			Predicate.isString(error.message)
				? error.message
				: Formatter.format(error)
		}`,
	});
};

/**
 * Refetches the query of a {@link QueryFailure} (or wakes it, if a `clear`
 * left it idle), so an error boundary can render its readers again and have
 * them suspend on the refetch. Other errors are ignored.
 */
export const resetQueryFailure = (
	registry: AtomRegistry.AtomRegistry,
	error: unknown,
): void => {
	if (QueryFailure.is(error)) {
		refresh(registry, error.query);
	}
};

/**
 * Calls `f` when the query of a {@link QueryFailure} settles with a new
 * success, such as from a refetch on reconnect, so a boundary showing the
 * failure can show its readers again. Not for the success the query already
 * has, which a `select` that threw couldn't show. The subscription keeps the
 * query in use, so focus and reconnect refetch it. Returns the unsubscribe;
 * does nothing for other errors.
 */
export const onRecovered = (
	registry: AtomRegistry.AtomRegistry,
	error: unknown,
	f: () => void,
): (() => void) => {
	if (!QueryFailure.is(error)) {
		return () => {};
	}
	const query = error.query;
	const from = registry.get(query);
	return registry.subscribe(query, (result) => {
		if (result !== from && AsyncResult.isSuccess(result) && !result.waiting) {
			f();
		}
	});
};
