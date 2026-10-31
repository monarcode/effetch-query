import * as Effect from "effect/Effect";
import type * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { afterEach, describe, expect, it } from "vitest";

import { QueryClient, type Signals } from "../src/index.js";
import {
	type AppStateLike,
	type NetInfoLike,
	reactNativeSignals,
} from "../src/react-native/index.js";
import { disposeClients, makeClient, tracked, use } from "./helpers.js";
import { greetingLayer } from "./services.js";

// Run even when an assertion fails, so no listener outlives its test.
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
	await disposeClients();
});

const makeRegistry = () => {
	const registry = AtomRegistry.make();
	cleanups.push(() => registry.dispose());
	return registry;
};

/** A client that hasn't used a query yet, unlike `makeClient`'s. */
const makeIdleClient = (signals: Signals.Signals) => {
	const client = QueryClient.make({ layer: greetingLayer("hello"), signals });
	cleanups.push(() => client.dispose());
	return client;
};

/** `AppState` and NetInfo stand-ins a test drives, and counts listeners on. */
const fakeNative = (options?: {
	readonly currentState?: string | null | undefined;
	readonly isConnected?: boolean | null | undefined;
}) => {
	const appListeners = new Set<(state: string) => void>();
	let lastNetListener:
		| ((state: { readonly isConnected: boolean | null }) => void)
		| undefined;
	const netListeners = new Set<
		(state: { readonly isConnected: boolean | null }) => void
	>();
	const AppState: AppStateLike = {
		currentState:
			options !== undefined && "currentState" in options
				? options.currentState
				: "active",
		addEventListener: (_, listener) => {
			appListeners.add(listener);
			return { remove: () => appListeners.delete(listener) };
		},
	};
	const NetInfo: NetInfoLike = {
		addEventListener: (listener) => {
			netListeners.add(listener);
			lastNetListener = listener;
			// NetInfo reports what it knows straight away.
			if (options?.isConnected !== undefined) {
				listener({ isConnected: options.isConnected });
			}
			return () => netListeners.delete(listener);
		},
	};
	return {
		signals: reactNativeSignals({ AppState, NetInfo }),
		appState: (state: string) => {
			for (const listener of appListeners) listener(state);
		},
		network: (isConnected: boolean | null) => {
			for (const listener of netListeners) listener({ isConnected });
		},
		listeners: () => appListeners.size + netListeners.size,
		/** What NetInfo does when its first report arrives after unsubscribing. */
		lateReport: (isConnected: boolean | null) =>
			lastNetListener?.({ isConnected }),
	};
};

const watch = <A>(
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<A>,
): Array<A> => {
	const seen: Array<A> = [];
	registry.subscribe(atom, (value) => seen.push(value), { immediate: true });
	return seen;
};

describe("reactNativeSignals", () => {
	it("focus ticks only on a change to active", () => {
		const native = fakeNative({ currentState: "active" });
		const registry = makeRegistry();
		const focus = watch(registry, native.signals.focus);

		native.appState("active");
		native.appState("inactive");
		native.appState("active");
		native.appState("background");
		native.appState("background");
		native.appState("active");

		expect(focus).toEqual([0, 1, 2]);
	});

	it("focus ticks on the first active when the state isn't known at start", () => {
		const native = fakeNative({ currentState: null });
		const registry = makeRegistry();
		const focus = watch(registry, native.signals.focus);

		native.appState("active");

		expect(focus).toEqual([0, 1]);
	});

	it("online follows isConnected, with null counting as online", () => {
		const native = fakeNative();
		const registry = makeRegistry();
		const online = watch(registry, native.signals.online);

		native.network(false);
		native.network(null);
		native.network(false);
		native.network(true);

		expect(online).toEqual([true, false, true, false, true]);
	});

	it("online starts from what NetInfo reports as it subscribes", () => {
		const native = fakeNative({ isConnected: false });
		const registry = makeRegistry();
		const online = watch(registry, native.signals.online);

		native.network(true);

		expect(online).toEqual([false, true]);
	});

	it("listeners start when used and are removed on dispose", async () => {
		const native = fakeNative();
		const client = makeIdleClient(native.signals);
		expect(native.listeners()).toBe(0);

		const { query } = tracked(["native"], () => Effect.succeed(1));
		use(client.registry, query);
		expect(native.listeners()).toBe(2);

		await client.dispose();
		expect(native.listeners()).toBe(0);
	});

	it("one set of signals serves several clients, each with its own listeners", async () => {
		const native = fakeNative({ currentState: "background" });
		const first = makeIdleClient(native.signals);
		const second = makeIdleClient(native.signals);
		const one = tracked(["shared", 1], (fetch) => Effect.succeed(fetch));
		const two = tracked(["shared", 2], (fetch) => Effect.succeed(fetch));
		use(first.registry, one.query);
		use(second.registry, two.query);
		expect(native.listeners()).toBe(4);

		await first.dispose();
		expect(native.listeners()).toBe(2);
		native.appState("active");

		expect(one.fetches.count).toBe(1);
		expect(two.fetches.count).toBe(2);
	});

	it("ignores a NetInfo report that arrives after its client is disposed", async () => {
		const native = fakeNative();
		const client = makeIdleClient(native.signals);
		const { query } = tracked(["late"], () => Effect.succeed(1));
		use(client.registry, query);
		await client.dispose();

		expect(() => native.lateReport(false)).not.toThrow();
	});

	it("a client refetches stale queries on focus and reconnect", async () => {
		const native = fakeNative({ currentState: "background" });
		const client = await makeClient({ signals: native.signals });
		const { fetches, query } = tracked(["native", "stale"], (fetch) =>
			Effect.succeed(fetch),
		);
		use(client.registry, query);

		native.appState("active");
		native.network(false);
		native.network(true);

		expect(fetches.count).toBe(3);
	});
});
