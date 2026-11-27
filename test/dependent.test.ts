import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Entity, Mutation, Query } from "../src/index.js";
import {
	disposeClients,
	makeClient,
	show,
	tracked,
	useFakeTimers,
	valueOf,
} from "./helpers.js";

afterEach(disposeClients);

/** A query that reads `dependency` through `ctx.result`, recording each value its `run` saw. */
const reader = <A, E>(dependency: Query.Query<A, E>) => {
	const seen: Array<A> = [];
	const query = Query.make({
		key: ["reader"],
		run: (ctx) =>
			Effect.map(ctx.result(dependency), (value) => {
				seen.push(value);
				return value;
			}),
	});
	return { query, seen };
};

describe("ctx.result", () => {
	it("refetches once per refetch of the query it reads, with the new value", async () => {
		useFakeTimers();
		const client = await makeClient();
		const me = tracked(["me"], (fetch) =>
			Effect.succeed(fetch).pipe(Effect.delay("1 second")),
		);
		const mine = reader(me.query);
		client.registry.mount(mine.query);
		await vi.advanceTimersByTimeAsync(1000);
		expect(mine.seen).toEqual([1]);

		const refetching = client.runPromise(Query.refetch(me.query));
		await vi.advanceTimersByTimeAsync(0);
		expect(show(client.registry.get(mine.query))).toBe("Success 1");
		await vi.advanceTimersByTimeAsync(1000);
		await refetching;
		await vi.advanceTimersByTimeAsync(0);

		expect(mine.seen).toEqual([1, 2]);
		expect(show(client.registry.get(mine.query))).toBe("Success 2");
	});

	it("doesn't refetch for each retry of the query it reads", async () => {
		useFakeTimers();
		const client = await makeClient();
		let fail = false;
		const me = tracked(
			["me"],
			(fetch) =>
				(fail ? Effect.fail("down" as const) : Effect.succeed(fetch)).pipe(
					Effect.delay("100 millis"),
				),
			{ retry: Schedule.recurs(2) },
		);
		const mine = reader(me.query);
		client.registry.mount(mine.query);
		await vi.advanceTimersByTimeAsync(100);
		expect(mine.seen).toEqual([1]);

		fail = true;
		void client.runPromise(Query.refetch(me.query));
		await vi.advanceTimersByTimeAsync(1000);

		expect(me.fetches.count).toBe(4);
		expect(mine.seen).toEqual([1]);
		expect(client.registry.get(mine.query)._tag).toBe("Failure");
	});

	it("waits after a reset of the query it reads, and never runs with the old value", async () => {
		useFakeTimers();
		const client = await makeClient();
		const me = tracked(["me"], (fetch) =>
			Effect.succeed(fetch).pipe(Effect.delay("1 second")),
		);
		const mine = reader(me.query);
		client.registry.mount(mine.query);
		await vi.advanceTimersByTimeAsync(1000);

		await client.runPromise(Query.reset(me.query));
		await vi.advanceTimersByTimeAsync(0);
		expect(client.registry.get(mine.query).waiting).toBe(true);
		await vi.advanceTimersByTimeAsync(1000);

		expect(mine.seen).toEqual([1, 2]);
	});

	it("is cleared with the query it reads, and never runs with the old value", async () => {
		useFakeTimers();
		const client = await makeClient();
		const me = tracked(["me"], (fetch) =>
			Effect.succeed(fetch).pipe(Effect.delay("1 second")),
		);
		const mine = reader(me.query);
		client.registry.mount(mine.query);
		await vi.advanceTimersByTimeAsync(1000);

		await client.runPromise(Query.clear(me.query));
		await vi.advanceTimersByTimeAsync(1000);

		expect(mine.seen).toEqual([1]);
		expect(show(client.registry.get(mine.query))).toBe("Initial");
	});

	it("refetches once for a write to the query it reads", async () => {
		const client = await makeClient();
		const me = tracked(["me"], (fetch) => Effect.succeed(fetch));
		const mine = reader(me.query);
		client.registry.mount(mine.query);
		await valueOf(client.registry, mine.query);

		await client.runPromise(Query.set(me.query, 10));
		await valueOf(client.registry, mine.query);
		await client.runPromise(Query.update(me.query, (n) => n + 1));
		await valueOf(client.registry, mine.query);

		expect(mine.seen).toEqual([1, 10, 11]);
	});

	it("refetches once for an optimistic write and once for its rollback", async () => {
		const client = await makeClient();
		const me = tracked(["me"], (fetch) => Effect.succeed(fetch));
		const mine = reader(me.query);
		client.registry.mount(mine.query);
		await valueOf(client.registry, mine.query);

		const save = Mutation.make({
			run: () => Effect.fail("rejected" as const),
			optimistic: () => Query.set(me.query, 50),
		});
		await client.runPromiseExit(Mutation.run(save, undefined));
		await valueOf(client.registry, mine.query);

		expect(mine.seen).toEqual([1, 50, 1]);
	});

	it("refetches once for an entity write to the query it reads", async () => {
		const Todo = Schema.Struct({ id: Schema.String, title: Schema.String });
		const todoEntity = Entity.make(Todo, { id: (todo) => todo.id });
		const client = await makeClient();
		const todo = Query.make({
			key: ["todo"],
			run: Effect.succeed({ id: "t1", title: "Milk" }),
			schema: { success: Todo },
		});
		const titles = reader(todo);
		client.registry.mount(titles.query);
		await valueOf(client.registry, titles.query);

		await client.runPromise(
			Entity.update(todoEntity, "t1", (found) => ({
				...found,
				title: "Eggs",
			})),
		);
		await valueOf(client.registry, titles.query);

		expect(titles.seen.map((found) => found.title)).toEqual(["Milk", "Eggs"]);
	});

	it("reads a query that's refetching when it's first read", async () => {
		useFakeTimers();
		const client = await makeClient();
		const me = tracked(["me"], (fetch) =>
			Effect.succeed(fetch).pipe(Effect.delay("1 second")),
		);
		client.registry.mount(me.query);
		await vi.advanceTimersByTimeAsync(1000);
		void client.runPromise(Query.refetch(me.query));
		await vi.advanceTimersByTimeAsync(0);
		expect(client.registry.get(me.query).waiting).toBe(true);

		const mine = reader(me.query);
		client.registry.mount(mine.query);
		await vi.advanceTimersByTimeAsync(0);
		expect(mine.seen).toEqual([1]);
		await vi.advanceTimersByTimeAsync(1000);

		expect(mine.seen).toEqual([1, 2]);
	});

	it("runs at once when a placeholder is replaced by an equal value", async () => {
		useFakeTimers();
		const client = await makeClient();
		const me = Query.make({
			key: ["me"],
			run: Effect.succeed(1).pipe(Effect.delay("1 second")),
			placeholder: Effect.succeed(Option.some(7)),
		});
		const mine = reader(me);
		client.registry.mount(mine.query);
		await vi.advanceTimersByTimeAsync(0);
		expect(mine.seen).toEqual([]);

		await client.runPromise(Query.set(me, 7));
		await vi.advanceTimersByTimeAsync(0);

		expect(mine.seen).toEqual([7]);
	});

	it("waits after a reset to a placeholder equal to the value it read", async () => {
		useFakeTimers();
		const client = await makeClient();
		const me = Query.make({
			key: ["me"],
			run: Effect.succeed(7).pipe(Effect.delay("1 second")),
			placeholder: Effect.succeed(Option.some(7)),
		});
		const mine = reader(me);
		client.registry.mount(mine.query);
		await vi.advanceTimersByTimeAsync(1000);
		expect(mine.seen).toEqual([7]);

		await client.runPromise(Query.reset(me));
		await vi.advanceTimersByTimeAsync(0);

		expect(client.registry.get(mine.query).waiting).toBe(true);
		await vi.advanceTimersByTimeAsync(1000);
		expect(mine.seen).toEqual([7, 7]);
	});

	it("runs with the value it reads, then the new one, when one refetch reaches both", async () => {
		useFakeTimers();
		const client = await makeClient();
		const me = tracked(["x", "me"], (fetch) =>
			Effect.succeed(fetch).pipe(Effect.delay("1 second")),
		);
		const seen: Array<number> = [];
		const mine = Query.make({
			key: ["x", "reader"],
			run: (ctx) =>
				Effect.map(ctx.result(me.query), (value) => {
					seen.push(value);
					return value;
				}),
		});
		client.registry.mount(mine);
		await vi.advanceTimersByTimeAsync(1000);

		void client.runPromise(Query.invalidate(["x"]));
		await vi.advanceTimersByTimeAsync(1000);

		expect(seen).toEqual([1, 1, 2]);
	});
});
