import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Schedule from "effect/Schedule";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Query, QueryClient, Signals } from "../src/index.js";
import { forkQueryHooks } from "../src/internal/hooks.js";
import { beforeUse } from "../src/internal/mountPolicy.js";
import { makeClientState } from "../src/internal/runtime.js";
import {
	disposeClients,
	makeClient,
	manualSignals,
	settled,
	show,
	tracked,
	use,
	useFakeTimers,
	valueOf,
} from "./helpers.js";
import { Greeting, servicesLayer } from "./services.js";

afterEach(async () => {
	// Clients first: disposing ends the listeners on the stubbed globals.
	await disposeClients();
	vi.unstubAllGlobals();
});

/** Stubs the browser globals `Signals.browser` listens to. */
const stubDom = () => {
	const document = Object.assign(new EventTarget(), {
		visibilityState: "hidden",
	});
	const window = new EventTarget();
	const navigator = { onLine: true };
	vi.stubGlobal("document", document);
	vi.stubGlobal("navigator", navigator);
	vi.stubGlobal("addEventListener", window.addEventListener.bind(window));
	vi.stubGlobal(
		"removeEventListener",
		window.removeEventListener.bind(window),
	);
	return {
		focus: () => {
			document.visibilityState = "visible";
			document.dispatchEvent(new Event("visibilitychange"));
		},
		hide: () => {
			document.visibilityState = "hidden";
			document.dispatchEvent(new Event("visibilitychange"));
		},
		network: (online: boolean) => {
			navigator.onLine = online;
			window.dispatchEvent(new Event(online ? "online" : "offline"));
		},
	};
};

/** A logger that keeps what's logged at `Error` level. */
const errorLog = () => {
	const errors: Array<unknown> = [];
	const layer = Logger.layer([
		Logger.make(({ logLevel, message }) => {
			if (logLevel === "Error") {
				errors.push(message);
			}
		}),
	]);
	return { errors, layer };
};

describe("the mount policy", () => {
	it("retries a cached failure when a query is used again (G2)", async () => {
		const client = await makeClient();
		const { query } = tracked(["flaky"], (fetch) =>
			fetch === 1 ? Effect.fail("boom") : Effect.succeed("recovered"),
		);
		const unmount = use(client.registry, query);
		expect(Exit.isFailure(await settled(client.registry, query))).toBe(true);
		unmount();

		use(client.registry, query);

		expect(await valueOf(client.registry, query)).toBe("recovered");
	});

	it("leaves a cached failure alone with retryOnMount: false", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(["flaky"], () => Effect.fail("boom"), {
			retryOnMount: false,
		});
		const unmount = use(client.registry, query);
		await settled(client.registry, query);
		unmount();

		use(client.registry, query);

		expect(fetches.count).toBe(1);
		expect(show(client.registry.get(query))).toBe("Failure");
	});

	it("refetches on remount once staleTime has passed, and not before (G10)", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { fetches, query } = tracked(
			["remount"],
			(fetch) => Effect.succeed(fetch),
			{ staleTime: "1 minute" },
		);
		use(client.registry, query)();
		await vi.advanceTimersByTimeAsync(30_000);
		use(client.registry, query)();
		expect(fetches.count).toBe(1);

		await vi.advanceTimersByTimeAsync(30_000);
		use(client.registry, query);

		expect(fetches.count).toBe(2);
		expect(await valueOf(client.registry, query)).toBe(2);
	});

	it("doesn't refetch on remount with refetchOnMount: false", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(
			["remount"],
			(fetch) => Effect.succeed(fetch),
			{ refetchOnMount: false },
		);
		use(client.registry, query)();

		use(client.registry, query);

		expect(fetches.count).toBe(1);
	});

	it("leaves a query that's fetching alone, so it can run twice", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { fetches, query } = tracked(["slow"], (fetch) =>
			Effect.succeed(fetch).pipe(Effect.delay("1 second")),
		);
		use(client.registry, query);
		await vi.advanceTimersByTimeAsync(1000);
		await client.runPromise(Query.invalidate(query));

		beforeUse(client.registry, query);
		beforeUse(client.registry, query);
		await vi.advanceTimersByTimeAsync(1000);

		expect(fetches.count).toBe(2);
	});

	it("a value written with set is fresh until staleTime passes", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { fetches, query } = tracked(
			["preloaded"],
			(fetch) => Effect.succeed(fetch),
			{ staleTime: "1 minute" },
		);
		await client.runPromise(Query.set(query, 0));
		use(client.registry, query)();
		expect(fetches.count).toBe(0);

		await vi.advanceTimersByTimeAsync(60_000);
		use(client.registry, query);

		expect(fetches.count).toBe(1);
	});

	it("a write makes a query invalidated while idle fresh again", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(
			["invalidated"],
			(fetch) => Effect.succeed(fetch),
			{ staleTime: "1 minute" },
		);
		use(client.registry, query)();
		await client.runPromise(Query.invalidate(query));
		await client.runPromise(Query.set(query, 100));

		use(client.registry, query);

		expect(show(client.registry.get(query))).toBe("Success 100");
		expect(fetches.count).toBe(1);
	});
});

describe("focus and reconnect (G6)", () => {
	const setup = async (options?: Query.Options<never>) => {
		const { focus, online, signals } = manualSignals();
		const client = await makeClient({ signals });
		const query = tracked(["signals"], (fetch) => Effect.succeed(fetch), {
			staleTime: "1 minute",
			...options,
		});
		return { client, focus, online, ...query };
	};

	it("a focus tick refetches a stale query in use, not a fresh one", async () => {
		useFakeTimers();
		const { client, fetches, focus, query } = await setup();
		use(client.registry, query);

		client.registry.set(focus, 1);
		expect(fetches.count).toBe(1);

		await vi.advanceTimersByTimeAsync(60_000);
		client.registry.set(focus, 2);
		expect(fetches.count).toBe(2);
	});

	it("going back online refetches a stale query in use; staying online doesn't", async () => {
		useFakeTimers();
		const { client, fetches, online, query } = await setup();
		use(client.registry, query);
		await vi.advanceTimersByTimeAsync(60_000);

		client.registry.set(online, true);
		expect(fetches.count).toBe(1);

		client.registry.set(online, false);
		expect(fetches.count).toBe(1);
		client.registry.set(online, true);
		expect(fetches.count).toBe(2);
	});

	it("leaves a query nothing uses alone", async () => {
		useFakeTimers();
		const { client, fetches, focus, online, query } = await setup();
		use(client.registry, query)();
		await vi.advanceTimersByTimeAsync(60_000);

		client.registry.set(focus, 1);
		client.registry.set(online, false);
		client.registry.set(online, true);

		expect(fetches.count).toBe(1);
	});

	it("refetchOnFocus and refetchOnReconnect opt out", async () => {
		useFakeTimers();
		const { client, fetches, focus, online, query } = await setup({
			refetchOnFocus: false,
			refetchOnReconnect: false,
		});
		use(client.registry, query);
		await vi.advanceTimersByTimeAsync(60_000);

		client.registry.set(focus, 1);
		client.registry.set(online, false);
		client.registry.set(online, true);

		expect(fetches.count).toBe(1);
	});

	it("the client's defaults opt out, and a query's own options opt back in", async () => {
		useFakeTimers();
		const { focus, signals } = manualSignals();
		const client = await makeClient({
			signals,
			queries: { defaults: { staleTime: 0, refetchOnFocus: false } },
		});
		const off = tracked(["off"], (fetch) => Effect.succeed(fetch));
		const on = tracked(["on"], (fetch) => Effect.succeed(fetch), {
			refetchOnFocus: true,
		});
		use(client.registry, off.query);
		use(client.registry, on.query);
		await vi.advanceTimersByTimeAsync(1);

		client.registry.set(focus, 1);

		expect([off.fetches.count, on.fetches.count]).toEqual([1, 2]);
	});
});

describe("refetchInterval", () => {
	it("polls only while the query is in use", async () => {
		useFakeTimers();
		const client = await makeClient();
		// Fresh throughout, so only the interval refetches.
		const { fetches, query } = tracked(
			["poll"],
			(fetch) => Effect.succeed(fetch),
			{ refetchInterval: "1 second", staleTime: "1 minute" },
		);
		const unmount = use(client.registry, query);
		await vi.advanceTimersByTimeAsync(3000);
		expect(fetches.count).toBe(4);

		unmount();
		await vi.advanceTimersByTimeAsync(3000);
		expect(fetches.count).toBe(4);

		use(client.registry, query);
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetches.count).toBe(5);
	});

	it("keeps polling while the query is written more often than its interval", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { fetches, query } = tracked(
			["poll", "written"],
			(fetch) => Effect.succeed(fetch),
			{ refetchInterval: "1 second", staleTime: "1 minute" },
		);
		use(client.registry, query);
		for (let i = 0; i < 6; i++) {
			await vi.advanceTimersByTimeAsync(400);
			await client.runPromise(Query.set(query, -i));
		}

		expect(fetches.count).toBe(3);
	});

	it("doesn't start another fetch while one is running", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { fetches, query } = tracked(
			["slow poll"],
			(fetch) => Effect.succeed(fetch).pipe(Effect.delay("1500 millis")),
			{ refetchInterval: "1 second" },
		);
		use(client.registry, query);
		await vi.advanceTimersByTimeAsync(1400);

		expect(fetches.count).toBe(1);
		expect(client.registry.get(query).waiting).toBe(true);
	});
});

describe("the client's query defaults (G9)", () => {
	it("a default staleTime applies, and a query's own overrides it", async () => {
		const client = await makeClient({
			queries: { defaults: { staleTime: "1 minute" } },
		});
		const cached = tracked(["cached"], (fetch) => Effect.succeed(fetch));
		const own = tracked(["own"], (fetch) => Effect.succeed(fetch), {
			staleTime: 0,
		});

		for (const { query } of [cached, own]) {
			await client.runPromise(Query.fetch(query));
			await client.runPromise(Query.fetch(query));
		}

		expect([cached.fetches.count, own.fetches.count]).toEqual([1, 2]);
	});

	it("a default retry applies, and a query's own overrides it", async () => {
		const client = await makeClient({
			queries: { defaults: { retry: Schedule.recurs(2) } },
		});
		const failTwice = (fetch: number) =>
			fetch <= 2 ? Effect.fail(`attempt ${fetch}`) : Effect.succeed(fetch);
		const retried = tracked(["retried"], failTwice);
		const own = tracked(["own"], failTwice, { retry: Schedule.recurs(0) });

		expect(await client.runPromise(Query.fetch(retried.query))).toBe(3);
		expect(await client.runPromiseExit(Query.fetch(own.query))).toEqual(
			Exit.fail("attempt 1"),
		);
	});

	it("retries failures, not defects", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(
			["defect"],
			() => Effect.die("kaboom"),
			{ retry: Schedule.recurs(2) },
		);

		await client.runPromiseExit(Query.fetch(query));

		expect(fetches.count).toBe(1);
	});
});

describe("the client's query hooks (G9)", () => {
	// `makeClient` fetches a warm-up query, whose hooks run too.
	const isWarmUp = (key: Query.Key) => key[0] === "warm-up";

	const setup = async () => {
		const calls: Array<string> = [];
		const client = await makeClient({
			queries: {
				onSuccess: ({ key, value }) =>
					Greeting.useSync(({ text }) => {
						if (!isWarmUp(key)) {
							calls.push(
								`success ${JSON.stringify(key)} ${String(value)} (${text})`,
							);
						}
					}),
				onFailure: ({ key, cause }) =>
					Effect.sync(() => {
						calls.push(
							`failure ${JSON.stringify(key)} ${String(Cause.squash(cause))}`,
						);
					}),
				onSettled: ({ key, exit }) =>
					Effect.sync(() => {
						if (!isWarmUp(key)) {
							calls.push(`settled ${JSON.stringify(key)} ${exit._tag}`);
						}
					}),
			},
		});
		return { calls, client };
	};

	it("run once per fetch, with the key and the outcome, after retry", async () => {
		const { calls, client } = await setup();
		const ok = tracked(["ok"], () => Effect.succeed(1));
		const failing = tracked(
			["failing"],
			(fetch) => Effect.fail(`no ${fetch}`),
			{
				retry: Schedule.recurs(1),
			},
		);

		await client.runPromise(Query.fetch(ok.query));
		await client.runPromiseExit(Query.fetch(failing.query));

		await vi.waitFor(() => {
			expect(calls).toEqual([
				'success ["ok"] 1 (hello)',
				'settled ["ok"] Success',
				'failure ["failing"] no 2',
				'settled ["failing"] Failure',
			]);
		});
	});

	it("don't run for a value written with set", async () => {
		const { calls, client } = await setup();
		const { query } = tracked(["written"], () => Effect.succeed(1));

		await client.runPromise(Query.set(query, 2));
		await client.runPromise(Effect.sleep("10 millis"));

		expect(calls).toEqual([]);
	});

	it("never hear an interrupted fetch", async () => {
		useFakeTimers();
		const { calls, client } = await setup();
		const replaced = tracked(["replaced"], (fetch) =>
			Effect.succeed(fetch).pipe(Effect.delay("100 millis")),
		);
		// The registry rounds idle TTLs up to its one-second buckets.
		const collected = tracked(
			["collected"],
			(fetch) => Effect.succeed(fetch).pipe(Effect.delay("10 seconds")),
			{ gcTime: "10 millis" },
		);
		use(client.registry, replaced.query);
		use(client.registry, collected.query)();
		await vi.advanceTimersByTimeAsync(50);
		await client.runPromise(Query.invalidate(replaced.query));
		await vi.advanceTimersByTimeAsync(3000);

		expect(client.registry.getNodes().has(collected.query)).toBe(false);
		await vi.waitFor(() => {
			expect(calls).toEqual([
				'success ["replaced"] 2 (hello)',
				'settled ["replaced"] Success',
			]);
		});
	});

	it("a hook that dies is logged, and the others still run", async () => {
		const calls: Array<string> = [];
		const { errors, layer } = errorLog();
		const client = await makeClient({
			layer: Layer.merge(servicesLayer("hello"), layer),
			queries: {
				onSuccess: ({ key }) =>
					isWarmUp(key) ? Effect.void : Effect.die("hook"),
				onSettled: ({ key }) =>
					Effect.sync(() => {
						if (!isWarmUp(key)) {
							calls.push("settled");
						}
					}),
			},
		});
		const { query } = tracked(["hooked"], () => Effect.succeed(1));

		expect(await client.runPromise(Query.fetch(query))).toBe(1);
		await vi.waitFor(() => {
			expect(calls).toEqual(["settled"]);
		});
		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toContain("A queries hook died");
	});

	it("a hook the client interrupts isn't logged, and the rest don't run", async () => {
		const calls: Array<string> = [];
		const { errors, layer } = errorLog();
		const client = QueryClient.make({
			layer: Layer.merge(servicesLayer("hello"), layer),
			queries: {
				onSuccess: () =>
					Effect.sync(() => calls.push("success")).pipe(
						Effect.andThen(Effect.never),
					),
				onSettled: () => Effect.sync(() => calls.push("settled")),
			},
		});
		const { query } = tracked(["hooked"], () => Effect.succeed(1));
		await client.runPromise(Query.fetch(query));
		await vi.waitFor(() => {
			expect(calls).toEqual(["success"]);
		});

		await client.dispose();

		expect(calls).toEqual(["success"]);
		expect(errors).toEqual([]);
	});

	it("the client tracks a hook fiber from when it's forked until it ends", async () => {
		const state = makeClientState();
		const hooks: QueryClient.QueriesOptions = {
			onSettled: () => Effect.never,
		};

		const client = await makeClient();
		await client.runPromise(
			forkQueryHooks(state, hooks, ["hooked"], Exit.succeed(1)),
		);
		const fibers = [...state.fibers];
		expect(fibers).toHaveLength(1);

		await Effect.runPromise(Fiber.interruptAll(fibers));
		expect(state.fibers.size).toBe(0);
	});
});

describe("Signals", () => {
	it("Signals.browser does nothing without a DOM", () => {
		const registry = AtomRegistry.make();

		expect(registry.get(Signals.browser.focus)).toBe(0);
		expect(registry.get(Signals.browser.online)).toBe(true);
		registry.dispose();
	});

	it("Signals.browser follows visibility and the network with a DOM", () => {
		const dom = stubDom();
		const registry = AtomRegistry.make();
		const focus: Array<number> = [];
		const online: Array<boolean> = [];
		registry.subscribe(Signals.browser.focus, (n) => focus.push(n), {
			immediate: true,
		});
		registry.subscribe(Signals.browser.online, (o) => online.push(o), {
			immediate: true,
		});

		dom.hide();
		dom.focus();
		dom.network(false);
		dom.network(true);

		expect(focus).toEqual([0, 1]);
		expect(online).toEqual([true, false, true]);
		registry.dispose();
	});

	it("a client with the browser's signals refetches stale queries on focus and reconnect", async () => {
		const dom = stubDom();
		const client = await makeClient({ signals: Signals.browser });
		const { fetches, query } = tracked(["browser"], (fetch) =>
			Effect.succeed(fetch),
		);
		use(client.registry, query);

		dom.focus();
		dom.network(false);
		dom.network(true);

		expect(fetches.count).toBe(3);
	});

	it("Signals.none never changes", () => {
		const registry = AtomRegistry.make();

		expect(registry.get(Signals.none.focus)).toBe(0);
		expect(registry.get(Signals.none.online)).toBe(true);
		registry.dispose();
	});
});

describe("disposing a client", () => {
	it("ends signal subscriptions and refetchInterval timers", async () => {
		useFakeTimers();
		const released: Array<string> = [];
		const signal = <A>(name: string, value: A) =>
			Atom.readable((get) => {
				get.addFinalizer(() => released.push(name));
				return value;
			});
		const client = QueryClient.make({
			layer: servicesLayer("hello"),
			signals: { focus: signal("focus", 0), online: signal("online", true) },
		});
		const { query } = tracked(["poll"], (fetch) => Effect.succeed(fetch), {
			refetchInterval: "1 second",
		});
		client.registry.mount(query);
		await client.runPromise(Query.fetch(query));

		await client.dispose();

		expect(released.sort()).toEqual(["focus", "online"]);
		expect(vi.getTimerCount()).toBe(0);
	});
});
