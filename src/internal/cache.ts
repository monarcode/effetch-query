import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Query from "../Query.js";
import { type QuerySettings, resolveQueryOptions } from "./defaults.js";
import { emit } from "./events.js";
import { isFresh } from "./freshness.js";
import type { Undo } from "./optimistic.js";
import {
	internals,
	isQuery,
	localValue,
	nodeValue,
	peek,
	written,
} from "./queryAtom.js";
import { ConfigAtom, type ClientState } from "./runtime.js";

/**
 * Indexes queries by node existence and reports them on the event channel.
 * The registry has one slot for each hook, so the client owns both.
 */
export const observeNodes = (
	registry: AtomRegistry.AtomRegistry,
	state: ClientState,
): void => {
	registry.onNodeAdded = (node) => {
		if (isQuery(node.atom)) {
			state.index.add(node.atom);
			emit(state, { _tag: "QueryAdded", key: node.atom.key });
		}
	};
	registry.onNodeRemoved = (node) => {
		if (isQuery(node.atom)) {
			state.index.delete(node.atom);
			emit(state, { _tag: "QueryRemoved", key: node.atom.key });
		}
	};
};

/** A query's settings: its watcher's, or resolved again if it has none yet. */
export const settings = <E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, E>,
): QuerySettings<E> => {
	const { options, watcher } = internals(query);
	return Option.match(nodeValue(registry, watcher), {
		onSome: (watcher) => watcher.settings,
		onNone: () =>
			resolveQueryOptions(
				options,
				registry.get(ConfigAtom).queries.defaults,
			),
	});
};

// The node takes `skipInitialRun` as `initialValues` does, though its
// interface leaves the parameter out.
const seed = <A>(
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<A>,
	value: A,
): void =>
	(
		registry.ensureNode(atom) as unknown as {
			setInitialValue(value: A, skipInitialRun: boolean): void;
		}
	).setInitialValue(value, true);

/**
 * Writes a value. A query whose fetch atom is up to date takes it as a
 * written value (DESIGN.md §4.1). One that isn't cached, or was invalidated
 * while unused (its fetch atom is stale, and would refetch when next read),
 * is seeded instead, the way hydration does it: a fetch atom keeps the value
 * instead of running its first fetch, a new generation's if the current one
 * has a value. So the value counts as fresh, as TanStack's `setQueryData`
 * clears `isInvalidated`. The query is then read, so the seeded node has a
 * dependent before the registry sweeps unused nodes.
 *
 * Returns how to undo the write, for optimistic writes (DESIGN.md §5.6).
 * A written value is undone by putting `local` back. A value seeded into the
 * current generation, which had none, is dropped with a reset. One seeded
 * over a stale generation goes back to that generation, whose fetch atom
 * the registry has swept by then: it's seeded again with its old result and
 * invalidated, so the query is as it was, refetching when next used.
 */
export const setValue = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
	value: A,
): Undo => {
	const { local, fetchAtom } = internals(query);
	const previous = localValue(registry, query);
	const { generation } = previous;
	const restore = () => registry.set(local, previous);
	const state = registry.getNodes().get(fetchAtom(generation))?.currentState();
	if (state === "valid") {
		registry.set(query, value);
		return restore;
	}
	const target = state === "stale" ? generation + 1 : generation;
	const stale = nodeValue(registry, fetchAtom(generation));
	seed(registry, fetchAtom(target), written<A, E>(value).value);
	registry.set(local, { generation: target, written: Option.none() });
	registry.get(query);
	if (target === generation) {
		return () => resetQuery(registry, query);
	}
	return Option.match(stale, {
		onNone: () => restore,
		onSome: (result) => () => {
			seed(registry, fetchAtom(generation), result);
			restore();
			registry.get(query);
			registry.refresh(fetchAtom(generation));
		},
	});
};

/** Writes a value computed from the cached one, as `setValue` does, if there is one. */
export const updateValue = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
	f: (value: A) => A,
): Undo | undefined => {
	const current = Option.flatMap(peek(registry, query), AsyncResult.value);
	return Option.isSome(current)
		? setValue(registry, query, f(current.value))
		: undefined;
};

/**
 * Drops the query's value and written value in one write, which moves it to
 * a new fetch atom: in use, it fetches straight away; otherwise on its next
 * read. The old fetch atom, and any fetch it runs, goes with its last user.
 */
export const resetQuery = (
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, any>,
): void => {
	if (registry.getNodes().get(query)?.currentState() === "uninitialized") {
		return;
	}
	registry.update(internals(query).local, (local) => ({
		generation: local.generation + 1,
		written: Option.none(),
	}));
};

export const fetchValue = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
): Effect.Effect<A, E> =>
	Effect.suspend(() => {
		if (Option.isSome(peek(registry, query))) {
			const current = registry.get(query);
			if (isFresh(current, settings(registry, query).staleTime)) {
				return Effect.succeed(current.value);
			}
			if (!current.waiting) {
				registry.refresh(query);
			}
		}
		// Otherwise building the query is its first fetch.
		return AtomRegistry.getResult(registry, query, {
			suspendOnWaiting: true,
		});
	});
