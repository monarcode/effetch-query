// Phase 2 spike for `clear` (rc3-plan.md). Throwaway: removed before the gate.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { afterEach, describe, expect, it } from "vitest";

import { Mutation, Query, QueryClient } from "../src/index.js";
import { internals, localValue } from "../src/internal/queryAtom.js";
import { makeQueryUse } from "../src/internal/queryUse.js";
import * as targets from "../src/internal/targets.js";
import {
	disposeClients,
	gate,
	makeClient,
	manualSignals,
	record,
	tracked,
	use,
	useFakeTimers,
} from "./helpers.js";

const clear = (registry: AtomRegistry.AtomRegistry, target: Query.Target) =>
	targets.clear(registry, target);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(disposeClients);

describe("spike: clear", () => {
	it("1. in use: shows an idle Initial, interrupts the fetch, starts none", async () => {
		const client = await makeClient();
		const slow = gate();
		const { fetches, query } = tracked(["c1"], (n) =>
			n === 1 ? Effect.succeed(n) : Effect.as(slow.wait, n),
		);
		const seen = record(client.registry, query);
		await tick();
		await client.invalidate(query); // fetch 2 in progress
		clear(client.registry, query);
		await tick();
		slow.open();
		await tick();
		console.log("1 trace:", seen.join(" → "), "fetches", fetches.count);
		expect(seen.at(-1)).toBe("Initial");
		expect(fetches.count).toBe(2);
		expect(Option.isNone(QueryClient.get(client, query))).toBe(true);
		console.log("1:", seen.join(" → "));
	});

	it("2. stays idle on focus, reconnect and polling", async () => {
		useFakeTimers();
		const { focus, online, signals } = manualSignals();
		const client = await makeClient({ signals });
		const { fetches, query } = tracked(["c2"], (n) => Effect.succeed(n), {
			refetchInterval: "1 second",
		});
		use(client.registry, query);
		await client.fetch(query);
		const before = fetches.count;
		clear(client.registry, query);
		client.registry.set(focus, 1);
		client.registry.set(online, false);
		client.registry.set(online, true);
		await (await import("vitest")).vi.advanceTimersByTimeAsync(5000);
		console.log(
			"2: fetches after clear + focus + reconnect + 5s:",
			fetches.count,
		);
		expect(fetches.count - before).toBe(0);
	});

	it("3. fetches when asked: Query.fetch, invalidate, refetch", async () => {
		const client = await makeClient();
		const a = tracked(["c3", "a"], (n) => Effect.succeed(n));
		const b = tracked(["c3", "b"], (n) => Effect.succeed(n));
		const c = tracked(["c3", "c"], (n) => Effect.succeed(n));
		for (const { query } of [a, b, c]) {
			use(client.registry, query);
			await client.fetch(query);
		}
		console.log(
			"3 before clear:",
			a.fetches.count,
			b.fetches.count,
			c.fetches.count,
		);
		clear(client.registry, ["c3"]);
		console.log(
			"3 after clear:",
			a.fetches.count,
			client.registry.get(a.query)._tag,
		);
		const viaFetch = await client.fetch(a.query);
		await client.invalidate(b.query);
		await tick();
		await client.refetch(c.query);
		console.log(
			"3: fetch →",
			viaFetch,
			"invalidate →",
			b.fetches.count,
			"refetch →",
			c.fetches.count,
		);
		expect([a.fetches.count, b.fetches.count, c.fetches.count]).toEqual([
			3, 3, 3,
		]);
	});

	it("4. a reader that mounts later: does the mount policy fetch?", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(["c4"], (n) => Effect.succeed(n));
		const release = use(client.registry, query);
		await client.fetch(query);
		clear(client.registry, query);
		release();
		use(client.registry, query); // a new reader: mount policy, then subscribe
		await tick();
		console.log(
			"4: fetches after a new reader mounts:",
			fetches.count,
			"shows",
			client.registry.get(query)._tag,
		);
	});

	it("5. a query not in use: fetches when next read", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(["c5"], (n) => Effect.succeed(n));
		await client.fetch(query);
		clear(client.registry, query);
		await tick();
		const seen = record(client.registry, query);
		await tick();
		console.log(
			"5: not in use, then read:",
			seen.join(" → "),
			"fetches",
			fetches.count,
		);
	});

	it("6. a Suspense reader that mounts later: does whenShowable resolve?", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(["c6"], (n) => Effect.succeed(n));
		const release = use(client.registry, query);
		await client.fetch(query);
		clear(client.registry, query);
		const reader = makeQueryUse(client.registry);
		let thrown: unknown;
		try {
			reader.suspend(query, client.registry.get(query));
		} catch (error) {
			thrown = error;
		}
		const settled = Promise.race([
			(thrown as Promise<void>).then(() => "resolved"),
			new Promise((resolve) =>
				setTimeout(() => resolve("still waiting"), 50),
			),
		]);
		console.log("6:", await settled, "fetches", fetches.count);
		release();
	});

	it("7. an optimistic write, then clear, then the mutation fails: what comes back?", async () => {
		const client = await makeClient();
		const query = Query.make({ key: ["c7"], run: Effect.succeed("server") });
		use(client.registry, query);
		await client.fetch(query);
		const slow = gate();
		const save = Mutation.make({
			run: () => Effect.andThen(slow.wait, Effect.fail("no")),
			optimistic: () => Query.set(query, "optimistic"),
		});
		const run = client.runPromiseExit(Mutation.run(save));
		await tick();
		clear(client.registry, query);
		const afterClear = client.registry.get(query);
		slow.open();
		await run;
		await tick();
		const afterRollback = client.registry.get(query);
		console.log(
			"7: after clear",
			afterClear._tag,
			"→ after rollback",
			afterRollback._tag,
			JSON.stringify(AsyncResult.value(afterRollback)),
		);
	});

	it("7b. the same with reset, then the mutation fails: what comes back?", async () => {
		const client = await makeClient();
		const query = Query.make({ key: ["c7b"], run: Effect.succeed("server") });
		use(client.registry, query);
		await client.fetch(query);
		const slow = gate();
		const save = Mutation.make({
			run: () => Effect.andThen(slow.wait, Effect.fail("no")),
			optimistic: () => Query.set(query, "optimistic"),
		});
		const run = client.runPromiseExit(Mutation.run(save));
		await tick();
		targets.reset(client.registry, query);
		const afterClear = client.registry.get(query);
		slow.open();
		await run;
		await tick();
		const afterRollback = client.registry.get(query);
		console.log(
			"7b: after reset",
			afterClear._tag,
			"→ after rollback",
			afterRollback._tag,
			JSON.stringify(AsyncResult.value(afterRollback)),
		);
	});

	it("8. hydrate after clear: does the server's value land?", async () => {
		const server = await makeClient();
		const schema = { success: (await import("effect/Schema")).String };
		const query = Query.make({
			key: ["c8"],
			run: Effect.succeed("server"),
			schema,
		});
		await server.fetch(query);
		const state = QueryClient.dehydrate(server);

		const client = await makeClient();
		const local = Query.make({
			key: ["c8"],
			run: Effect.succeed("browser"),
			schema,
		});
		use(client.registry, local);
		await client.fetch(local);
		clear(client.registry, local);
		QueryClient.hydrate(client, state);
		await tick();
		console.log(
			"8: after hydrate",
			JSON.stringify(client.registry.get(local)),
		);
	});

	it("9. a derived atom over a cleared query", async () => {
		const client = await makeClient();
		const { query } = tracked(["c9"], (n) => Effect.succeed(n));
		const doubled = Atom.map(
			query,
			AsyncResult.map((n: number) => n * 2),
		);
		const seen = record(client.registry, doubled);
		await tick();
		clear(client.registry, query);
		await tick();
		console.log("9:", seen.join(" → "));
	});
});
