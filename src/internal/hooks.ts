import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import type { Key as QueryKey } from "../Query.js";
import type * as QueryClient from "../QueryClient.js";
import { type ClientState, track } from "./runtime.js";

/**
 * Runs one of the client's hooks, logging a defect so the hooks after it
 * still run. Only defects: an interruption (the client disposed) ends them.
 */
export const runHook = <Event>(
	group: "queries" | "mutations",
	hook: QueryClient.Hook<Event> | undefined,
	event: Event,
): Effect.Effect<void, never, QueryClient.Requirements> =>
	hook === undefined
		? Effect.void
		: Effect.catchDefect(
				Effect.suspend(() => hook(event)),
				(defect) => Effect.logError(`A ${group} hook died`, defect),
			);

/**
 * Runs the client's `queries` hooks for a fetch that settled, in a fiber of
 * their own, so they don't hold up the query's result. The client tracks the
 * fiber, so `dispose()` interrupts and waits for it. A hook that dies is
 * logged, and the others still run.
 */
export const forkQueryHooks = (
	state: ClientState,
	hooks: QueryClient.QueriesOptions,
	key: QueryKey,
	exit: Exit.Exit<unknown, unknown>,
): Effect.Effect<void, never, QueryClient.Requirements> => {
	const { onSuccess, onFailure, onSettled } = hooks;
	if (
		onSuccess === undefined &&
		onFailure === undefined &&
		onSettled === undefined
	) {
		return Effect.void;
	}
	const run = Effect.andThen(
		Exit.isSuccess(exit)
			? runHook("queries", onSuccess, { key, value: exit.value })
			: runHook("queries", onFailure, { key, cause: exit.cause }),
		runHook("queries", onSettled, { key, exit }),
	);
	// Tracked from here, not from inside the fiber: it starts on the
	// scheduler's next tick, and `dispose()` may run before then.
	return Effect.flatMap(Effect.forkDetach(run), (fiber) =>
		Effect.sync(() => track(state, fiber)),
	);
};
