import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { isPlaceholder } from "./queryAtom.js";

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
			readonly isPlaceholder: false;
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
			readonly isPlaceholder: boolean;
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
			readonly isPlaceholder: false;
			readonly result: AsyncResult.Failure<A, E>;
	  };

/**
 * The fields of a result as `useQueryState` shows them: a failure keeps the
 * last success as `data`, and its `error` is the typed failure, `undefined`
 * for a defect or an interrupt, and `isPlaceholder` says whether a
 * success's value isn't the query's own (`isPlaceholder`).
 */
export const queryState = <A, E>(
	registry: AtomRegistry.AtomRegistry,
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
				isPlaceholder: false,
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
				isPlaceholder: isPlaceholder(registry, result),
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
				isPlaceholder: false,
				result,
			};
	}
};

/** What `useMutation` shows of its latest run, beside `result`. */
export interface MutationStateFields<A, E> {
	readonly status: "idle" | "pending" | "success" | "failure";
	readonly data: A | undefined;
	readonly error: E | undefined;
	readonly cause: Cause.Cause<E> | undefined;
	readonly isIdle: boolean;
	readonly isPending: boolean;
	readonly isSuccess: boolean;
	readonly isFailure: boolean;
}

/**
 * The fields of a mutation's result, as TanStack's mutation has them: a run
 * in progress is `"pending"` with no `data` or `error`, even when an
 * earlier run's result is still under it.
 */
export const mutationState = <A, E>(
	result: AsyncResult.AsyncResult<A, E>,
): MutationStateFields<A, E> => {
	const status = result.waiting
		? "pending"
		: result._tag === "Initial"
			? "idle"
			: result._tag === "Success"
				? "success"
				: "failure";
	return {
		status,
		data:
			status === "success" && result._tag === "Success"
				? result.value
				: undefined,
		error:
			status === "failure" && result._tag === "Failure"
				? Option.getOrUndefined(Cause.findErrorOption(result.cause))
				: undefined,
		cause:
			status === "failure" && result._tag === "Failure"
				? result.cause
				: undefined,
		isIdle: status === "idle",
		isPending: status === "pending",
		isSuccess: status === "success",
		isFailure: status === "failure",
	};
};
