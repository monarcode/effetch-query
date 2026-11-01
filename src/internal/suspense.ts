import * as Cause from "effect/Cause";
import * as Formatter from "effect/Formatter";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Query from "../Query.js";
import { QueryFailure } from "../QueryFailure.js";
import { StateAtom } from "./runtime.js";

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
	const unsubscribe = registry.subscribe(query, (result) => {
		if (isShowable(result)) {
			done();
		}
	});
	const done = () => {
		suspensions.delete(query);
		unsubscribe();
		settle();
	};
	if (isShowable(registry.get(query))) {
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
