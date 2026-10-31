import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Query from "../Query.js";
import { type QuerySettings, resolveQueryOptions } from "./defaults.js";
import { emit } from "./events.js";
import { isFresh } from "./freshness.js";
import {
	combine,
	internals,
	isQuery,
	type Local,
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

export const nodeValue = <A>(
	registry: AtomRegistry.AtomRegistry,
	atom: AtomRegistry.Node<A>["atom"],
): Option.Option<A> =>
	(registry.getNodes().get(atom)?.valueOption() as
		| Option.Option<A>
		| undefined) ?? Option.none();

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

const localValue = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
): Local<A, E> =>
	Option.getOrElse(
		nodeValue<Local<A, E>>(registry, internals(query).local),
		(): Local<A, E> => ({ generation: 0, written: Option.none() }),
	);

/**
 * What a query shows, without building or fetching it: from its nodes'
 * values, which a stale node still holds.
 */
export const peek = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
): Option.Option<AsyncResult.AsyncResult<A, E>> => {
	const { generation, written: value } = localValue(registry, query);
	const result = nodeValue(registry, internals(query).fetchAtom(generation));
	if (Option.isNone(result)) {
		return Option.map(value, (written) => written.value);
	}
	return Option.some(combine(result.value, value));
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
 */
export const setValue = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
	value: A,
): void => {
	const { local, fetchAtom } = internals(query);
	const { generation } = localValue(registry, query);
	const state = registry.getNodes().get(fetchAtom(generation))?.currentState();
	if (state === "valid") {
		registry.set(query, value);
		return;
	}
	const target = state === "stale" ? generation + 1 : generation;
	// The node takes `skipInitialRun` as `initialValues` does, though its
	// interface leaves the parameter out.
	(
		registry.ensureNode(fetchAtom(target)) as unknown as {
			setInitialValue(value: unknown, skipInitialRun: boolean): void;
		}
	).setInitialValue(written(value).value, true);
	registry.set(local, { generation: target, written: Option.none() });
	registry.get(query);
};

export const updateValue = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
	f: (value: A) => A,
): void => {
	const current = Option.flatMap(peek(registry, query), AsyncResult.value);
	if (Option.isSome(current)) {
		registry.set(query, f(current.value));
	}
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
