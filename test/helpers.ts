import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { vi } from "vitest";

import { Query, QueryClient } from "../src/index.js";
import { beforeUse } from "../src/internal/mountPolicy.js";
import { servicesLayer } from "./services.js";

const clients: Array<QueryClient.QueryClient> = [];

/**
 * A client whose atom runtime is built, so a fetch starts as soon as a query
 * is read: a check that nothing fetched can then run straight away.
 */
export const makeClient = async (options?: Partial<QueryClient.Options>) => {
	const client = QueryClient.make({
		layer: servicesLayer("hello"),
		...options,
	});
	clients.push(client);
	await client.runPromise(
		Query.fetch(Query.make({ key: ["warm-up"], run: Effect.void })),
	);
	return client;
};

/** Disposes the clients `makeClient` made; pass it to `afterEach`. */
export const disposeClients = async (): Promise<void> => {
	// Real timers first: a finalizer that sleeps would hang on fake ones.
	vi.useRealTimers();
	vi.restoreAllMocks();
	await Promise.all(clients.splice(0).map((client) => client.dispose()));
};

/** Disposes a client `makeClient` made, which `disposeClients` then skips. */
export const dispose = async (client: QueryClient.QueryClient) => {
	clients.splice(clients.indexOf(client), 1);
	await client.dispose();
};

export const useFakeTimers = () =>
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

export const valueOf = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
): Promise<A> => Effect.runPromise(AtomRegistry.getResult(registry, atom));

export const show = (
	result: AsyncResult.AsyncResult<unknown, unknown>,
): string => {
	const value = AsyncResult.value(result);
	return `${result._tag}${result.waiting ? "(waiting)" : ""}${
		Option.isSome(value) ? ` ${JSON.stringify(value.value)}` : ""
	}`;
};

/** Subscribes to an atom and records every value it shows. */
export const record = (
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>,
): Array<string> => {
	const seen: Array<string> = [];
	registry.subscribe(atom, (result) => seen.push(show(result)), {
		immediate: true,
	});
	return seen;
};

/** A promise a test settles by hand, for a run that waits. */
export const gate = () => {
	let open: () => void = () => {};
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { wait: Effect.promise(() => promise), open: () => open() };
};

/** A query whose run gets the number of the fetch it is. */
export const tracked = <A, E = never>(
	key: Query.QueryKey,
	run: (fetch: number) => Effect.Effect<A, E>,
	options?: Query.Options<E>,
) => {
	const fetches = { count: 0 };
	const query = Query.make({
		...options,
		key,
		run: Effect.suspend(() => run(++fetches.count)),
	});
	return { fetches, query };
};

/** A family whose members count their fetches, by argument. */
export const trackedFamily = <Args>(key: Query.QueryKey) => {
	const counts = new Map<string, number>();
	const family = Query.family({
		key,
		run: (args: Args) =>
			Effect.sync(() => {
				const label = JSON.stringify(args);
				const count = (counts.get(label) ?? 0) + 1;
				counts.set(label, count);
				return count;
			}),
	});
	const fetches = (args: Args) => counts.get(JSON.stringify(args)) ?? 0;
	return { family, fetches };
};

export const isStale = (
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<unknown>,
): boolean => registry.getNodes().get(atom)?.currentState() === "stale";

/** Waits for a query's current fetch, without starting one. */
export const settled = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
) => Effect.runPromiseExit(AtomRegistry.getResult(registry, query));

/** What a component does: the mount policy, then a subscription. */
export const use = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
): (() => void) => {
	beforeUse(registry, query);
	return registry.mount(query);
};

/** Signals a test drives by hand. */
export const manualSignals = () => {
	const focus = Atom.make(0);
	const online = Atom.make(true);
	return { focus, online, signals: { focus, online } };
};
