import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";
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
	/** Fetches in flight and their hooks, which `dispose()` interrupts and waits for. */
	readonly fibers: Set<Fiber.Fiber<unknown, unknown>>;
}

export const makeClientState = (): ClientState => ({
	index: new Set(),
	listeners: new Set(),
	fibers: new Set(),
});

/** The defect an atom dies with when it's read in a registry no client made. */
export class MissingQueryClient extends Data.TaggedError("MissingQueryClient")<{
	readonly message: string;
}> {}

const missingClientLayer: Layer.Layer<QueryClient.Requirements> =
	Layer.effectContext(
		Effect.suspend(() =>
			Effect.die(
				new MissingQueryClient({
					message:
						"No QueryClient: this atom was read in a registry that no QueryClient created. Read it through queryClient.registry (with React, wrap the app in <QueryProvider client={queryClient}>).",
				}),
			),
		),
	);

// The injected atoms must be keep-alive: a registry applies its initial values
// when it's created, so a node removed while unused would lose its value. They
// are definitions only; each client's values live in its own registry.
const LayerAtom = Atom.keepAlive(Atom.readable(() => missingClientLayer));
const MemoMapAtom = Atom.keepAlive(
	Atom.readable(() => Layer.makeMemoMapUnsafe()),
);
export const ConfigAtom = Atom.keepAlive(Atom.readable(() => defaultConfig));
export const StateAtom = Atom.keepAlive(Atom.readable(makeClientState));

const initialValue = <A>(atom: Atom.Atom<A>, value: A) =>
	[atom, value] as const;

/** The values `QueryClient.make` injects into its registry. */
export const initialValues = (input: {
	readonly layer: Layer.Layer<QueryClient.Requirements>;
	readonly memoMap: Layer.MemoMap;
	readonly state: ClientState;
	readonly options: QueryClient.Options;
}): ReadonlyArray<readonly [Atom.Atom<unknown>, unknown]> => [
	initialValue(LayerAtom, input.layer),
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

/** The one atom runtime every query and mutation runs on. */
export const runtime: Atom.AtomRuntime<QueryClient.Requirements> = Atom.context(
	{ memoMap: MemoMapAtom },
)((get) => get(LayerAtom));
