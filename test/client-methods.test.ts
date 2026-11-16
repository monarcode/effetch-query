import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { afterEach, describe, expect, it } from "vitest";

import { Query, QueryClient } from "../src/index.js";
import {
	dispose,
	disposeClients,
	gate,
	makeClient,
	tracked,
	use,
	valueOf,
} from "./helpers.js";

class Boom extends Data.TaggedError("Boom")<{ readonly message: string }> {}

afterEach(disposeClients);

describe("client.fetch", () => {
	it("returns the value, then the cached one while it's fresh", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(["fetch"], (n) => Effect.succeed(n), {
			staleTime: "1 minute",
		});
		expect(await client.fetch(query)).toBe(1);
		expect(await client.fetch(query)).toBe(1);
		expect(fetches.count).toBe(1);
	});

	it("rejects with the query's error", async () => {
		const client = await makeClient();
		const query = Query.make({
			key: ["fetch", "fails"],
			run: Effect.fail(new Boom({ message: "no" })),
		});
		await expect(client.fetch(query)).rejects.toBeInstanceOf(Boom);
	});

	it("rejects with what a query dies with, so a router's redirect gets through", async () => {
		const client = await makeClient();
		const redirect = { isRedirect: true, to: "/sign-in" };
		const query = Query.make({
			key: ["fetch", "redirect"],
			run: Effect.die(redirect),
		});
		await expect(client.fetch(query)).rejects.toBe(redirect);
	});

	it("stops waiting when the signal aborts", async () => {
		const client = await makeClient();
		const never = gate();
		const query = Query.make({ key: ["fetch", "slow"], run: never.wait });
		const controller = new AbortController();
		const fetched = client.fetch(query, { signal: controller.signal });
		controller.abort();
		await expect(fetched).rejects.toBeDefined();
		never.open();
	});
});

describe("client.prefetch", () => {
	it("caches the value", async () => {
		const client = await makeClient();
		const query = Query.make({ key: ["prefetch"], run: Effect.succeed(7) });
		await client.prefetch(query);
		expect(QueryClient.get(client, query)).toEqual(Option.some(7));
	});

	it("resolves when the fetch fails, leaving the failure in the query", async () => {
		const client = await makeClient();
		const query = Query.make({
			key: ["prefetch", "fails"],
			run: Effect.fail(new Boom({ message: "no" })),
		});
		await expect(client.prefetch(query)).resolves.toBeUndefined();
		const exit = await Effect.runPromiseExit(
			AtomRegistry.getResult(client.registry, query),
		);
		expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(
			Boom,
		);
	});
});

describe("client.invalidate", () => {
	it("refetches the target's queries in use, and leaves others alone", async () => {
		const client = await makeClient();
		const todos = tracked(["todos"], (n) => Effect.succeed(n));
		const other = tracked(["other"], (n) => Effect.succeed(n));
		use(client.registry, todos.query);
		use(client.registry, other.query);
		await valueOf(client.registry, todos.query);
		await valueOf(client.registry, other.query);

		await client.invalidate(["todos"]);
		expect(await valueOf(client.registry, todos.query)).toBe(2);
		expect(other.fetches.count).toBe(1);
	});

	it("without a target, invalidates every query", async () => {
		const client = await makeClient();
		const a = tracked(["a"], (n) => Effect.succeed(n));
		const b = tracked(["b"], (n) => Effect.succeed(n));
		use(client.registry, a.query);
		use(client.registry, b.query);
		await valueOf(client.registry, a.query);
		await valueOf(client.registry, b.query);

		await client.invalidate();
		expect(await valueOf(client.registry, a.query)).toBe(2);
		expect(await valueOf(client.registry, b.query)).toBe(2);
	});

	it("does nothing once the client is disposed", async () => {
		const client = await makeClient();
		await dispose(client);
		await expect(client.invalidate()).resolves.toBeUndefined();
		await expect(client.reset()).resolves.toBeUndefined();
		await expect(client.refetch()).resolves.toBeUndefined();
	});
});

describe("client.refetch", () => {
	it("resolves once the queries in use have settled, and never rejects", async () => {
		const client = await makeClient();
		const slow = gate();
		const fails = tracked(["refetch", "fails"], (n) =>
			n === 1 ? Effect.succeed(n) : Effect.fail(new Boom({ message: "no" })),
		);
		const waits = tracked(["refetch", "waits"], (n) =>
			n === 1 ? Effect.succeed(n) : Effect.as(slow.wait, n),
		);
		use(client.registry, fails.query);
		use(client.registry, waits.query);
		await valueOf(client.registry, fails.query);
		await valueOf(client.registry, waits.query);

		let done = false;
		const refetched = client.refetch().then(() => {
			done = true;
		});
		await Promise.resolve();
		expect(done).toBe(false);
		slow.open();
		await refetched;
		expect(fails.fetches.count).toBe(2);
		expect(await valueOf(client.registry, waits.query)).toBe(2);
	});
});

describe("client.reset", () => {
	it("drops the values of the target's queries", async () => {
		const client = await makeClient();
		const query = Query.make({ key: ["reset"], run: Effect.succeed(1) });
		await client.prefetch(query);
		await client.reset(["reset"]);
		expect(QueryClient.get(client, query)).toEqual(Option.none());
	});
});

describe("keys that hold targets", () => {
	it("fail with a tagged defect rather than matching nothing", async () => {
		const client = await makeClient();
		const wallet = Query.make({ key: ["wallet"], run: Effect.succeed(1) });
		const exit = await client.runPromiseExit(Query.invalidate([wallet]));
		expect(
			Exit.isFailure(exit) && (Cause.squash(exit.cause) as { _tag: string }),
		).toMatchObject({ _tag: "KeyHoldsTargetError" });
	});

	it("reject from the client's methods too, families and groups included", async () => {
		const client = await makeClient();
		const todo = Query.family({
			key: ["todo"],
			run: (id: number) => Effect.succeed(id),
		});
		const home = Query.group(["a"], ["b"]);
		await expect(client.invalidate([todo] as never)).rejects.toMatchObject({
			_tag: "KeyHoldsTargetError",
		});
		await expect(client.refetch([home] as never)).rejects.toMatchObject({
			_tag: "KeyHoldsTargetError",
		});
		await expect(client.reset(["todo", 1])).resolves.toBeUndefined();
	});
});

describe("QueryClient.make without options", () => {
	it("makes a client whose queries need no services", async () => {
		// The suite's Register declares services, so this is a type error here.
		// @ts-expect-error: options are required while Register declares services
		const client = QueryClient.make();
		const query = Query.make({
			key: ["no-services"],
			run: Effect.succeed(1),
		});
		expect(await client.fetch(query)).toBe(1);
		await client.dispose();
	});
});
