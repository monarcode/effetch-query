import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type * as Scope from "effect/Scope";

import type * as Query from "../Query.js";
import type * as QueryClient from "../QueryClient.js";
import { resolveGcTime, resolveQueryOptions } from "./defaults.js";
import { emit } from "./events.js";
import { type Watcher, watch } from "./freshness.js";
import { forkQueryHooks } from "./hooks.js";
import { ConfigAtom, ReactivityAtom, runtime, StateAtom } from "./runtime.js";

export const QueryTypeId = "~@monarcode/effetch-query/Query" as const;
export type QueryTypeId = typeof QueryTypeId;

const InternalsId = "~@monarcode/effetch-query/Query/internals";

type Run<A, E> = (
	context: Query.RunContext,
) => Effect.Effect<A, E, QueryClient.Requirements | Scope.Scope>;

/**
 * A value written with `Query.set`. It's shown until a fetch settles after
 * it: the fetch marks it in its `onExit`, before its result is committed, so
 * the query goes from the written value straight to the new one. A failed
 * fetch keeps it as the last success.
 */
interface Written<A, E> {
	readonly value: AsyncResult.Success<A, E>;
	state: "shown" | "failed" | "replaced";
}

/**
 * What a query holds besides its fetches. One atom, so `reset` changes the
 * generation and drops the written value in one write.
 */
export interface Local<A, E> {
	/** Bumped by `reset`: the query then reads a fetch atom with no previous value. */
	readonly generation: number;
	readonly written: Option.Option<Written<A, E>>;
}

export interface Internals<A, E> {
	readonly options: Query.Options<E>;
	readonly local: Atom.Writable<Local<A, E>>;
	readonly fetchAtom: (
		generation: number,
	) => Atom.Atom<AsyncResult.AsyncResult<A, E>>;
	readonly watcher: Atom.Atom<Watcher<E>>;
}

interface QueryWithInternals<A, E> extends Query.Query<A, E> {
	readonly [InternalsId]: Internals<A, E>;
}

export const isQuery = (
	value: unknown,
): value is Query.Query<unknown, unknown> =>
	Atom.isAtom(value) && QueryTypeId in value;

export const internals = <A, E>(query: Query.Query<A, E>): Internals<A, E> =>
	(query as QueryWithInternals<A, E>)[InternalsId];

export const toRun = <A, E>(run: Query.MakeOptions<A, E>["run"]): Run<A, E> =>
	Effect.isEffect(run) ? () => run : (run as Run<A, E>);

/** What a query shows: its fetch's result, or a value written over it. */
export const combine = <A, E>(
	result: AsyncResult.AsyncResult<A, E>,
	written: Option.Option<Written<A, E>>,
): AsyncResult.AsyncResult<A, E> => {
	if (Option.isNone(written) || written.value.state === "replaced") {
		return result;
	}
	const { value, state } = written.value;
	if (state === "shown") {
		return result.waiting ? AsyncResult.waiting(value) : value;
	}
	return AsyncResult.isFailure(result)
		? AsyncResult.failure(result.cause, {
				previousSuccess: Option.some(value),
				waiting: result.waiting,
			})
		: result;
};

export const written = <A, E>(value: A): Written<A, E> => ({
	value: AsyncResult.success(value),
	state: "shown",
});

const markWritten = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	local: Atom.Atom<Local<A, E>>,
	generation: number,
	exit: Exit.Exit<A, E>,
): void => {
	const current = registry.getNodes().get(local)?.valueOption() as
		| Option.Option<Local<A, E>>
		| undefined;
	if (
		current === undefined ||
		Option.isNone(current) ||
		current.value.generation !== generation ||
		Option.isNone(current.value.written) ||
		current.value.written.value.state === "replaced"
	) {
		return;
	}
	current.value.written.value.state = Exit.isSuccess(exit)
		? "replaced"
		: "failed";
};

/** Builds a query atom (DESIGN.md §5.2). */
export const makeQuery = <A, E>(definition: {
	readonly key: Query.QueryKey;
	readonly run: Run<A, E>;
	readonly options: Query.Options<E>;
}): Query.Query<A, E> => {
	const { key, run, options } = definition;
	const { reactivityKeys } = options;
	// The client's defaults are read at run time, so one definition serves
	// every client; the watcher resolves them once per query node.
	const watcher = Atom.readable((get) =>
		watch(
			get,
			query,
			resolveQueryOptions(options, get.once(ConfigAtom).queries.defaults),
		),
	);
	// Refreshing the query refreshes this, and every fetch atom reads it, so
	// a refresh refetches whichever generation is current.
	const refreshSignal = Atom.readable(() => ({}));
	const local = Atom.make<Local<A, E>>({
		generation: 0,
		written: Option.none(),
	});
	const fetchAtom = Atom.family((generation: number) =>
		runtime.atom((get) => {
			get(refreshSignal);
			const { registry } = get;
			if (reactivityKeys !== undefined) {
				// Registered for this build, which a refresh ends: a stale fetch
				// atom refetches on its next read anyway.
				get.subscribe(
					ReactivityAtom,
					(reactivity) => {
						if (AsyncResult.isSuccess(reactivity)) {
							get.addFinalizer(
								reactivity.value.registerUnsafe(reactivityKeys, () =>
									registry.refresh(query),
								),
							);
						}
					},
					{ immediate: true },
				);
			}
			const { retry } = get(watcher).settings;
			const { queries } = get.once(ConfigAtom);
			// Each attempt gets its own scope, closed in its fiber, and the
			// client tracks the fiber: `dispose()` waits for both.
			const attempt = Effect.scoped(
				run({ result: (query) => get.result(query) }),
			);
			const fetch =
				retry === undefined ? attempt : Effect.retry(attempt, retry);
			return Effect.withFiber((fiber) => {
				const state = get.once(StateAtom);
				state.fibers.add(fiber);
				emit(state, { _tag: "FetchStarted", key, fetchId: fiber.id });
				return Effect.onExit(fetch, (exit) =>
					Effect.suspend(() => {
						state.fibers.delete(fiber);
						emit(state, {
							_tag: "FetchSettled",
							key,
							fetchId: fiber.id,
							exit,
						});
						// An interrupted fetch was replaced or left: it isn't a failure.
						if (
							Exit.isFailure(exit) &&
							Cause.hasInterruptsOnly(exit.cause)
						) {
							return Effect.void;
						}
						markWritten(registry, local, generation, exit);
						return forkQueryHooks(state, queries, key, exit);
					}),
				);
			});
		}),
	);

	const query: QueryWithInternals<A, E> = Object.assign(
		Atom.setIdleTTL(
			Atom.writable(
				(get): AsyncResult.AsyncResult<A, E> => {
					const { generation, written } = get(local);
					const result = combine(get(fetchAtom(generation)), written);
					get(watcher).resume();
					return result;
				},
				(ctx, value: A) => {
					ctx.set(local, {
						generation: ctx.get(local).generation,
						written: Option.some(written<A, E>(value)),
					});
				},
				(refresh) => {
					refresh(refreshSignal);
				},
			),
			resolveGcTime(options),
		),
		{
			[QueryTypeId]: QueryTypeId,
			key,
			initialValueTarget: fetchAtom(0),
			[InternalsId]: { options, local, fetchAtom, watcher },
		},
	);
	return query;
};
