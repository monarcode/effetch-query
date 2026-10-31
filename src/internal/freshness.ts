import * as Duration from "effect/Duration";
import * as AsyncResult from "effect/reactivity/AsyncResult";

/** Whether a result is a settled success younger than `staleTime`. */
export const isFresh = <A, E>(
	result: AsyncResult.AsyncResult<A, E>,
	staleTime: Duration.Duration,
): result is AsyncResult.Success<A, E> =>
	AsyncResult.isSuccess(result) &&
	!result.waiting &&
	Date.now() - result.timestamp < Duration.toMillis(staleTime);
