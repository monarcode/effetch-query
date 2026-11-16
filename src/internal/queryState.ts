import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";

/** What `useQueryState` shows of a result, without `refetch` (DESIGN.md §4.2). */
export type QueryStateFields<A, E> =
	| {
			readonly status: "pending";
			readonly data: undefined;
			readonly error: undefined;
			readonly cause: undefined;
			readonly isPending: true;
			readonly isSuccess: false;
			readonly isFailure: false;
			readonly isFetching: boolean;
			readonly result: AsyncResult.Initial<A, E>;
	  }
	| {
			readonly status: "success";
			readonly data: A;
			readonly error: undefined;
			readonly cause: undefined;
			readonly isPending: false;
			readonly isSuccess: true;
			readonly isFailure: false;
			readonly isFetching: boolean;
			readonly result: AsyncResult.Success<A, E>;
	  }
	| {
			readonly status: "failure";
			readonly data: A | undefined;
			readonly error: E | undefined;
			readonly cause: Cause.Cause<E>;
			readonly isPending: false;
			readonly isSuccess: false;
			readonly isFailure: true;
			readonly isFetching: boolean;
			readonly result: AsyncResult.Failure<A, E>;
	  };

/**
 * The fields of a result as `useQueryState` shows them: a failure keeps the
 * last success as `data`, and its `error` is the typed failure, `undefined`
 * for a defect or an interrupt.
 */
export const queryState = <A, E>(
	result: AsyncResult.AsyncResult<A, E>,
): QueryStateFields<A, E> => {
	switch (result._tag) {
		case "Initial":
			return {
				status: "pending",
				data: undefined,
				error: undefined,
				cause: undefined,
				isPending: true,
				isSuccess: false,
				isFailure: false,
				isFetching: result.waiting,
				result,
			};
		case "Success":
			return {
				status: "success",
				data: result.value,
				error: undefined,
				cause: undefined,
				isPending: false,
				isSuccess: true,
				isFailure: false,
				isFetching: result.waiting,
				result,
			};
		case "Failure":
			return {
				status: "failure",
				data: Option.getOrUndefined(
					Option.map(result.previousSuccess, (success) => success.value),
				),
				error: Option.getOrUndefined(Cause.findErrorOption(result.cause)),
				cause: result.cause,
				isPending: false,
				isSuccess: false,
				isFailure: true,
				isFetching: result.waiting,
				result,
			};
	}
};
