import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Query from "../Query.js";
import type { QuerySettings } from "./defaults.js";
import { emit } from "./events.js";
import { isFresh } from "./freshness.js";
import type { Mark } from "./live.js";
import type { Undo } from "./optimistic.js";

export { lastSuccess } from "./queryAtom.js";

import {
	cachedQuery,
	internals,
	isIdle,
	lastSuccess,
	localValue,
	nodeValue,
	peek,
	pushMark,
	restoreLocal,
	seed,
	wake,
	writeKeepingAge,
	written,
} from "./queryAtom.js";
import { type ClientState, ConfigAtom, StateAtom } from "./runtime.js";
import { isInUse } from "./usage.js";

/**
 * Indexes queries by node existence and reports them on the event channel.
 * The registry has one slot for each hook, so the client owns both.
 */
export const observeNodes = (
	registry: AtomRegistry.AtomRegistry,
	state: ClientState,
): void => {
	registry.onNodeAdded = (node) => {
		const query = cachedQuery(node.atom);
		if (query !== undefined) {
			state.index.add(query);
			emit(state, { _tag: "QueryAdded", key: query.key });
		}
	};
	registry.onNodeRemoved = (node) => {
		const query = cachedQuery(node.atom);
		if (query !== undefined) {
			state.index.delete(query);
			emit(state, { _tag: "QueryRemoved", key: query.key });
		}
	};
};

/** A query's settings: its watcher's, or resolved again if it has none yet. */
export const settings = <E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, E>,
): QuerySettings<E> => {
	const { settings, watcher } = internals(query);
	return Option.match(nodeValue(registry, watcher), {
		onSome: (watcher) => watcher.settings,
		onNone: () => settings(registry.get(ConfigAtom).queries.defaults),
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
	const mark = pushMark(registry, query);
	return guardUndo(registry, query, mark, writeValue(registry, query, value));
};

/**
 * Wraps a write's undo. A clear since the write wins: the undo would bring
 * back what was cleared, such as a signed-out account's data, so it does
 * nothing. Otherwise, for a `live` query, it applies the pushes since
 * `mark` again once it has put the query back (DESIGN.md §4.14). The mark
 * closes when the undo runs or is released.
 */
const guardUndo = (
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, any>,
	mark: Mark | undefined,
	undo: Undo,
): Undo => {
	const { clears } = registry.get(StateAtom);
	const clearsBefore = clears.get(query);
	const guarded = () => {
		if (clears.get(query) === clearsBefore) {
			undo();
			if (mark?.pushed() === true) {
				const current = peek(registry, query);
				if (
					Option.isSome(current) &&
					AsyncResult.isSuccess(current.value)
				) {
					writeKeepingAge(
						registry,
						query,
						mark.replay(current.value.value),
						current.value.timestamp,
					);
				}
			}
		}
		mark?.close();
	};
	return mark === undefined
		? guarded
		: Object.assign(guarded, { release: mark.close });
};

const writeValue = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
	value: A,
): Undo => {
	const { local, fetchAtom, cache } = internals(query);
	const previous = localValue(registry, query);
	const { generation } = previous;
	const restore = () => restoreLocal(registry, query, previous);
	const state = registry.getNodes().get(fetchAtom(generation))?.currentState();
	if (state === "valid") {
		// The cache, so a live query's stream doesn't start.
		registry.set(cache, value);
		return restore;
	}
	const target = state === "stale" ? generation + 1 : generation;
	const stale = nodeValue(registry, fetchAtom(generation));
	seed(registry, fetchAtom(target), written<A, E>(value).value);
	registry.set(local, { generation: target, written: Option.none() });
	registry.get(cache);
	if (target === generation) {
		// Undoing a write over a cleared query leaves it cleared, in a new
		// generation, so waking it later fetches rather than showing the write.
		return previous.idle === true
			? () => dropQuery(registry, query)
			: () => resetQuery(registry, query);
	}
	return Option.match(stale, {
		onNone: () => restore,
		onSome: (result) => () => {
			seed(registry, fetchAtom(generation), result);
			restore();
			registry.get(cache);
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
	const { local, fetchAtom, cache } = internals(query);
	const { generation } = localValue(registry, query);
	const target = Option.isSome(nodeValue(registry, fetchAtom(generation)))
		? generation + 1
		: generation;
	seed(registry, fetchAtom(target), result);
	registry.set(local, { generation: target, written: Option.none() });
	registry.get(cache);
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
 * Writes a value computed from each cached member's, with its argument, as
 * `updateValue` does one query. Returns one undo for them all, newest first.
 */
export const updateMembers = <Args, A>(
	registry: AtomRegistry.AtomRegistry,
	family: object,
	f: (value: A, args: Args) => A,
): Undo | undefined => {
	const undos: Array<Undo> = [];
	try {
		for (const query of registry.get(StateAtom).index) {
			const member = internals(query).member;
			if (member?.family !== family) {
				continue;
			}
			const undo = updateValue(registry, query, (value: A) =>
				f(value, member.args as Args),
			);
			if (undo !== undefined) {
				undos.push(undo);
			}
		}
	} catch (error) {
		// Nothing records these undos, so what they hold is let go.
		for (const undo of undos) {
			undo.release?.();
		}
		throw error;
	}
	return undoAll(undos);
};

/**
 * Writes a value as {@link setValue} does, with the timestamp of the success
 * it replaces, so the query stays as fresh, or as stale, as it was: an
 * entity write (DESIGN.md §4.13) patches what queries hold without making
 * them look newly fetched. Only a query whose fetch atom is up to date is
 * written; one that isn't cached, was invalidated or was cleared fetches
 * when next used, so it's left alone and this returns `undefined`.
 */
export const patchValue = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
	value: A,
	timestamp: number,
): Undo | undefined => {
	const mark = pushMark(registry, query);
	const previous = writeKeepingAge(registry, query, value, timestamp);
	if (previous === undefined) {
		mark?.close();
		return undefined;
	}
	return guardUndo(registry, query, mark, () =>
		restoreLocal(registry, query, previous),
	);
};

/** One undo for several, run newest first; `undefined` for none. */
export const undoAll = (undos: ReadonlyArray<Undo>): Undo | undefined =>
	undos.length === 0
		? undefined
		: Object.assign(
				() => {
					for (let i = undos.length - 1; i >= 0; i--) {
						undos[i]!();
					}
				},
				{
					release: () => {
						for (const undo of undos) {
							undo.release?.();
						}
					},
				},
			);

/**
 * Drops the query's value and written value in one write, which moves it to
 * a new fetch atom: in use, it fetches straight away; otherwise on its next
 * read. The old fetch atom, and any fetch it runs, goes with its last user.
 */
export const resetQuery = (
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, any>,
): void => {
	if (
		registry.getNodes().get(internals(query).cache)?.currentState() ===
		"uninitialized"
	) {
		return;
	}
	registry.update(internals(query).local, (local) => ({
		generation: local.generation + 1,
		written: Option.none(),
	}));
};

/**
 * Drops the query's value and written value, as `resetQuery` does, but a
 * query in use doesn't fetch: it moves to a new generation left idle, which
 * shows `Initial` until something asks for it (`wake`). One not in use is
 * reset, so its next read fetches. Undoing a write made before it does
 * nothing (`setValue`), and an Effect waiting on the query is interrupted
 * (`settled`).
 */
export const clearQuery = (
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, any>,
): void => {
	const { clears } = registry.get(StateAtom);
	clears.set(query, (clears.get(query) ?? 0) + 1);
	dropQuery(registry, query);
};

const dropQuery = (
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, any>,
): void => {
	// A `live` query's cache is in use without it while a fetch waits.
	if (!isInUse(registry, internals(query).cache)) {
		resetQuery(registry, query);
		return;
	}
	registry.update(internals(query).local, (local) => ({
		generation: local.generation + 1,
		written: Option.none(),
		idle: true as const,
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
		// A query `clear` left idle fetches as it wakes, if it's in use.
		wake(registry, query);
		// Reading a query that isn't cached, or was invalidated while unused,
		// fetches it, and a fetch that settles at once leaves nothing waiting
		// to tell it by. A read that doesn't fetch shows a cached value or one
		// `hydrate` left, which may be stale.
		const current = registry.get(fetchTarget(query));
		if (fetchedAt.get(query) === before) {
			if (isFresh(current, settings(registry, query).staleTime)) {
				return Effect.succeed(current.value);
			}
			if (!current.waiting) {
				registry.refresh(query);
			}
		}
		return settled(registry, query, Effect.interrupt);
	});

/**
 * What a fetch reads and waits on: the query, or for a `live` query its
 * cache, so it doesn't start the query's pushes (`Query.stream` queries
 * must start their stream: their value is its elements).
 */
const fetchTarget = <A, E>(
	query: Query.Query<A, E>,
): Atom.Atom<AsyncResult.AsyncResult<A, E>> => {
	const { live, cache } = internals(query);
	return live === "Updates" ? cache : query;
};

/**
 * Waits for the query to settle, as `AtomRegistry.getResult` does, but a
 * query `clear` leaves idle settles as `whenCleared`: nothing fetches it
 * until something asks, so waiting for it would never end.
 */
export const settled = <A, E, A2, E2>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
	whenCleared: Effect.Effect<A2, E2>,
): Effect.Effect<A | A2, E | E2> =>
	Effect.callback<
		AsyncResult.Success<A, E> | AsyncResult.Failure<A, E> | undefined
	>((resume) => {
		const check = (result: AsyncResult.AsyncResult<A, E>): boolean => {
			if (isIdle(registry, query)) {
				resume(Effect.succeed(undefined));
				return true;
			}
			if (result._tag !== "Initial" && !result.waiting) {
				resume(Effect.succeed(result));
				return true;
			}
			return false;
		};
		const target = fetchTarget(query);
		if (check(registry.get(target))) {
			return;
		}
		const cancel = registry.subscribe(target, (result) => {
			if (check(result)) {
				cancel();
			}
		});
		return Effect.sync(cancel);
	}).pipe(
		Effect.flatMap((result): Effect.Effect<A | A2, E | E2> =>
			result === undefined
				? whenCleared
				: result._tag === "Success"
					? Effect.succeed(result.value)
					: Effect.failCause(result.cause),
		),
	);
