import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Reactivity from "effect/reactivity/Reactivity";

import type { Query } from "../Query.js";
import type * as QueryClient from "../QueryClient.js";
import type { Signals } from "../Signals.js";
import type { CacheEvent } from "./events.js";

/** What `QueryClient.make` stores for queries and mutations to read at run time. */
export interface Config {
	readonly signals: Signals | undefined;
	readonly queries: QueryClient.QueriesOptions;
	readonly mutations: QueryClient.MutationsOptions;
}

const defaultConfig: Config = {
	signals: undefined,
	queries: {},
	mutations: {},
};

/** A client's own mutable state. It lives in the client's registry. */
export interface ClientState {
	/** The queries that have a node in the registry (see `cache.ts`). */
	readonly index: Set<Query<any, any>>;
	/** Listeners on the cache event channel (see `events.ts`). */
	readonly listeners: Set<(event: CacheEvent) => void>;
	/** Fetches, hooks and mutation runs in flight, which `dispose()` interrupts and waits for. */
	readonly fibers: Set<Fiber.Fiber<unknown, unknown>>;
	/** Set when `dispose()` starts. The registry throws once it's disposed. */
	disposed: boolean;
	/** What suspended readers wait on, one per query (see `suspense.ts`). */
	readonly suspensions: Map<Query<any, any>, Promise<void>>;
	/** How many fetches have started, which orders them (see `queryUse.ts`). */
	fetchCount: number;
	/** Each query's latest fetch, by its place in `fetchCount`. */
	readonly fetchedAt: WeakMap<Query<any, any>, number>;
	/**
	 * Results the server was still loading when it sent the cache, by hash:
	 * the query's next fetch waits for one instead of fetching (see
	 * `dehydrate.ts`).
	 */
	readonly streamed: Map<string, Promise<unknown>>;
	/** Run by `dispose()`: settles the promises `dehydrate` handed out. */
	readonly onDispose: Set<() => void>;
}

export const makeClientState = (): ClientState => ({
	index: new Set(),
	listeners: new Set(),
	fibers: new Set(),
	disposed: false,
	suspensions: new Map(),
	fetchCount: 0,
	fetchedAt: new WeakMap(),
	streamed: new Map(),
	onDispose: new Set(),
});

/** Adds a fiber to the ones `dispose()` interrupts, until it ends. */
export const track = (
	state: ClientState,
	fiber: Fiber.Fiber<unknown, unknown>,
): void => {
	state.fibers.add(fiber);
	fiber.addObserver(() => {
		state.fibers.delete(fiber);
	});
};

/**
 * Refreshes an atom whose value lives outside the registry, if it has a
 * node: refreshing one with none would create a node that's never swept.
 */
export const refreshIfBuilt = (
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<unknown>,
): void => {
	if (registry.getNodes().has(atom)) {
		registry.refresh(atom);
	}
};

/** Reads the registry from an atom read that's only given `get`. */
export const RegistryAtom = Atom.readable((get) => get.registry);

/** The defect an atom dies with when it's read in a registry no client made. */
export class MissingQueryClient extends Data.TaggedError("MissingQueryClient")<{
	readonly message: string;
}> {}

const missingClient: Effect.Effect<Context.Context<QueryClient.Requirements>> =
	Effect.suspend(() =>
		Effect.die(
			new MissingQueryClient({
				message:
					"No QueryClient: this atom was read in a registry that no QueryClient created. Read it through queryClient.registry (with React, wrap the app in <QueryProvider client={queryClient}>).",
			}),
		),
	);

// The injected atoms must be keep-alive: a registry applies its initial values
// when it's created, so a node removed while unused would lose its value. They
// are definitions only; each client's values live in its own registry.
// The client's services: its runtime's context, built on first use.
const ContextAtom = Atom.keepAlive(Atom.readable(() => missingClient));
const MemoMapAtom = Atom.keepAlive(
	Atom.readable(() => Layer.makeMemoMapUnsafe()),
);
export const ConfigAtom = Atom.keepAlive(Atom.readable(() => defaultConfig));
export const StateAtom = Atom.keepAlive(Atom.readable(makeClientState));

const initialValue = <A>(atom: Atom.Atom<A>, value: A) =>
	[atom, value] as const;

/** The values `QueryClient.make` injects into its registry. */
export const initialValues = (input: {
	readonly context: Effect.Effect<Context.Context<QueryClient.Requirements>>;
	readonly memoMap: Layer.MemoMap;
	readonly state: ClientState;
	readonly options: QueryClient.Options;
}): ReadonlyArray<readonly [Atom.Atom<unknown>, unknown]> => [
	initialValue(ContextAtom, input.context),
	initialValue(MemoMapAtom, input.memoMap),
	initialValue(ConfigAtom, {
		signals: input.options.signals,
		queries: input.options.queries ?? {},
		mutations: input.options.mutations ?? {},
	}),
	initialValue(StateAtom, input.state),
];

/**
 * The client's `Reactivity`. Built with the client's memo map, it's the
 * instance `client.runPromise` provides, so queries hear its invalidations.
 */
export const ReactivityAtom = Atom.keepAlive(
	Atom.make((get) =>
		Effect.flatMap(Effect.scope, (scope) =>
			Layer.buildWithMemoMap(Reactivity.layer, get(MemoMapAtom), scope),
		).pipe(Effect.map(Context.get(Reactivity.Reactivity))),
	),
);

/**
 * Starts an Effect with the client's services, outside any atom, and tracks
 * it. Mutation runs start here: they outlive the atoms that show them.
 */
export const forkWithClient = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	effect: Effect.Effect<A, E, QueryClient.Requirements>,
): Fiber.Fiber<A, E> => {
	const state = registry.get(StateAtom);
	const fiber = Effect.runFork(
		Effect.flatMap(registry.get(ContextAtom), (context) =>
			Effect.provideContext(effect, context),
		),
	);
	track(state, fiber);
	return fiber;
};

/** The one atom runtime every query runs on. */
export const runtime: Atom.AtomRuntime<QueryClient.Requirements> = Atom.context(
	{ memoMap: MemoMapAtom },
)((get) => Layer.effectContext(get(ContextAtom)));
