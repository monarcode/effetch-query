import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Reactivity from "effect/reactivity/Reactivity";

import { afterEach, describe, expect, it, vi } from "vitest";

import { QueryClient } from "../src/index.js";
import { MissingQueryClient, runtime } from "../src/internal/runtime.js";
import { Greeting, servicesLayer, testApiLayer } from "./services.js";

const readGreeting = Greeting.useSync((service) => service.text);
const greeting = runtime.atom(readGreeting);

const valueOf = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
): Promise<A> => Effect.runPromise(AtomRegistry.getResult(registry, atom));

// Lets the registry remove nodes nothing uses, as it does between renders.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (millis: number) =>
	new Promise((resolve) => setTimeout(resolve, millis));

const countingLayer = (text: string) => {
	const counts = { builds: 0, releases: 0 };
	const layer = Layer.merge(
		Layer.effect(
			Greeting,
			Effect.acquireRelease(
				Effect.sync(() => {
					counts.builds++;
					return { text };
				}),
				() =>
					Effect.sync(() => {
						counts.releases++;
					}),
			),
		),
		testApiLayer(),
	);
	return { counts, layer };
};

const squashed = (exit: Exit.Exit<unknown, unknown>): unknown => {
	if (Exit.isSuccess(exit)) {
		throw new Error("Expected a failure");
	}
	return Cause.squash(exit.cause);
};

afterEach(() => {
	vi.useRealTimers();
});

describe("QueryClient.make", () => {
	it("builds the layer on first use, once, and keeps it until dispose", async () => {
		const { counts, layer } = countingLayer("hello");
		const client = QueryClient.make({ layer });
		await settle();
		expect(counts.builds).toBe(0);

		expect(await valueOf(client.registry, greeting)).toBe("hello");
		await settle();
		expect(await client.runPromise(readGreeting)).toBe("hello");
		expect(await valueOf(client.registry, greeting)).toBe("hello");
		expect(counts).toEqual({ builds: 1, releases: 0 });

		await client.dispose();
		expect(counts).toEqual({ builds: 1, releases: 1 });
	});

	it("gives two clients with one definition their own layer (P1)", async () => {
		const english = QueryClient.make({ layer: servicesLayer("hello") });
		const french = QueryClient.make({ layer: servicesLayer("bonjour") });

		expect(
			await Promise.all([
				valueOf(english.registry, greeting),
				valueOf(french.registry, greeting),
			]),
		).toEqual(["hello", "bonjour"]);

		await Promise.all([english.dispose(), french.dispose()]);
	});

	it("keeps clients used at the same time apart", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		const delayed = runtime.atom(Effect.delay(readGreeting, "1 second"));
		const count = Atom.make(0);
		const english = QueryClient.make({ layer: servicesLayer("hello") });
		const french = QueryClient.make({ layer: servicesLayer("bonjour") });
		english.registry.mount(count);
		french.registry.mount(count);

		const results = Promise.all([
			valueOf(english.registry, delayed),
			valueOf(french.registry, delayed),
		]);
		english.registry.set(count, 1);
		await vi.advanceTimersByTimeAsync(1000);

		expect(await results).toEqual(["hello", "bonjour"]);
		expect([english.registry.get(count), french.registry.get(count)]).toEqual(
			[1, 0],
		);

		await Promise.all([english.dispose(), french.dispose()]);
	});

	it("dispose interrupts fibers, clears timers and releases the layer", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		const { counts, layer } = countingLayer("hello");
		let interrupted = 0;
		const forever = Effect.never.pipe(
			Effect.onInterrupt(() =>
				Effect.sync(() => {
					interrupted++;
				}),
			),
		);
		const idle = Atom.setIdleTTL(greeting, "5 minutes");
		const client = QueryClient.make({ layer });

		client.registry.mount(runtime.atom(forever));
		const unmount = client.registry.mount(idle);
		await valueOf(client.registry, idle);
		unmount();
		const running = client.runPromiseExit(forever);
		await vi.advanceTimersByTimeAsync(0);
		expect(vi.getTimerCount()).toBeGreaterThan(0);

		await client.dispose();

		expect(Exit.hasInterrupts(await running)).toBe(true);
		expect(interrupted).toBe(2);
		expect(vi.getTimerCount()).toBe(0);
		expect(counts).toEqual({ builds: 1, releases: 1 });
		expect(() => client.registry.get(greeting)).toThrow(/disposed/);
	});

	it("dispose releases the layer when a cache finalizer throws, and rejects", async () => {
		const { counts, layer } = countingLayer("hello");
		const throwing = Atom.readable((get) => {
			get.addFinalizer(() => {
				throw new Error("finalizer failed");
			});
			return 1;
		});
		const client = QueryClient.make({ layer });
		await client.runPromise(readGreeting);
		client.registry.mount(throwing);

		await expect(client.dispose()).rejects.toThrow("finalizer failed");
		expect(counts).toEqual({ builds: 1, releases: 1 });
	});

	it("shares a ManagedRuntime's memo map, so its layers are built once (P1)", async () => {
		const { counts, layer } = countingLayer("hello");
		const appRuntime = ManagedRuntime.make(layer);
		await appRuntime.runPromise(readGreeting);

		const client = QueryClient.make({ layer, memoMap: appRuntime.memoMap });
		expect(await valueOf(client.registry, greeting)).toBe("hello");
		expect(counts).toEqual({ builds: 1, releases: 0 });

		await client.dispose();
		expect(counts.releases).toBe(0);
		await appRuntime.dispose();
		expect(counts.releases).toBe(1);
	});

	it("waits for a layer build in progress, so a shared memo map isn't left with an interruption", async () => {
		const layer = Layer.merge(
			Layer.effect(
				Greeting,
				Effect.sleep("30 millis").pipe(Effect.as({ text: "hello" })),
			),
			testApiLayer(),
		);
		const appRuntime = ManagedRuntime.make(layer);
		const client = QueryClient.make({ layer, memoMap: appRuntime.memoMap });

		const fromClient = client.runPromiseExit(readGreeting);
		await wait(5);
		const fromApp = appRuntime.runPromiseExit(readGreeting);
		await wait(5);
		await client.dispose();

		expect(Exit.hasInterrupts(await fromClient)).toBe(true);
		expect(await fromApp).toEqual(Exit.succeed("hello"));
		expect(await appRuntime.runPromise(readGreeting)).toBe("hello");
		await appRuntime.dispose();
	});

	it("makes an atom read without a client die with a clear message", async () => {
		const registry = AtomRegistry.make();
		const exit = await Effect.runPromiseExit(
			AtomRegistry.getResult(registry, greeting),
		);

		expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
		const defect = squashed(exit);
		expect(defect).toBeInstanceOf(MissingQueryClient);
		expect(defect).toMatchObject({
			_tag: "MissingQueryClient",
			message: expect.stringMatching(
				/^No QueryClient: .*queryClient\.registry/,
			),
		});
		registry.dispose();
	});
});

describe("QueryClient runPromise and runPromiseExit", () => {
	it("provide the client, the services and Reactivity", async () => {
		const client = QueryClient.make({ layer: servicesLayer("hello") });

		const [self, text] = await client.runPromise(
			Effect.gen(function* () {
				const self = yield* QueryClient.QueryClient;
				const { text } = yield* Greeting;
				yield* Reactivity.invalidate(["todos"]);
				return [self, text] as const;
			}),
		);

		expect(self).toBe(client);
		expect(text).toBe("hello");
		await client.dispose();
	});

	it("report a failure as a rejection or an Exit", async () => {
		const client = QueryClient.make({ layer: servicesLayer("hello") });

		await expect(client.runPromise(Effect.fail("boom"))).rejects.toBe("boom");
		expect(squashed(await client.runPromiseExit(Effect.fail("boom")))).toBe(
			"boom",
		);

		await client.dispose();
	});

	it("share one Reactivity with the client's atoms", async () => {
		let todos = 0;
		let users = 0;
		const todosAtom = runtime.factory.withReactivity(["todos"])(
			runtime.atom(Effect.sync(() => ++todos)),
		);
		const usersAtom = runtime.factory.withReactivity(["users"])(
			runtime.atom(Effect.sync(() => ++users)),
		);
		const client = QueryClient.make({ layer: servicesLayer("hello") });
		client.registry.mount(todosAtom);
		client.registry.mount(usersAtom);
		await valueOf(client.registry, todosAtom);
		await valueOf(client.registry, usersAtom);

		await client.runPromise(Reactivity.invalidate(["todos"]));

		expect(await valueOf(client.registry, todosAtom)).toBe(2);
		expect(await valueOf(client.registry, usersAtom)).toBe(1);
		await client.dispose();
	});
});

describe("QueryClient.layer", () => {
	it("provides a client that's disposed with the layer's scope", async () => {
		const client = await Effect.runPromise(
			QueryClient.QueryClient.useSync((client) => client).pipe(
				Effect.provide(
					QueryClient.layer({ layer: servicesLayer("hello") }),
				),
			),
		);

		expect(() => client.registry.get(greeting)).toThrow(/disposed/);
	});

	it("builds the services with the memo map of the graph it's built in", async () => {
		const { counts, layer } = countingLayer("hello");

		const texts = await Effect.runPromise(
			Effect.gen(function* () {
				const client = yield* QueryClient.QueryClient;
				const { text } = yield* Greeting;
				const fromClient = yield* Effect.promise(() =>
					valueOf(client.registry, greeting),
				);
				return [text, fromClient];
			}).pipe(
				Effect.provide(Layer.merge(QueryClient.layer({ layer }), layer)),
			),
		);

		expect(texts).toEqual(["hello", "hello"]);
		expect(counts).toEqual({ builds: 1, releases: 1 });
	});
});
