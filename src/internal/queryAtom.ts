import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type * as Scope from "effect/Scope";

import type * as Query from "../Query.js";
import type * as QueryClient from "../QueryClient.js";
import { resolveGcTime, resolveQueryOptions } from "./defaults.js";
import { emit } from "./events.js";
import { type Watcher, watch } from "./freshness.js";
import { hashKey } from "./hashKey.js";
import { forkQueryHooks } from "./hooks.js";
import {
	type Codec,
	decodeResult,
	hashOption,
	type Hydration,
} from "./hydration.js";
import {
	type ClientState,
	ConfigAtom,
	ReactivityAtom,
	RegistryAtom,
	runtime,
	StateAtom,
	track,
} from "./runtime.js";

export const QueryTypeId = "~@monarcode/effetch-query/Query" as const;
export type QueryTypeId = typeof QueryTypeId;

const InternalsId = "~@monarcode/effetch-query/Query/internals";

type Run<A, E> = (
	context: Query.RunContext,
) => Effect.Effect<A, E, QueryClient.Requirements | Scope.Scope>;

/** What a query's fetch gets from the fetch atom building it. */
export interface FetchContext<A, E> {
	readonly get: Atom.AtomContext;
	/**
	 * What the query showed before this fetch: its value, a value written
	 * over it, or the last success before a failure. None after a reset.
	 */
	readonly previous: () => Option.Option<A>;
	/** Runs one attempt of the query's work: in its own scope, with its `retry`. */
	readonly attempt: <X>(
		run: Run<X, E>,
	) => Effect.Effect<X, E, QueryClient.Requirements>;
}

/** One fetch of a query, built from its {@link FetchContext}. */
export type Fetch<A, E> = (
	context: FetchContext<A, E>,
) => Effect.Effect<A, E, QueryClient.Requirements>;

/** The family a query belongs to, and its argument, for `Query.update` on a family. */
export interface Member {
	readonly family: object;
	readonly args: unknown;
}

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
	readonly member: Member | undefined;
	/** Set for a query with a `schema`: how it crosses the wire (DESIGN.md §3.12). */
	readonly hydration: QueryHydration<A, E> | undefined;
	readonly local: Atom.Writable<Local<A, E>>;
	readonly fetchAtom: (
		generation: number,
	) => Atom.Atom<AsyncResult.AsyncResult<A, E>>;
	readonly watcher: Atom.Atom<Watcher<E>>;
}

export interface QueryHydration<A, E> {
	readonly codec: Codec<A, E>;
	/** The string the query is found by; throws `NonJsonKey`. */
	readonly hash: () => string;
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

/** Whether a query is one of the family's members. */
export const isMember = (
	query: Query.Query<any, any>,
	family: object,
): boolean => internals(query).member?.family === family;

/** A query's fetch: one attempt of `run`. */
export const runOnce =
	<A, E>(run: Run<A, E>): Fetch<A, E> =>
	({ attempt }) =>
		attempt(run);

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

export const nodeValue = <A>(
	registry: AtomRegistry.AtomRegistry,
	atom: AtomRegistry.Node<A>["atom"],
): Option.Option<A> =>
	(registry.getNodes().get(atom)?.valueOption() as
		| Option.Option<A>
		| undefined) ?? Option.none();

export const localValue = <A, E>(
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

// The node takes `skipInitialRun` as `initialValues` does, though its
// interface leaves the parameter out.
export const seed = <A>(
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<A>,
	value: A,
): void =>
	(
		registry.ensureNode(atom) as unknown as {
			setInitialValue(value: A, skipInitialRun: boolean): void;
		}
	).setInitialValue(value, true);

/** Where `hydrate` left a value for a query in the registry's preload map. */
const preloadedHash = (
	registry: AtomRegistry.AtomRegistry,
	hydration: QueryHydration<any, any>,
): Option.Option<string> =>
	registry.preloadedSerializable.size === 0
		? Option.none()
		: Option.filter(hashOption(hydration.hash), (hash) =>
				registry.preloadedSerializable.has(hash),
			);

/**
 * The value `hydrate` left for a query, decoded once per value: React reads
 * a query's server snapshot again and again while it hydrates, and needs
 * one object each time.
 */
const preloadedResult = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	hydration: QueryHydration<A, E>,
): Option.Option<AsyncResult.AsyncResult<A, E>> =>
	Option.flatMap(preloadedHash(registry, hydration), (hash) => {
		const json = registry.preloadedSerializable.get(hash);
		const { preloads } = registry.get(StateAtom);
		const cached = Predicate.isObjectKeyword(json)
			? preloads.get(json)
			: undefined;
		if (cached !== undefined) {
			return cached;
		}
		const result = Option.filter(
			decodeResult(hydration.codec, json),
			(result) => !AsyncResult.isInitial(result),
		);
		if (Predicate.isObjectKeyword(json)) {
			preloads.set(json, result);
		}
		return result;
	});

/**
 * Seeds a query's first fetch atom from the value `hydrate` left for it
 * (DESIGN.md §3.12). It's in the registry's preload map, where Effect's
 * `Hydration.hydrate` leaves values too, so the first read shows it without
 * fetching.
 */
const seedPreloaded = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
	hydration: QueryHydration<A, E>,
): void => {
	const hash = preloadedHash(registry, hydration);
	if (Option.isNone(hash)) {
		return;
	}
	if (Option.isNone(nodeValue(registry, atom))) {
		Option.map(preloadedResult(registry, hydration), (result) =>
			seed(registry, atom, result),
		);
	}
	registry.preloadedSerializable.delete(hash.value);
};

/** The result the server is still loading for a query, if it sent one. */
const takeStreamed = (
	state: ClientState,
	hydration: QueryHydration<any, any> | undefined,
): Promise<unknown> | undefined => {
	if (hydration === undefined || state.streamed.size === 0) {
		return undefined;
	}
	const hash = hashOption(hydration.hash);
	if (Option.isNone(hash)) {
		return undefined;
	}
	const streamed = state.streamed.get(hash.value);
	state.streamed.delete(hash.value);
	return streamed;
};

/**
 * A fetch that waits for the server's result instead of running: it shows
 * the result that lands, or runs `fetch` when it lands as nothing to show
 * (a failure the server kept, or one the schema can't decode).
 */
const fromServer = <A, E, R>(
	streamed: Promise<unknown>,
	codec: Codec<A, E>,
	fetch: () => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
	Effect.flatMap(
		Effect.promise(() =>
			streamed.then(
				(json) => decodeResult(codec, json),
				() => Option.none(),
			),
		),
		(result) => {
			if (Option.isSome(result) && AsyncResult.isSuccess(result.value)) {
				return Effect.succeed(result.value.value);
			}
			if (Option.isSome(result) && AsyncResult.isFailure(result.value)) {
				return Effect.failCause(result.value.cause);
			}
			return Effect.suspend(fetch);
		},
	);

/** Builds a query atom (DESIGN.md §5.2). */
export const makeQuery = <A, E>(definition: {
	readonly key: Query.QueryKey;
	readonly fetch: Fetch<A, E>;
	readonly options: Query.Options<E>;
	readonly member?: Member | undefined;
	/** Atoms that live as long as the query, without refetching it when they change. */
	readonly mounts?: ReadonlyArray<Atom.Atom<unknown>> | undefined;
	readonly hydration?: Hydration<A, E> | undefined;
}): Query.Query<A, E> => {
	const {
		key,
		fetch: makeFetch,
		options,
		member,
		mounts = [],
		hydration: definitionHydration,
	} = definition;
	let hash: string | undefined;
	const hydration: QueryHydration<A, E> | undefined = definitionHydration && {
		codec: definitionHydration.codec,
		hash: () => (hash ??= hashKey(key, definitionHydration.kind)),
	};
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
			const runContext: Query.RunContext = {
				result: (query) => get.result(query),
			};
			const context: FetchContext<A, E> = {
				get,
				previous: () => {
					const { written: value } = get.once(local);
					const shown = Option.match(
						get.self<AsyncResult.AsyncResult<A, E>>(),
						{
							onNone: () =>
								Option.map(value, (written) => written.value),
							onSome: (result) => Option.some(combine(result, value)),
						},
					);
					return Option.flatMap(shown, AsyncResult.value);
				},
				// Each attempt gets its own scope, closed in its fiber, and the
				// client tracks the fiber: `dispose()` waits for both.
				attempt: (run) => {
					const once = Effect.scoped(run(runContext));
					return retry === undefined ? once : Effect.retry(once, retry);
				},
			};
			const streamed = takeStreamed(get.once(StateAtom), hydration);
			const fetch =
				streamed === undefined || hydration === undefined
					? makeFetch(context)
					: fromServer(streamed, hydration.codec, () =>
							makeFetch(context),
						);
			return Effect.withFiber((fiber) => {
				const state = get.once(StateAtom);
				track(state, fiber);
				state.fetchedAt.set(query, ++state.fetchCount);
				emit(state, { _tag: "FetchStarted", key, fetchId: fiber.id });
				return Effect.onExit(fetch, (exit) =>
					Effect.suspend(() => {
						emit(state, {
							_tag: "FetchSettled",
							key,
							fetchId: fiber.id,
							exit,
							awaited: state.awaited.has(query),
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
					for (const atom of mounts) {
						get.mount(atom);
					}
					if (generation === 0 && hydration !== undefined) {
						seedPreloaded(get.registry, fetchAtom(0), hydration);
					}
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
			// A server render reads the cache and never fetches (DESIGN.md §5.8).
			// React reads this while hydrating server HTML too, before the query
			// is read, so it shows a value `hydrate` left as the read will. It
			// leaves the value for that read: a fetch atom seeded here has nothing
			// observing it, and the registry drops such a node on its next task,
			// which can come before React subscribes.
			[Atom.ServerValueTypeId]: (get: <X>(atom: Atom.Atom<X>) => X) => {
				const registry = get(RegistryAtom);
				return peek(registry, query).pipe(
					Option.orElse(() =>
						hydration !== undefined &&
						localValue(registry, query).generation === 0
							? preloadedResult(registry, hydration)
							: Option.none(),
					),
					Option.getOrElse(() => AsyncResult.initial<A, E>(true)),
				);
			},
			[InternalsId]: {
				options,
				member,
				hydration,
				local,
				fetchAtom,
				watcher,
			},
		},
	);
	return query;
};
