import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Mutation from "../Mutation.js";
import { resolveMutationOptions } from "./defaults.js";
import { execute, options } from "./mutation.js";
import { ConfigAtom, forkWithClient, refreshIfBuilt } from "./runtime.js";

/**
 * One use of a mutation, such as a component's `useMutation` (DESIGN.md
 * §4.7, §5.8). Framework adapters subscribe to `result` and call the rest.
 */
export interface MutationHandle<Variables, A, E> {
	/** The latest run's state: `Initial` before the first run and after `reset`. */
	readonly result: Atom.Atom<AsyncResult.AsyncResult<A, E>>;
	/** Starts a run. Resolves with its `Exit`, never rejects or throws. */
	readonly run: (variables: Variables) => Promise<Exit.Exit<A, E>>;
	/** Puts `result` back to `Initial`. Runs in progress carry on. */
	readonly reset: () => void;
}

/**
 * Runs start in fibers of their own, which the client tracks, so they
 * complete after the handle's last subscriber leaves. The handle keeps the
 * latest one, and `result` follows it, so a subscriber that comes back later
 * still sees it. With `concurrent: false`, a run first interrupts the one
 * before and waits, uninterruptibly, for it to roll back its optimistic
 * writes: a run that replaces this one in the meantime still waits for both.
 */
export const makeHandle = <Variables, A, E>(
	registry: AtomRegistry.AtomRegistry,
	mutation: Mutation.Mutation<Variables, A, E>,
): MutationHandle<Variables, A, E> => {
	// The run `result` shows, and the last run started: `reset` clears only
	// the first, so a `concurrent: false` run still replaces the last one.
	let shown: Fiber.Fiber<A, E> | undefined;
	let latest: Fiber.Fiber<A, E> | undefined;
	const result = Atom.readable((get): AsyncResult.AsyncResult<A, E> => {
		const fiber = shown;
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
	const show = (fiber: Fiber.Fiber<A, E> | undefined) => {
		shown = fiber;
		refreshIfBuilt(registry, result);
	};
	const start = (variables: Variables): Fiber.Fiber<A, E> => {
		const { concurrent } = resolveMutationOptions(
			options(mutation),
			registry.get(ConfigAtom).mutations.defaults,
		);
		const previous = concurrent ? undefined : latest;
		const run = execute(mutation, variables);
		return forkWithClient(
			registry,
			previous === undefined
				? run
				: Effect.andThen(
						Effect.uninterruptible(Fiber.interrupt(previous)),
						run,
					),
		);
	};
	return {
		result,
		run: (variables) => {
			let fiber: Fiber.Fiber<A, E>;
			try {
				fiber = start(variables);
			} catch (defect) {
				// The registry throws once its client is disposed.
				return Promise.resolve(Exit.die(defect));
			}
			latest = fiber;
			show(fiber);
			return new Promise((resolve) => fiber.addObserver(resolve));
		},
		reset: () => show(undefined),
	};
};
