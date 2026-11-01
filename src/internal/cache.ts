import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
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
	seed,
	written,
} from "./queryAtom.js";
import { type ClientState, ConfigAtom, StateAtom } from "./runtime.js";

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

/**
 * Puts a value from the server into a cached query (DESIGN.md §3.12),
 * unless it has newer data: a success newer than its own (or its failure's
 * last one), or anything over a query that has never succeeded. The query
 * moves to a fetch atom seeded with it, as `setValue` seeds, so it shows
 * without fetching, its freshness is the server's, and a fetch it was
 * running is dropped.
 */
export const hydrateValue = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
	result: AsyncResult.AsyncResult<A, E>,
): void => {
	const shown = Option.flatMap(peek(registry, query), lastSuccess);
	if (
		Option.isSome(shown) &&
		!(
			AsyncResult.isSuccess(result) &&
			result.timestamp > shown.value.timestamp
		)
	) {
		return;
	}
	const { local, fetchAtom } = internals(query);
	const { generation } = localValue(registry, query);
	const target = Option.isSome(nodeValue(registry, fetchAtom(generation)))
		? generation + 1
		: generation;
	seed(registry, fetchAtom(target), result);
	registry.set(local, { generation: target, written: Option.none() });
	registry.get(query);
};

const lastSuccess = <A, E>(
	result: AsyncResult.AsyncResult<A, E>,
): Option.Option<AsyncResult.Success<A, E>> =>
	AsyncResult.isSuccess(result)
		? Option.some(result)
		: AsyncResult.isFailure(result)
			? result.previousSuccess
			: Option.none();

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
 * Writes a value computed from each cached member's, with its argument, as
 * `updateValue` does one query. Returns one undo for them all, newest first.
 */
export const updateMembers = <Args, A>(
	registry: AtomRegistry.AtomRegistry,
	family: object,
	f: (value: A, args: Args) => A,
): Undo | undefined => {
	const undos = Array.from(registry.get(StateAtom).index).flatMap((query) => {
		const member = internals(query).member;
		if (member?.family !== family) {
			return [];
		}
		const undo = updateValue(registry, query, (value: A) =>
			f(value, member.args as Args),
		);
		return undo === undefined ? [] : [undo];
	});
	if (undos.length === 0) {
		return undefined;
	}
	return () => {
		for (const undo of undos.reverse()) {
			undo();
		}
	};
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

/**
 * The query's value: a fresh one, or the result of a fetch. While it waits,
 * the query counts as awaited (`ClientState.awaited`), from before its read,
 * which can start a fetch that settles at once.
 */
export const fetchValue = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
): Effect.Effect<A, E> =>
	Effect.suspend(() => {
		const { awaited } = registry.get(StateAtom);
		awaited.set(query, (awaited.get(query) ?? 0) + 1);
		return Effect.ensuring(
			readOrFetch(registry, query),
			Effect.sync(() => {
				const count = (awaited.get(query) ?? 1) - 1;
				if (count === 0) {
					awaited.delete(query);
				} else {
					awaited.set(query, count);
				}
			}),
		);
	});

const readOrFetch = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
): Effect.Effect<A, E> =>
	Effect.suspend(() => {
		const { fetchedAt } = registry.get(StateAtom);
		const before = fetchedAt.get(query);
		// Reading a query that isn't cached, or was invalidated while unused,
		// fetches it, and a fetch that settles at once leaves nothing waiting
		// to tell it by. A read that doesn't fetch shows a cached value or one
		// `hydrate` left, which may be stale.
		const current = registry.get(query);
		if (fetchedAt.get(query) === before) {
			if (isFresh(current, settings(registry, query).staleTime)) {
				return Effect.succeed(current.value);
			}
			if (!current.waiting) {
				registry.refresh(query);
			}
		}
		return AtomRegistry.getResult(registry, query, {
			suspendOnWaiting: true,
		});
	});
