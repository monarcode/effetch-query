import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { describe, expectTypeOf, it } from "vitest";

import { QueryClient } from "../../src/index.js";
import {
	Greeting,
	servicesLayer,
	type TestApi,
	testApiLayer,
} from "../services.js";

class Unregistered extends Context.Service<
	Unregistered,
	{ readonly value: number }
>()("test/Unregistered") {}

const client = QueryClient.make({ layer: servicesLayer("hello") });

describe("Register", () => {
	it("sets the services queries run with", () => {
		expectTypeOf<QueryClient.Services>().toEqualTypeOf<Greeting | TestApi>();
	});

	it("makes queries and hooks require the services and the client", () => {
		expectTypeOf<QueryClient.Requirements>().toEqualTypeOf<
			Greeting | TestApi | QueryClient.QueryClient
		>();
		expectTypeOf<
			ReturnType<QueryClient.Hook<QueryClient.QuerySucceeded>>
		>().toEqualTypeOf<Effect.Effect<void, never, QueryClient.Requirements>>();
	});
});

describe("QueryClient.make", () => {
	it("takes a layer that provides the registered services", () => {
		QueryClient.make({ layer: servicesLayer("hello") });
		QueryClient.make({
			layer: Layer.merge(
				Layer.effect(Greeting, Effect.fail("no config" as const)),
				testApiLayer(),
			),
		});
		QueryClient.make({
			layer: Layer.merge(
				servicesLayer("hello"),
				Layer.succeed(Unregistered, { value: 1 }),
			),
		});
	});

	it("rejects a layer that doesn't provide them", () => {
		// @ts-expect-error Layer.empty doesn't provide Greeting
		QueryClient.make({ layer: Layer.empty });
	});

	it("rejects a layer that needs services of its own", () => {
		QueryClient.make({
			// @ts-expect-error the layer needs Unregistered
			layer: Layer.effect(
				Greeting,
				Unregistered.useSync(({ value }) => ({ text: String(value) })),
			),
		});
	});
});

describe("QueryClient.make with a runtime", () => {
	it("takes a runtime that provides the registered services", () => {
		QueryClient.make({
			runtime: ManagedRuntime.make(servicesLayer("hello")),
		});
		QueryClient.make({
			runtime: ManagedRuntime.make(
				Layer.merge(
					servicesLayer("hello"),
					Layer.succeed(Unregistered, { value: 1 }),
				),
			),
		});
	});

	it("rejects a runtime that doesn't provide them", () => {
		QueryClient.make({
			// @ts-expect-error the runtime doesn't provide TestApi
			runtime: ManagedRuntime.make(
				Layer.succeed(Greeting, { text: "hello" }),
			),
		});
	});

	it("rejects a runtime with a layer or a memo map", () => {
		const runtime = ManagedRuntime.make(servicesLayer("hello"));
		// @ts-expect-error either a layer or a runtime
		QueryClient.make({ runtime, layer: servicesLayer("hello") });
		// @ts-expect-error the runtime has its own memo map
		QueryClient.make({ runtime, memoMap: Layer.makeMemoMapUnsafe() });
	});
});

describe("runPromise and runPromiseExit", () => {
	it("keep the Effect's success and error types", () => {
		const effect = Greeting.useSync(({ text }) => text.length);
		expectTypeOf(client.runPromise(effect)).toEqualTypeOf<Promise<number>>();
		expectTypeOf(
			client.runPromiseExit(Effect.fail("boom" as const)),
		).toEqualTypeOf<Promise<Exit.Exit<never, "boom">>>();
	});

	it("accept Effects that need the client", () => {
		client.runPromise(
			QueryClient.QueryClient.useSync((self) => self.registry),
		);
	});

	it("reject an Effect that needs an unregistered service", () => {
		// @effect-diagnostics-next-line missingEffectContext:off
		// @ts-expect-error Unregistered isn't in Register
		client.runPromise(Unregistered.useSync(({ value }) => value));
	});
});

describe("QueryClient.layer", () => {
	it("provides the QueryClient service", () => {
		expectTypeOf(
			QueryClient.layer({ layer: servicesLayer("hello") }),
		).toEqualTypeOf<Layer.Layer<QueryClient.QueryClient>>();
	});
});
