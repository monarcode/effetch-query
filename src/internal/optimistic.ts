import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import * as QueryClient from "../QueryClient.js";
import { StateAtom } from "./runtime.js";

/** Puts a query back the way it was before a write. */
export type Undo = () => void;

interface Writes {
	readonly record: (undo: Undo) => void;
}

/**
 * Set while a mutation's `optimistic` runs: `Query.set` and `Query.update`
 * record how to undo their writes in it (DESIGN.md §5.6). Each run clears it
 * for everything else it runs, so a mutation run inside `optimistic` doesn't
 * record its own writes into the outer run's.
 */
export const OptimisticWrites = Context.Reference<Writes | undefined>(
	"@monarcode/effetch-query/OptimisticWrites",
	{ defaultValue: () => undefined },
);

/** The writes one run's `optimistic` made, to roll back if the run doesn't succeed. */
export interface Recorded {
	readonly writes: Writes;
	/** Stops recording: `optimistic` is done, so later writes aren't its own. */
	readonly close: () => void;
	/** Undoes the recorded writes, newest first, and forgets them. */
	readonly rollback: () => void;
	/** Forgets the recorded writes: the run succeeded, so they stay. */
	readonly keep: () => void;
}

export const makeRecorded = (): Recorded => {
	const undos: Array<Undo> = [];
	let open = true;
	return {
		writes: {
			record: (undo) => {
				if (open) {
					undos.push(undo);
				}
			},
		},
		close: () => {
			open = false;
		},
		rollback: () => {
			for (let undo = undos.pop(); undo !== undefined; undo = undos.pop()) {
				undo();
			}
		},
		keep: () => {
			undos.length = 0;
		},
	};
};

/**
 * Makes a cache write, recording its undo when a mutation's `optimistic`
 * makes it. The registry throws once disposed, so an undo that runs after
 * `dispose()` started (an interrupted run's rollback) does nothing: there's
 * no cache left to put back.
 */
export const write = (
	f: (registry: AtomRegistry.AtomRegistry) => Undo | undefined,
): Effect.Effect<void, never, QueryClient.QueryClient> =>
	OptimisticWrites.use((writes) =>
		QueryClient.QueryClient.useSync(({ registry }) => {
			const undo = f(registry);
			if (undo !== undefined && writes !== undefined) {
				const state = registry.get(StateAtom);
				writes.record(() => {
					if (!state.disposed) {
						undo();
					}
				});
			}
		}),
	);
