import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type * as Query from "../Query.js";
import type * as QueryClient from "../QueryClient.js";
import {
	type QuerySettings,
	resolveGcTime,
	resolveQueryOptions,
} from "./defaults.js";
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
import { type Mark, openMark, recordPush } from "./live.js";
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
const CacheOfId = "~@monarcode/effetch-query/Query/cacheOf";

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
	/**
	 * Set by `clear` on a query in use: it shows an idle `Initial` and doesn't
	 * read its fetch atom, so nothing fetches until something asks
	 * ({@link wake}). Any other write to `local` drops it.
	 */
	readonly idle?: true | undefined;
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
	/**
	 * The atom that holds the query's value: the query itself, or for a live
	 * query, the atom it reads, which outlives its readers for `gcTime`.
	 */
	readonly cache: Atom.Writable<AsyncResult.AsyncResult<A, E>, A>;
	/** The query's settings, from its options and the client's defaults. */
	readonly settings: (
		defaults: QueryClient.QueryDefaults | undefined,
	) => QuerySettings<E>;
	/** What keeps it live, if anything ({@link Live}). */
	readonly live: Live<A, E>["_tag"] | undefined;
	/** A stream query's stream atom per generation, which waits until its first element. */
	readonly stream:
		| ((
				generation: number,
		  ) => Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>)
		| undefined;
}

/** What a fetch needs once it settles, read when it starts. */
interface FetchRun {
	readonly registry: AtomRegistry.AtomRegistry;
	readonly state: ClientState;
	readonly queries: QueryClient.QueriesOptions;
}

export interface QueryHydration<A, E> {
	readonly codec: Codec<A, E>;
	/** The string the query is found by; throws `NonJsonKeyError`. */
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

/** A written value: now, or at `timestamp` for a write that keeps the age of the value it replaces. */
export const written = <A, E>(value: A, timestamp?: number): Written<A, E> => ({
	value:
		timestamp === undefined
			? AsyncResult.success(value)
			: AsyncResult.success(value, { timestamp }),
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

/**
 * Whether a result's value isn't its query's own: the value its
 * `placeholder` gave, or a reader's copy of a borrowed value
 * ({@link markPlaceholder}).
 */
export const isPlaceholder = (
	registry: AtomRegistry.AtomRegistry,
	result: AsyncResult.AsyncResult<any, any>,
): boolean => registry.get(StateAtom).placeholders.has(result);

/** Marks a result whose value isn't its query's own, for {@link isPlaceholder}. */
export const markPlaceholder = <R extends AsyncResult.AsyncResult<any, any>>(
	registry: AtomRegistry.AtomRegistry,
	result: R,
): R => {
	registry.get(StateAtom).placeholders.add(result);
	return result;
};

/** Whether `clear` left the query idle. */
export const isIdle = (
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, any>,
): boolean => localValue(registry, query).idle === true;

/**
 * Lets a query `clear` left idle fetch again: at once if it's in use,
 * otherwise when it's next read. Returns whether it was idle.
 */
export const wake = (
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, any>,
): boolean => {
	if (!isIdle(registry, query)) {
		return false;
	}
	registry.update(internals(query).local, ({ generation, written }) => ({
		generation,
		written,
	}));
	return true;
};

/**
 * Wakes a query `clear` left idle for a reader whose fetch reads it, once the
 * running code is done: a `clear` that left it idle may be clearing the
 * reader too, and the reader's fetch is a stale one then.
 */
const wakeForReader = (
	registry: AtomRegistry.AtomRegistry,
	dependency: Query.Query<any, any>,
	reader: Query.Query<any, any>,
	generation: number,
): void => {
	const state = registry.get(StateAtom);
	queueMicrotask(() => {
		const local = state.disposed ? undefined : localValue(registry, reader);
		if (local?.idle !== true && local?.generation === generation) {
			wake(registry, dependency);
		}
	});
};

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
	const { fetchAtom, stream } = internals(query);
	const { generation, written: value } = localValue(registry, query);
	const result = nodeValue(registry, fetchAtom(generation));
	const shown = Option.isNone(result)
		? Option.map(value, (written) => written.value)
		: Option.some(combine(result.value, value));
	// A stream query waits while its stream connects, as the query shows.
	return stream !== undefined &&
		Option.exists(
			nodeValue(registry, stream(generation)),
			(run) => run.waiting,
		)
		? Option.map(shown, (current) => AsyncResult.waiting(current))
		: shown;
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

// One object, so a server snapshot read again is the same.
const notCached = AsyncResult.initial<never, never>(true);

/**
 * How long a live query's stream outlives its last reader: the registry
 * rounds it up to its timeout resolution, about a second. A reader that
 * reads, then subscribes on a later task (React does, between render and
 * commit), or unsubscribes and subscribes again (a selector change), keeps
 * the one stream instead of restarting it.
 */
const liveGrace = Duration.millis(1);

/**
 * Waits for the atom being built to finish, so a live query's stream writes
 * nothing while it's built: the write would rebuild the query, which is
 * building it. An atom runs its Effect synchronously until it suspends, and
 * that includes `Effect.yieldNow`, so this waits for a microtask.
 */
const afterBuild = Effect.promise(() => Promise.resolve());

/**
 * What keeps a query live (DESIGN.md §4.14): a stream whose elements are its
 * value (`Query.stream`), or one whose elements update a fetched value
 * (`live`).
 */
export type Live<A, E> =
	| {
			readonly _tag: "Stream";
			readonly stream: (
				context: Query.RunContext,
			) => Stream.Stream<A, E, QueryClient.Requirements>;
	  }
	| {
			readonly _tag: "Updates";
			readonly stream: Stream.Stream<
				(value: A) => A,
				unknown,
				QueryClient.Requirements
			>;
	  };

/** A stream query's settings: its stream keeps it current, so nothing refetches it but a failure. */
const streamSettings = <E>(settings: QuerySettings<E>): QuerySettings<E> => ({
	...settings,
	staleTime: Duration.infinity,
	refetchOnMount: false,
	refetchOnFocus: false,
	refetchOnReconnect: false,
	refetchInterval: undefined,
});

/** Builds a query atom (DESIGN.md §5.2). */
export const makeQuery = <A, E>(definition: {
	readonly key: Query.Key;
	/** The query's fetch; a `Stream` query has none. */
	readonly fetch?: Fetch<A, E> | undefined;
	readonly options: Query.Options<E>;
	readonly member?: Member | undefined;
	/** Atoms that live as long as the query, without refetching it when they change. */
	readonly mounts?: ReadonlyArray<Atom.Atom<unknown>> | undefined;
	readonly hydration?: Hydration<A, E> | undefined;
	/** What to show until the first fetch settles (DESIGN.md §4.11). */
	readonly placeholder?:
		| Effect.Effect<Option.Option<A>, never, QueryClient.Requirements>
		| undefined;
	readonly live?: Live<A, E> | undefined;
}): Query.Query<A, E> => {
	const {
		key,
		fetch: makeFetch,
		options,
		member,
		mounts = [],
		hydration: definitionHydration,
		placeholder,
		live,
	} = definition;
	// Read only while the query has nothing to show, so it's dropped, and
	// runs again, as the query gets and loses a value.
	const placeholderAtom =
		placeholder === undefined
			? undefined
			: runtime.atom(
					Effect.catchCause(placeholder, (cause) =>
						Effect.as(
							Effect.logError("A query's placeholder failed", cause),
							Option.none(),
						),
					),
				);
	let hash: string | undefined;
	const hydration: QueryHydration<A, E> | undefined = definitionHydration && {
		codec: definitionHydration.codec,
		hash: () => (hash ??= hashKey(key, definitionHydration.kind)),
	};
	const { reactivityKeys } = options;
	const settings = (
		defaults: QueryClient.QueryDefaults | undefined,
	): QuerySettings<E> => {
		const resolved = resolveQueryOptions(options, defaults);
		return live?._tag === "Stream" ? streamSettings(resolved) : resolved;
	};
	// The client's defaults are read at run time, so one definition serves
	// every client; the watcher resolves them once per query node.
	const watcher = Atom.readable((get) =>
		watch(get, query, settings(get.once(ConfigAtom).queries.defaults)),
	);
	// Refreshing the query refreshes this, and every fetch atom reads it, so
	// a refresh refetches whichever generation is current.
	const refreshSignal = Atom.readable(() => ({}));
	const local = Atom.make<Local<A, E>>({
		generation: 0,
		written: Option.none(),
	});
	const subscribeReactivity = (get: Atom.AtomContext): void => {
		if (reactivityKeys === undefined) {
			return;
		}
		const { registry } = get;
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
	};
	const runContext = (
		get: Atom.AtomContext,
		generation: number,
	): Query.RunContext => ({
		result: (dependency) => {
			if (isIdle(get.registry, dependency)) {
				wakeForReader(get.registry, dependency, query, generation);
			}
			// A placeholder isn't a value to derive from: wait, as for
			// `Initial`, until the dependency's fetch replaces it.
			return isPlaceholder(get.registry, get(dependency))
				? Effect.never
				: get.result(dependency);
		},
	});
	const started = (
		state: ClientState,
		fiber: Fiber.Fiber<unknown, unknown>,
	) => {
		track(state, fiber);
		state.fetchedAt.set(query, ++state.fetchCount);
		emit(state, {
			_tag: "FetchStarted",
			key,
			query,
			fetchId: fiber.id,
		});
	};
	// What a settled fetch leaves: a written value replaced, or kept as the
	// last success, and the query hooks run.
	const afterSettled = (
		run: FetchRun,
		generation: number,
		exit: Exit.Exit<A, E>,
	): Effect.Effect<void, never, QueryClient.Requirements> =>
		Effect.suspend(() => {
			markWritten(run.registry, local, generation, exit);
			return forkQueryHooks(run.state, run.queries, key, exit);
		});
	const settled = (
		run: FetchRun,
		fiber: Fiber.Fiber<unknown, unknown>,
		generation: number,
		exit: Exit.Exit<A, E>,
	): Effect.Effect<void, never, QueryClient.Requirements> =>
		Effect.suspend(() => {
			emit(run.state, {
				_tag: "FetchSettled",
				key,
				fetchId: fiber.id,
				exit,
				awaited: run.state.awaited.has(query),
			});
			// An interrupted fetch was replaced or left: it isn't a failure.
			if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
				return Effect.void;
			}
			return afterSettled(run, generation, exit);
		});
	// Read when a fetch starts: the registry may be disposed by the time it settles.
	const fetchRun = (get: Atom.AtomContext): FetchRun => ({
		registry: get.registry,
		state: get.once(StateAtom),
		queries: get.once(ConfigAtom).queries,
	});
	const fetchAtom: (
		generation: number,
	) => Atom.Atom<AsyncResult.AsyncResult<A, E>> =
		live?._tag === "Stream"
			? // A stream query's value is written by its stream (`streamAtom`).
				Atom.family(() => Atom.make(AsyncResult.initial<A, E>()))
			: Atom.family((generation: number) =>
					runtime.atom((get) => {
						get(refreshSignal);
						subscribeReactivity(get);
						const { retry } = get(watcher).settings;
						const context: FetchContext<A, E> = {
							get,
							previous: () => {
								const { written: value } = get.once(local);
								const shown = Option.match(
									get.self<AsyncResult.AsyncResult<A, E>>(),
									{
										onNone: () =>
											Option.map(value, (written) => written.value),
										onSome: (result) =>
											Option.some(combine(result, value)),
									},
								);
								return Option.flatMap(shown, AsyncResult.value);
							},
							// Each attempt gets its own scope, closed in its fiber, and the
							// client tracks the fiber: `dispose()` waits for both.
							attempt: (run) => {
								const once = Effect.scoped(
									run(runContext(get, generation)),
								);
								return retry === undefined
									? once
									: Effect.retry(once, retry);
							},
						};
						const run = fetchRun(get);
						const { state } = run;
						const streamed = takeStreamed(state, hydration);
						const fetched = (): Effect.Effect<
							A,
							E,
							QueryClient.Requirements
						> => makeFetch!(context);
						const fetch =
							streamed === undefined || hydration === undefined
								? fetched()
								: fromServer(streamed, hydration.codec, fetched);
						return Effect.withFiber((fiber) => {
							started(state, fiber);
							return Effect.onExit(
								live === undefined
									? fetch
									: withPushes(state, query, fetch),
								(exit) => settled(run, fiber, generation, exit),
							);
						});
					}),
				);
	// Runs a stream query's stream into its fetch atom while the query is
	// read: the query reads it, and keeps it for `liveGrace` after its last
	// reader leaves. A refresh restarts it. Its own value waits until the
	// first element, which the query shows as waiting. It writes nothing
	// while it's built: a write would rebuild the query, which reads it.
	const streamAtom =
		live?._tag !== "Stream"
			? undefined
			: Atom.family((generation: number) =>
					runtime.atom((get) => {
						get(refreshSignal);
						const { retry, retryOnMount } = get(watcher).settings;
						const cell = fetchAtom(generation) as Atom.Writable<
							AsyncResult.AsyncResult<A, E>
						>;
						// A new reader of a stream that failed subscribes again only
						// with `retryOnMount`. A refresh rebuilds this atom, and does.
						if (
							!retryOnMount &&
							Option.isNone(get.self()) &&
							AsyncResult.isFailure(get.once(cell))
						) {
							return Effect.void;
						}
						subscribeReactivity(get);
						const run = fetchRun(get);
						const { registry, state } = run;
						const source = live.stream(runContext(get, generation));
						const stream =
							retry === undefined ? source : Stream.retry(source, retry);
						return Effect.withFiber((fiber) => {
							started(state, fiber);
							let first = true;
							// The first element or failure settles the fetch; a later
							// failure runs the hooks.
							const settle = (exit: Exit.Exit<A, E>) => {
								if (first) {
									first = false;
									return settled(run, fiber, generation, exit);
								}
								return Exit.isSuccess(exit)
									? Effect.void
									: afterSettled(run, generation, exit);
							};
							const elements = Stream.runForEach(stream, (value) =>
								Effect.suspend(() => {
									const exit = Exit.succeed(value);
									// So a value written over the query gives way to the next element.
									markWritten(registry, local, generation, exit);
									// One change: the value, and the query no longer waiting.
									Atom.batch(() => {
										registry.set(cell, AsyncResult.success(value));
										if (first) {
											get.setSelf(AsyncResult.success(undefined));
										}
									});
									return settle(exit);
								}),
							).pipe(
								Effect.andThen(
									Effect.suspend(() =>
										first
											? Effect.die(
													new Cause.NoSuchElementError(
														"A query's stream ended without a value",
													),
												)
											: Effect.void,
									),
								),
							);
							return Effect.onExit(
								Effect.andThen(afterBuild, elements),
								(exit) =>
									Effect.suspend(() => {
										if (Exit.isSuccess(exit) || state.disposed) {
											return Effect.void;
										}
										const failed = Exit.failCause(exit.cause);
										// Left or replaced: the query isn't read, or a new stream runs.
										if (Cause.hasInterruptsOnly(exit.cause)) {
											return first
												? settled(run, fiber, generation, failed)
												: Effect.void;
										}
										// Before the write, as for an element, so the failure shows
										// over a value written on the query.
										markWritten(registry, local, generation, failed);
										registry.set(
											cell,
											AsyncResult.failure(exit.cause, {
												previousSuccess: lastSuccess(
													registry.get(cell),
												),
											}),
										);
										return settle(failed);
									}),
							);
						});
					}),
				);
	// Runs a `live` query's update stream while the query is read, as
	// `streamAtom` does. An update that throws is logged and skipped; a
	// stream that fails is logged, and starts again when the query is next
	// read after its readers leave.
	const updatesAtom =
		live?._tag !== "Updates"
			? undefined
			: runtime.atom((get) => {
					const { registry } = get;
					const state = get.once(StateAtom);
					return Effect.withFiber((fiber) => {
						track(state, fiber);
						const run = Stream.runForEach(live.stream, (f) =>
							Effect.suspend(() => {
								try {
									push(registry, state, query, f);
									return Effect.void;
								} catch (error) {
									return Effect.logError(
										"A query's live update threw, and was skipped",
										Cause.die(error),
									);
								}
							}),
						);
						return Effect.andThen(afterBuild, run).pipe(
							Effect.catchCause((cause) =>
								Cause.hasInterruptsOnly(cause)
									? Effect.failCause(cause)
									: Effect.logError(
											"A query's live stream failed",
											cause,
										),
							),
						);
					});
				});

	const cache = Atom.setIdleTTL(
		Atom.writable(
			(get): AsyncResult.AsyncResult<A, E> => {
				const { generation, written, idle } = get(local);
				for (const atom of mounts) {
					get.mount(atom);
				}
				if (idle === true) {
					return AsyncResult.initial<A, E>();
				}
				if (generation === 0 && hydration !== undefined) {
					seedPreloaded(get.registry, fetchAtom(0), hydration);
				}
				const result = combine(get(fetchAtom(generation)), written);
				get(watcher).resume();
				if (placeholderAtom === undefined || result._tag !== "Initial") {
					return result;
				}
				const shown = get(placeholderAtom);
				if (!AsyncResult.isSuccess(shown) || Option.isNone(shown.value)) {
					return result;
				}
				const value = AsyncResult.success<A, E>(shown.value.value, {
					waiting: true,
				});
				get.once(StateAtom).placeholders.add(value);
				return value;
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
	);
	// A live query is a reader of its cache: readers keep it, and its stream,
	// while the cache keeps the value for `gcTime` (DESIGN.md §4.14).
	const atom =
		live === undefined
			? cache
			: Atom.setIdleTTL(
					Atom.writable(
						(get): AsyncResult.AsyncResult<A, E> => {
							const { generation, idle } = get(local);
							if (idle === true) {
								return get(cache);
							}
							// Read, not mounted: a mount ends when this goes stale, and
							// would restart the stream between a read and a subscribe.
							if (updatesAtom !== undefined) {
								get(updatesAtom);
								return get(cache);
							}
							// Before the stream writes its fetch atom.
							if (generation === 0 && hydration !== undefined) {
								seedPreloaded(get.registry, fetchAtom(0), hydration);
							}
							const running = get(streamAtom!(generation));
							const result = get(cache);
							return running.waiting
								? AsyncResult.waiting(result)
								: result;
						},
						(ctx, value: A) => {
							ctx.set(cache, value);
						},
						(refresh) => {
							refresh(cache);
						},
					),
					liveGrace,
				);
	const query: QueryWithInternals<A, E> = Object.assign(atom, {
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
				Option.getOrElse((): AsyncResult.AsyncResult<A, E> => notCached),
			);
		},
		[InternalsId]: {
			options,
			member,
			hydration,
			local,
			fetchAtom,
			watcher,
			cache,
			settings,
			live: live?._tag,
			stream: streamAtom,
		},
	});
	if (cache !== atom) {
		Object.assign(cache, { [CacheOfId]: query });
	}
	return query;
};

/** A result's success, or a failure's last one. */
export const lastSuccess = <A, E>(
	result: AsyncResult.AsyncResult<A, E>,
): Option.Option<AsyncResult.Success<A, E>> =>
	AsyncResult.isSuccess(result)
		? Option.some(result)
		: AsyncResult.isFailure(result)
			? result.previousSuccess
			: Option.none();

/**
 * A `live` query's fetch: pushes that come while it runs are applied again
 * to its value, which may have been read before them.
 */
const withPushes = <A, E, R>(
	state: ClientState,
	query: Query.Query<A, E>,
	fetch: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
	Effect.suspend(() => {
		const mark = openMark(state, query);
		return Effect.ensuring(
			Effect.map(fetch, (value) => mark.replay(value)),
			Effect.sync(mark.close),
		);
	});

/**
 * Applies a push to a `live` query's value (DESIGN.md §4.14): to its
 * success, keeping its age, and to whatever a fetch or an undo in progress
 * shows later. A query with no success yet, or that failed, keeps it only
 * for a fetch in progress.
 */
const push = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	state: ClientState,
	query: Query.Query<A, E>,
	f: (value: A) => A,
): void => {
	recordPush(state, query, f);
	const current = peek(registry, query);
	if (Option.isSome(current) && AsyncResult.isSuccess(current.value)) {
		writeKeepingAge(
			registry,
			query,
			f(current.value.value),
			current.value.timestamp,
		);
	}
};

/**
 * Writes over a query that has a value, with that value's timestamp, so it
 * stays as fresh, or as stale, as it was. Returns what `local` was, or
 * `undefined` when the query has no current value: it isn't cached, was
 * invalidated or was cleared, so it fetches when next used.
 */
export const writeKeepingAge = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
	value: A,
	timestamp: number,
): Local<A, E> | undefined => {
	const { local, fetchAtom } = internals(query);
	const previous = localValue(registry, query);
	const state = registry
		.getNodes()
		.get(fetchAtom(previous.generation))
		?.currentState();
	if (previous.idle === true || state !== "valid") {
		return undefined;
	}
	registry.set(local, {
		generation: previous.generation,
		written: Option.some(written<A, E>(value, timestamp)),
	});
	return previous;
};

/**
 * Puts `local` back as it was before a write. If a fetch settled over the
 * write since, the value written before it gave way too, so it comes back
 * as the fetch left it (replaced, or kept as the last success), not shown
 * over the newer result.
 */
export const restoreLocal = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
	previous: Local<A, E>,
): void => {
	const current = localValue(registry, query);
	const settled =
		current.generation === previous.generation &&
		Option.isSome(current.written) &&
		current.written.value.state !== "shown" &&
		Option.isSome(previous.written) &&
		previous.written.value.state === "shown"
			? current.written.value.state
			: undefined;
	registry.set(
		internals(query).local,
		settled === undefined
			? previous
			: {
					...previous,
					written: Option.map(previous.written, ({ value }) => ({
						value,
						state: settled,
					})),
				},
	);
};

/**
 * Opens a mark on a `live` query's pushes for an undo, so pushes since are
 * applied again once it puts the query back. `undefined` for other queries.
 */
export const pushMark = (
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<any, any>,
): Mark | undefined =>
	internals(query).live === "Updates"
		? openMark(registry.get(StateAtom), query)
		: undefined;

/** The query whose value a node holds: its cache's, for a live query. */
export const cachedQuery = (
	atom: Atom.Atom<any>,
): Query.Query<any, any> | undefined => {
	if (CacheOfId in atom) {
		return (atom as unknown as { [CacheOfId]: Query.Query<any, any> })[
			CacheOfId
		];
	}
	return isQuery(atom) && internals(atom).cache === atom ? atom : undefined;
};
