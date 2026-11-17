import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Schema from "effect/Schema";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Mutation, Query, QueryClient } from "../src/index.js";
import { makeQueryUse } from "../src/internal/queryUse.js";
import {
	dispose,
	disposeClients,
	gate,
	makeClient,
	manualSignals,
	record,
	show,
	tracked,
	use,
	useFakeTimers,
	valueOf,
} from "./helpers.js";

afterEach(disposeClients);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The promise a Suspense read throws, once it settles. */
const suspension = async (read: () => unknown): Promise<void> => {
	try {
		read();
	} catch (thrown) {
		await thrown;
		return;
	}
	throw new Error("The read didn't suspend");
};

/** A query in use with a value, and how many times it has fetched. */
const cached = async (
	client: QueryClient.QueryClient,
	key: Query.Key,
	options?: Query.Options<never>,
) => {
	const { fetches, query } = tracked(key, (n) => Effect.succeed(n), {
		staleTime: "1 hour",
		...options,
	});
	const release = use(client.registry, query);
	await valueOf(client.registry, query);
	return { fetches, query, release };
};

describe("Query.clear", () => {
	it("leaves a query in use idle: Initial, not waiting, with no fetch", async () => {
		const client = await makeClient();
		const slow = gate();
		const { fetches, query } = tracked(["slow"], (n) =>
			n === 1 ? Effect.succeed(n) : Effect.as(slow.wait, n),
		);
		const seen = record(client.registry, query);
		await tick();
		await client.invalidate(query);

		await client.runPromise(Query.clear(query));
		slow.open();
		await tick();

		expect(seen).toEqual(["Success 1", "Success(waiting) 1", "Initial"]);
		expect(fetches.count).toBe(2);
		expect(QueryClient.get(client, query)).toEqual(Option.none());
	});

	it("drops a written value too", async () => {
		const client = await makeClient();
		const { query } = await cached(client, ["written"]);
		await client.runPromise(Query.set(query, 42));

		await client.clear(query);

		expect(client.registry.get(query)._tag).toBe("Initial");
	});

	it("stays idle through focus, reconnect, polling and Reactivity keys", async () => {
		useFakeTimers();
		const { focus, online, signals } = manualSignals();
		const client = await makeClient({ signals });
		const { fetches, query } = await cached(client, ["quiet"], {
			staleTime: 0,
			refetchInterval: "1 second",
			reactivityKeys: ["quiet"],
		});
		const before = fetches.count;

		await client.clear();
		client.registry.set(focus, 1);
		client.registry.set(online, false);
		client.registry.set(online, true);
		await client.runPromise(Reactivity.invalidate(["quiet"]));
		await vi.advanceTimersByTimeAsync(5000);

		expect(fetches.count).toBe(before);
		expect(client.registry.get(query)._tag).toBe("Initial");
	});

	it("fetches once when asked: Query.fetch, invalidate and refetch", async () => {
		const client = await makeClient();
		const a = await cached(client, ["asked", "a"]);
		const b = await cached(client, ["asked", "b"]);
		const c = await cached(client, ["asked", "c"]);

		await client.clear(["asked"]);
		expect(await client.fetch(a.query)).toBe(2);
		await client.invalidate(b.query);
		await client.refetch(c.query);

		expect(await valueOf(client.registry, b.query)).toBe(2);
		expect(await valueOf(client.registry, c.query)).toBe(2);
		expect([a, b, c].map(({ fetches }) => fetches.count)).toEqual([2, 2, 2]);
	});

	it("fetches when a new reader starts using it, not for one already reading it", async () => {
		const client = await makeClient();
		const { fetches, query } = await cached(client, ["readers"]);
		const reader = makeQueryUse(client.registry);
		reader.mounted(query);

		await client.clear(query);
		reader.mounted(query);
		await tick();
		expect(fetches.count).toBe(1);

		use(client.registry, query);
		await tick();
		expect(fetches.count).toBe(2);
		expect(client.registry.get(query)._tag).toBe("Success");
	});

	it("a Suspense reader new to it fetches; one already showing it waits", async () => {
		const client = await makeClient();
		const { fetches, query } = await cached(client, ["suspense"]);
		const showing = makeQueryUse(client.registry);
		showing.mounted(query);

		await client.clear(query);
		expect(() =>
			showing.suspend(query, client.registry.get(query)),
		).toThrow();
		await tick();
		expect(fetches.count).toBe(1);

		const fresh = makeQueryUse(client.registry);
		let thrown: unknown;
		try {
			fresh.suspend(query, client.registry.get(query));
		} catch (error) {
			thrown = error;
		}
		await thrown;
		expect(fetches.count).toBe(2);
	});

	it("resets a query not in use, so its next read fetches", async () => {
		const client = await makeClient();
		const { fetches, query, release } = await cached(client, ["unused"]);
		release();

		await client.clear(query);
		expect(await client.fetch(query)).toBe(2);
		expect(fetches.count).toBe(2);
	});

	it("isn't undone by the rollback of an optimistic write made before it", async () => {
		const client = await makeClient();
		const query = Query.make({
			key: ["rollback"],
			run: Effect.succeed("server"),
		});
		use(client.registry, query);
		await valueOf(client.registry, query);
		const slow = gate();
		const save = Mutation.make({
			run: () => Effect.andThen(slow.wait, Effect.fail("no")),
			optimistic: () => Query.set(query, "optimistic"),
		});
		const run = client.runPromiseExit(Mutation.run(save));
		await tick();
		expect(AsyncResult.value(client.registry.get(query))).toEqual(
			Option.some("optimistic"),
		);

		await client.clear(query);
		slow.open();
		await run;
		await tick();

		expect(client.registry.get(query)._tag).toBe("Initial");
	});

	it("still rolls back a write made after it", async () => {
		const client = await makeClient();
		const query = Query.make({
			key: ["after"],
			run: Effect.succeed("server"),
		});
		use(client.registry, query);
		await valueOf(client.registry, query);
		await client.clear(query);
		await client.fetch(query);
		const save = Mutation.make({
			run: () => Effect.fail("no"),
			optimistic: () => Query.set(query, "optimistic"),
		});

		await client.runPromiseExit(Mutation.run(save));

		expect(AsyncResult.value(client.registry.get(query))).toEqual(
			Option.some("server"),
		);
	});

	it("lets hydrate put the server's value in", async () => {
		const schema = { success: Schema.String };
		const server = await makeClient();
		await server.fetch(
			Query.make({
				key: ["hydrated"],
				run: Effect.succeed("server"),
				schema,
			}),
		);
		const client = await makeClient();
		const query = Query.make({
			key: ["hydrated"],
			run: Effect.succeed("browser"),
			schema,
		});
		use(client.registry, query);
		await valueOf(client.registry, query);

		await client.clear(query);
		QueryClient.hydrate(client, QueryClient.dehydrate(server));

		expect(AsyncResult.value(client.registry.get(query))).toEqual(
			Option.some("server"),
		);
	});

	it("shows an atom derived from it as Initial, until something asks", async () => {
		const client = await makeClient();
		const { query } = tracked(["derived"], (n) => Effect.succeed(n));
		const doubled = Atom.map(
			query,
			AsyncResult.map((n: number) => n * 2),
		);
		const seen = record(client.registry, doubled);
		await tick();

		await client.clear(query);
		await client.invalidate(query);
		await tick();

		expect(seen).toEqual(["Success 2", "Initial", "Success 4"]);
	});

	it("interrupts a fetch waiting on it, without fetching again", async () => {
		const client = await makeClient();
		const slow = gate();
		const { fetches, query } = tracked(["waited"], (n) =>
			Effect.as(slow.wait, n),
		);
		const fetching = client.fetch(query);
		const exit = client.runPromiseExit(Query.fetch(query));
		await tick();

		await client.clear();
		slow.open();

		await expect(fetching).rejects.toThrow();
		const settled = await exit;
		expect(
			settled._tag === "Failure" && Cause.hasInterruptsOnly(settled.cause),
		).toBe(true);
		expect(fetches.count).toBe(1);
		expect(client.registry.get(query)._tag).toBe("Initial");
	});

	it("lets a refetch waiting on it resolve", async () => {
		const client = await makeClient();
		const slow = gate();
		const { query } = tracked(["refetched"], (n) =>
			n === 1 ? Effect.succeed(n) : Effect.as(slow.wait, n),
		);
		use(client.registry, query);
		await valueOf(client.registry, query);
		const refetching = client.refetch(query);
		await tick();

		await client.clear();

		await expect(refetching).resolves.toBeUndefined();
	});

	it("lets a Suspense reader waiting on it render again, and fetch", async () => {
		const client = await makeClient();
		const slow = gate();
		const { fetches, query } = tracked(["waiting"], (n) =>
			n === 1 ? Effect.as(slow.wait, n) : Effect.succeed(n),
		);
		const reader = makeQueryUse(client.registry);
		const suspended = suspension(() =>
			reader.suspend(query, client.registry.get(query)),
		);
		await tick();

		await client.clear();
		await suspended;
		await suspension(() => reader.suspend(query, client.registry.get(query)));

		expect(fetches.count).toBe(2);
		expect(show(client.registry.get(query))).toBe("Success 2");
	});

	it("keeps a cleared value from showing as a reader's previous one", async () => {
		const client = await makeClient();
		const one = await cached(client, ["kept", 1]);
		const two = tracked(["kept", 2], (n) => Effect.as(gate().wait, n));
		const reader = makeQueryUse(client.registry);
		reader.mounted(one.query);
		reader.showed(one.query, client.registry.get(one.query), false);

		await client.clear(["kept"]);
		expect(
			show(reader.show(client.registry.get(one.query), true, false)),
		).toBe("Initial");

		use(client.registry, two.query);
		reader.mounted(two.query);
		expect(
			show(reader.show(client.registry.get(two.query), true, false)),
		).toBe("Initial(waiting)");
	});

	it("fetches for a reader that switches to it", async () => {
		const client = await makeClient();
		const one = await cached(client, ["switch", 1]);
		const reader = makeQueryUse(client.registry);
		reader.mounted(one.query);
		const two = await cached(client, ["switch", 2]);

		await client.clear(["switch"]);
		reader.mounted(two.query);
		await tick();

		expect(two.fetches.count).toBe(2);
		expect(show(client.registry.get(two.query))).toBe("Success 2");
	});

	it("starts no fetch for a query in use and one in use that reads it", async () => {
		for (const order of ["reader first", "read first"]) {
			const client = await makeClient();
			const viewer = tracked([order, "viewer"], (n) => Effect.succeed(n), {
				staleTime: "1 hour",
			});
			const todos = tracked(
				[order, "todos"],
				(n) => Effect.as(Effect.succeed(n), n),
				{ staleTime: "1 hour" },
			);
			const reads = Query.make({
				key: [order, "reads"],
				run: (ctx) => ctx.result(viewer.query),
				staleTime: "1 hour",
			});
			if (order === "reader first") {
				use(client.registry, reads);
				use(client.registry, viewer.query);
			} else {
				use(client.registry, viewer.query);
				use(client.registry, reads);
			}
			use(client.registry, todos.query);
			await valueOf(client.registry, reads);

			await client.clear();
			await tick();

			expect(viewer.fetches.count).toBe(1);
			expect(todos.fetches.count).toBe(1);
			expect(client.registry.get(reads)._tag).toBe("Initial");
		}
	});
});

describe("Query.clear and the queries that read a cleared one", () => {
	const pair = async (client: QueryClient.QueryClient, name: string) => {
		const viewer = tracked([name, "viewer"], (n) => Effect.succeed(n), {
			staleTime: "1 hour",
		});
		let runs = 0;
		const reads = Query.make({
			key: [name, "reads"],
			run: (ctx) => {
				runs++;
				return Effect.map(ctx.result(viewer.query), (n) => `of ${n}`);
			},
			staleTime: "1 hour",
		});
		use(client.registry, viewer.query);
		use(client.registry, reads);
		await valueOf(client.registry, reads);
		return { viewer, reads, runs: () => runs };
	};

	it("clears a query in use that reads it, without fetching either", async () => {
		const client = await makeClient();
		const { viewer, reads, runs } = await pair(client, "targeted");

		await client.clear(viewer.query);
		await tick();

		expect(show(client.registry.get(reads))).toBe("Initial");
		expect(show(client.registry.get(viewer.query))).toBe("Initial");
		expect([viewer.fetches.count, runs()]).toEqual([1, 1]);
	});

	it("fetches what a reader reads when the reader is asked for", async () => {
		const client = await makeClient();
		const { viewer, reads } = await pair(client, "asked");

		await client.clear(viewer.query);
		await client.invalidate(reads);

		expect(await valueOf(client.registry, reads)).toBe("of 2");
		expect(viewer.fetches.count).toBe(2);
	});

	it("fetches what a reader that starts being used reads", async () => {
		const client = await makeClient();
		const viewer = await cached(client, ["mounting", "viewer"]);
		const reads = Query.make({
			key: ["mounting", "reads"],
			run: (ctx) => ctx.result(viewer.query),
		});

		await client.clear();
		use(client.registry, reads);

		expect(await valueOf(client.registry, reads)).toBe(2);
		expect(viewer.fetches.count).toBe(2);
	});

	it("clears the readers of its readers", async () => {
		const client = await makeClient();
		const { viewer, reads } = await pair(client, "chain");
		const last = Query.make({
			key: ["chain", "last"],
			run: (ctx) => ctx.result(reads),
			staleTime: "1 hour",
		});
		use(client.registry, last);
		await valueOf(client.registry, last);

		await client.clear(viewer.query);
		await tick();

		expect(client.registry.get(last)._tag).toBe("Initial");
		expect(viewer.fetches.count).toBe(1);
	});

	it("leaves the queries it reads alone", async () => {
		const client = await makeClient();
		const { viewer, reads } = await pair(client, "reads only");

		await client.clear(reads);
		await tick();

		expect(show(client.registry.get(viewer.query))).toBe("Success 1");
	});
});

describe("Query.clear and an optimistic write made after it", () => {
	it("goes back to cleared on rollback, and fetches when asked", async () => {
		const client = await makeClient();
		const { fetches, query } = await cached(client, ["undone"]);
		await client.clear();
		const save = Mutation.make({
			run: () => Effect.fail("no"),
			optimistic: () => Query.set(query, 99),
		});

		await client.runPromiseExit(Mutation.run(save));
		await tick();
		expect(show(client.registry.get(query))).toBe("Initial");
		expect(fetches.count).toBe(1);

		await client.invalidate(query);
		expect(await valueOf(client.registry, query)).toBe(2);
		expect(fetches.count).toBe(2);
	});
});

describe("client.refetch", () => {
	it("resolves when dispose() interrupts it", async () => {
		const client = await makeClient();
		const slow = gate();
		const { query } = tracked(["disposed"], (n) =>
			n === 1 ? Effect.succeed(n) : Effect.as(slow.wait, n),
		);
		use(client.registry, query);
		await valueOf(client.registry, query);
		const refetching = client.refetch(query);
		await tick();

		const disposing = dispose(client);

		await expect(refetching).resolves.toBeUndefined();
		slow.open();
		await disposing;
	});
});
