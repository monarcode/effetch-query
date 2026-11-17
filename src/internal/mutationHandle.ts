import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Mutation from "../Mutation.js";
import { resolveMutationOptions } from "./defaults.js";
import { execute, options } from "./mutation.js";
import {
	ConfigAtom,
	forkWithClient,
	refreshIfBuilt,
	StateAtom,
} from "./runtime.js";

/** Callbacks for one run, which a framework's `run` takes. */
export interface RunCallbacks<Variables, A, E> {
	readonly onSuccess?: ((value: A, variables: Variables) => void) | undefined;
	readonly onFailure?:
		| ((cause: Cause.Cause<E>, variables: Variables) => void)
		| undefined;
	readonly onSettled?:
		| ((exit: Exit.Exit<A, E>, variables: Variables) => void)
		| undefined;
}

/**
 * One use of a mutation, such as a component's `useMutation` (DESIGN.md
 * §4.7, §5.8). Framework adapters subscribe to `result` and `variables`,
 * `retain` the handle while their component is mounted, and call the rest.
 */
export interface MutationHandle<Variables, A, E> {
	/** The latest run's state: `Initial` before the first run and after `reset`. */
	readonly result: Atom.Atom<AsyncResult.AsyncResult<A, E>>;
	/** The variables of the run `result` shows: `undefined` before the first run and after `reset`. */
	readonly variables: Atom.Atom<Variables | undefined>;
	/**
	 * Starts a run. Resolves with its `Exit`, never rejects or throws. The
	 * callbacks are called once it settles, unless it was interrupted, is no
	 * longer the run `result` shows, or the handle was released. A run on a
	 * disposed client never starts, and calls none; nor does a run that
	 * `concurrent: "drop"` drops, which resolves at once, interrupted.
	 */
	readonly run: (
		variables: Variables,
		callbacks?: RunCallbacks<Variables, A, E> | undefined,
	) => Promise<Exit.Exit<A, E>>;
	/** Puts `result` back to `Initial`. Runs in progress carry on. */
	readonly reset: () => void;
	/**
	 * Marks the handle in use, as a new one is, until the function it returns
	 * releases it.
	 */
	readonly retain: () => () => void;
}

interface Shown<Variables, A, E> {
	readonly fiber: Fiber.Fiber<A, E>;
	readonly variables: Variables;
}

/**
 * Runs start in fibers of their own, which the client tracks, so they
 * complete after the handle's last subscriber leaves. The handle keeps the
 * latest one, and `result` follows it, so a subscriber that comes back later
 * still sees it. With `concurrent: false`, a run first interrupts the one
 * before and waits, uninterruptibly, for it to roll back its optimistic
 * writes: a run that replaces this one in the meantime still waits for both.
 * With `"queue"`, it waits for the one before to settle, so runs go one at a
 * time in order; with `"drop"`, it doesn't start while the run `result`
 * shows is in progress, so a run after `reset` starts.
 */
export const makeHandle = <Variables, A, E>(
	registry: AtomRegistry.AtomRegistry,
	mutation: Mutation.Mutation<Variables, A, E>,
): MutationHandle<Variables, A, E> => {
	// The run `result` shows, and the last run started: `reset` clears only
	// the first, so a `concurrent: false` run still replaces the last one.
	let shown: Shown<Variables, A, E> | undefined;
	let latest: Fiber.Fiber<A, E> | undefined;
	let released = false;
	const result = Atom.readable((get): AsyncResult.AsyncResult<A, E> => {
		const fiber = shown?.fiber;
		if (fiber === undefined) {
			return AsyncResult.initial();
		}
		const previous = get.self<AsyncResult.AsyncResult<A, E>>();
		const exit = fiber.pollUnsafe();
		if (exit !== undefined) {
			return AsyncResult.fromExitWithPrevious(exit, previous);
		}
		get.addFinalizer(
			fiber.addObserver((exit) =>
				get.setSelf(AsyncResult.fromExitWithPrevious(exit, previous)),
			),
		);
		return AsyncResult.waitingFrom(previous);
	});
	const variables = Atom.readable(() => shown?.variables);
	const show = (next: Shown<Variables, A, E> | undefined) => {
		shown = next;
		refreshIfBuilt(registry, result);
		refreshIfBuilt(registry, variables);
	};
	// Undefined when `"drop"` drops the run.
	const start = (input: Variables): Fiber.Fiber<A, E> | undefined => {
		const { concurrent } = resolveMutationOptions(
			options(mutation),
			registry.get(ConfigAtom).mutations.defaults,
		);
		if (
			concurrent === "drop" &&
			shown !== undefined &&
			shown.fiber.pollUnsafe() === undefined
		) {
			return undefined;
		}
		const previous =
			concurrent === true || concurrent === "drop" ? undefined : latest;
		// A queued run counts as started while it waits; one that replaces
		// another starts once that one has rolled back.
		const run =
			previous === undefined
				? execute(mutation, input)
				: concurrent === "queue"
					? execute(mutation, input, afterSettled(registry, previous))
					: Effect.andThen(
							Effect.uninterruptible(Fiber.interrupt(previous)),
							execute(mutation, input),
						);
		return forkWithClient(registry, run);
	};
	return {
		result,
		variables,
		run: (input, callbacks) => {
			let fiber: Fiber.Fiber<A, E> | undefined;
			try {
				fiber = start(input);
			} catch (defect) {
				// The registry throws once its client is disposed.
				return Promise.resolve(Exit.die(defect));
			}
			if (fiber === undefined) {
				return Promise.resolve(Exit.interrupt());
			}
			const started = fiber;
			latest = started;
			show({ fiber: started, variables: input });
			const settled = new Promise<Exit.Exit<A, E>>((resolve) =>
				started.addObserver(resolve),
			);
			if (callbacks !== undefined) {
				void settled.then((exit) => {
					if (!released && shown?.fiber === started) {
						notify(callbacks, input, exit);
					}
				});
			}
			return settled;
		},
		reset: () => show(undefined),
		retain: () => {
			released = false;
			return function release() {
				released = true;
			};
		},
	};
};

// `dispose()` interrupts the runs one by one: a queued run must not start
// once the run before it is interrupted.
const afterSettled = (
	registry: AtomRegistry.AtomRegistry,
	previous: Fiber.Fiber<unknown, unknown>,
): Effect.Effect<void> => {
	const state = registry.get(StateAtom);
	return Effect.andThen(
		Fiber.awaitAll([previous]),
		Effect.suspend(() => (state.disposed ? Effect.interrupt : Effect.void)),
	);
};

const notify = <Variables, A, E>(
	callbacks: RunCallbacks<Variables, A, E>,
	variables: Variables,
	exit: Exit.Exit<A, E>,
): void => {
	if (Exit.isSuccess(exit)) {
		report(() => callbacks.onSuccess?.(exit.value, variables));
	} else if (Cause.hasInterruptsOnly(exit.cause)) {
		return;
	} else {
		report(() => callbacks.onFailure?.(exit.cause, variables));
	}
	report(() => callbacks.onSettled?.(exit, variables));
};

// The run has settled, so there's nothing left to fail: a callback that
// throws is logged, and the callbacks after it still run.
const report = (callback: () => void): void => {
	try {
		callback();
	} catch (error) {
		console.error("A mutation run's callback failed:", error);
	}
};
