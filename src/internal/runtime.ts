import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";

import type * as QueryClient from "../QueryClient.js";
import type { Signals } from "../Signals.js";

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

const initialValue = <A>(atom: Atom.Atom<A>, value: A) =>
	[atom, value] as const;

/** The values `QueryClient.make` injects into its registry. */
export const initialValues = (input: {
	readonly layer: Layer.Layer<QueryClient.Requirements>;
	readonly memoMap: Layer.MemoMap;
	readonly options: QueryClient.Options;
}): ReadonlyArray<readonly [Atom.Atom<unknown>, unknown]> => [
	initialValue(LayerAtom, input.layer),
	initialValue(MemoMapAtom, input.memoMap),
	initialValue(ConfigAtom, {
		signals: input.options.signals,
		queries: input.options.queries ?? {},
		mutations: input.options.mutations ?? {},
	}),
];

/**
 * The one atom runtime every query and mutation runs on. Through the memo map
 * it shares the client's `Reactivity`, so `factory.withReactivity` hears
 * invalidations run with `client.runPromise`.
 */
export const runtime: Atom.AtomRuntime<QueryClient.Requirements> = Atom.context(
	{ memoMap: MemoMapAtom },
)((get) => get(LayerAtom));
