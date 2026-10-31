import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schedule from "effect/Schedule";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Mutation, Query, QueryClient } from "../src/index.js";
import { type CacheEvent, subscribe } from "../src/internal/events.js";
import { makeHandle } from "../src/internal/mutationHandle.js";
import { internals } from "../src/internal/queryAtom.js";
import { StateAtom } from "../src/internal/runtime.js";
import {
	dispose,
	disposeClients,
	gate,
	makeClient,
	record,
	tracked,
} from "./helpers.js";
import { Greeting } from "./services.js";

afterEach(disposeClients);

/** Lets forked runs reach their next step. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

class Rejected {
	readonly _tag = "Rejected";
}

/** A cached query holding `value`, and a way to read what it shows. */
const cached = async (
	client: QueryClient.QueryClient,
	key: string,
	value: number,
) => {
	const { query } = tracked([key], () => Effect.succeed(value));
	await client.runPromise(Query.fetch(query));
	const current = () =>
		Option.getOrUndefined(AsyncResult.value(client.registry.get(query)));
	return { query, current };
};

describe("Mutation.run", () => {
	it("runs with the client's services and returns the value", async () => {
		const client = await makeClient();
		const greet = Mutation.make({
			run: (name: string) =>
				Greeting.useSync(({ text }) => `${text}, ${name}`),
		});

		expect(await client.runPromise(Mutation.run(greet, "Ada"))).toBe(
			"hello, Ada",
		);
	});

	it("calls its options and the client's hooks in order on success", async () => {
		const log: Array<string> = [];
		const step = (name: string) => Effect.sync(() => log.push(name));
		const client = await makeClient({
			mutations: {
				onMutate: () => step("client onMutate"),
				onSuccess: () => step("client onSuccess"),
				onFailure: () => step("client onFailure"),
				onSettled: () => step("client onSettled"),
			},
		});
		const { query } = tracked(["list"], () =>
			Effect.sync(() => log.push("list fetched")),
		);
		const unmount = client.registry.mount(query);
		log.length = 0;
		const save = Mutation.make({
			run: (n: number) => Effect.as(step("run"), n),
			optimistic: () => step("optimistic"),
			onSuccess: () => step("onSuccess"),
			onFailure: () => step("onFailure"),
			onSettled: () => step("onSettled"),
			invalidates: [["list"]],
		});

		await client.runPromise(Mutation.run(save, 1));
		unmount();

		expect(log).toEqual([
			"optimistic",
			"client onMutate",
			"run",
			"onSuccess",
			"list fetched",
			"client onSuccess",
			"onSettled",
			"client onSettled",
		]);
	});

	it("passes the mutation and its variables to the client's hooks", async () => {
		const events: Array<unknown> = [];
		const client = await makeClient({
			mutations: {
				onMutate: (event) => Effect.sync(() => events.push(event)),
				onSuccess: (event) => Effect.sync(() => events.push(event)),
				onSettled: ({ mutation, variables }) =>
					Effect.sync(() => events.push({ mutation, variables })),
			},
		});
		const double = Mutation.make({
			run: (n: number) => Effect.succeed(n * 2),
		});

		await client.runPromise(Mutation.run(double, 2));

		expect(events).toEqual([
			{ mutation: double, variables: 2 },
			{ mutation: double, variables: 2, value: 4 },
			{ mutation: double, variables: 2 },
		]);
	});

	it("invalidates the targets a function returns, from the value and variables", async () => {
		const client = await makeClient();
		const queries = [
			["todos", 1],
			["todos", 2],
			["drafts", 1],
			["drafts", 2],
		].map((key) => tracked(key, () => Effect.succeed(key)));
		const unmount = queries.map(({ query }) => client.registry.mount(query));
		const copy = Mutation.make({
			run: (id: number) => Effect.succeed({ id: id + 1 }),
			invalidates: (saved, id) => [
				["todos", saved.id],
				["drafts", id],
			],
		});

		await client.runPromise(Mutation.run(copy, 1));
		unmount.forEach((f) => f());

		expect(queries.map(({ fetches }) => fetches.count)).toEqual([1, 2, 2, 1]);
	});

	it("calls its options and the client's hooks in order on failure", async () => {
		const log: Array<string> = [];
		const step = (name: string) => Effect.sync(() => log.push(name));
		const client = await makeClient({
			mutations: {
				onMutate: () => step("client onMutate"),
				onSuccess: () => step("client onSuccess"),
				onFailure: () => step("client onFailure"),
				onSettled: () => step("client onSettled"),
			},
		});
		const { query, current } = await cached(client, "n", 0);
		const failing = Mutation.make({
			run: () => Effect.andThen(step("run"), Effect.fail(new Rejected())),
			optimistic: () =>
				Effect.andThen(step("optimistic"), Query.set(query, 1)),
			onSuccess: () => step("onSuccess"),
			onFailure: () => step(`onFailure, shows ${current()}`),
			onSettled: () => step("onSettled"),
			invalidates: [["n"]],
		});

		await client.runPromiseExit(Mutation.run(failing));

		expect(log).toEqual([
			"optimistic",
			"client onMutate",
			"run",
			"onFailure, shows 0",
			"client onFailure",
			"onSettled",
			"client onSettled",
		]);
	});

	it("dies with a callback's defect, skipping the steps after it", async () => {
		const hooks = vi.fn(() => Effect.void);
		const client = await makeClient({
			mutations: { onSuccess: hooks, onSettled: hooks },
		});
		const { query, current } = await cached(client, "n", 0);
		const save = Mutation.make({
			run: (n: number) => Effect.succeed(n),
			optimistic: (n) => Query.set(query, n),
			onSuccess: () => Effect.die("boom"),
		});

		const exit = await client.runPromiseExit(Mutation.run(save, 2));

		expect(exit).toEqual(Exit.die("boom"));
		expect(hooks).not.toHaveBeenCalled();
		expect(current()).toBe(2);
	});

	it("rolls back the writes of an optimistic that dies", async () => {
		const ran = vi.fn();
		const client = await makeClient();
		const { query, current } = await cached(client, "n", 0);
		const save = Mutation.make({
			run: () => Effect.sync(ran),
			optimistic: () =>
				Effect.andThen(Query.set(query, 1), Effect.die("boom")),
		});

		const exit = await client.runPromiseExit(Mutation.run(save));

		expect(exit).toEqual(Exit.die("boom"));
		expect(ran).not.toHaveBeenCalled();
		expect(current()).toBe(0);
	});

	it("fails with run's error, after rolling back, then calls onFailure", async () => {
		const client = await makeClient();
		const { query, current } = await cached(client, "n", 0);
		const seen: Array<unknown> = [];
		const failing = Mutation.make({
			run: (n: number) => Effect.as(Effect.fail(new Rejected()), n),
			optimistic: (n) => Query.set(query, n),
			onFailure: (cause) =>
				Effect.map(Query.get(query), (value) =>
					seen.push(Cause.squash(cause), Option.getOrUndefined(value)),
				),
		});

		const exit = await client.runPromiseExit(Mutation.run(failing, 5));

		expect(Exit.isFailure(exit)).toBe(true);
		expect(seen).toEqual([new Rejected(), 0]);
		expect(current()).toBe(0);
	});

	it("rolls back several writes, newest first", async () => {
		const client = await makeClient();
		const { query, current } = await cached(client, "n", 1);
		const shown = record(client.registry, query);
		const failing = Mutation.make({
			run: () => Effect.fail(new Rejected()),
			optimistic: () =>
				Effect.andThen(
					Query.set(query, 2),
					Query.update(query, (n) => n * 10),
				),
		});

		await client.runPromiseExit(Mutation.run(failing));

		expect(shown).toEqual([
			"Success 1",
			"Success 2",
			"Success 20",
			"Success 2",
			"Success 1",
		]);
		expect(current()).toBe(1);
	});

	it("puts back a query invalidated while unused, still invalidated", async () => {
		const client = await makeClient();
		const { query, fetches } = tracked(
			["list"],
			(fetch) => Effect.succeed([fetch]),
			{ staleTime: "1 minute" },
		);
		const slow = gate();
		await client.runPromise(Query.fetch(query));
		const unmount = client.registry.mount(query);
		unmount();
		await client.runPromise(Query.invalidate(query));
		const failing = Mutation.make({
			run: () => Effect.andThen(slow.wait, Effect.fail(new Rejected())),
			optimistic: () => Query.update(query, (list) => [...list, 0]),
		});

		const run = client.runPromiseExit(Mutation.run(failing));
		// The old generation's fetch atom must be swept, as it is once a run
		// takes a while, for the rollback to have to bring it back.
		await vi.waitFor(() =>
			expect(
				client.registry.getNodes().has(internals(query).fetchAtom(0)),
			).toBe(false),
		);
		expect(await client.runPromise(Query.get(query))).toEqual(
			Option.some([1, 0]),
		);
		slow.open();
		await run;

		expect(await client.runPromise(Query.get(query))).toEqual(
			Option.some([1]),
		);
		expect(fetches.count).toBe(1);
		expect(await client.runPromise(Query.fetch(query))).toEqual([2]);
	});

	it("drops an optimistic value written to a query that wasn't cached", async () => {
		const client = await makeClient();
		const { query, fetches } = tracked(["absent"], () => Effect.succeed(1));
		let during: Option.Option<number> = Option.none();
		const failing = Mutation.make({
			run: () =>
				Effect.andThen(
					Effect.map(Query.get(query), (value) => {
						during = value;
					}),
					Effect.fail(new Rejected()),
				),
			optimistic: () => Query.set(query, 7),
		});

		await client.runPromiseExit(Mutation.run(failing));

		expect(during).toEqual(Option.some(7));
		expect(await client.runPromise(Query.get(query))).toEqual(Option.none());
		expect(fetches.count).toBe(0);
	});

	it("keeps optimistic writes when run succeeds", async () => {
		const client = await makeClient();
		const { query, current } = await cached(client, "n", 0);
		const save = Mutation.make({
			run: (n: number) => Effect.succeed(n),
			optimistic: (n) => Query.set(query, n),
		});

		await client.runPromise(Mutation.run(save, 3));

		expect(current()).toBe(3);
	});

	it("doesn't record the writes of a mutation run inside optimistic", async () => {
		const client = await makeClient();
		const outer = await cached(client, "outer", 0);
		const inner = await cached(client, "inner", 0);
		const save = Mutation.make({
			run: (n: number) => Effect.succeed(n),
			onSuccess: (n) => Query.set(inner.query, n),
		});
		const failing = Mutation.make({
			run: () => Effect.fail(new Rejected()),
			optimistic: () =>
				Effect.andThen(
					Query.set(outer.query, 1),
					Mutation.run(save, 5).pipe(
						Effect.provideService(Greeting, { text: "hi" }),
					),
				),
		});

		await client.runPromiseExit(Mutation.run(failing));

		expect([outer.current(), inner.current()]).toEqual([0, 5]);
	});

	it("records only writes made in optimistic", async () => {
		const client = await makeClient();
		const { query, current } = await cached(client, "n", 0);
		const failing = Mutation.make({
			run: () =>
				Effect.andThen(Query.set(query, 4), Effect.fail(new Rejected())),
		});

		await client.runPromiseExit(Mutation.run(failing));

		expect(current()).toBe(4);
	});

	it("retries run on its own schedule, else the client's", async () => {
		const client = await makeClient({
			mutations: { defaults: { retry: Schedule.recurs(1) } },
		});
		const attempts = { own: 0, client: 0 };
		const flaky = (key: "own" | "client") => () =>
			Effect.suspend(() =>
				++attempts[key] < 3
					? Effect.fail(new Rejected())
					: Effect.succeed(key),
			);
		const own = Mutation.make({
			run: flaky("own"),
			retry: Schedule.recurs(2),
		});
		const fromClient = Mutation.make({ run: flaky("client") });

		expect(await client.runPromise(Mutation.run(own))).toBe("own");
		expect(
			Exit.isFailure(await client.runPromiseExit(Mutation.run(fromClient))),
		).toBe(true);
		expect(attempts).toEqual({ own: 3, client: 2 });
	});

	it("runs the other client hooks when one dies", async () => {
		const settled = vi.fn();
		const client = await makeClient({
			mutations: {
				onSuccess: () => Effect.die("boom"),
				onSettled: () => Effect.sync(settled),
			},
		});
		const save = Mutation.make({ run: () => Effect.succeed(1) });

		const exit = await client.runPromiseExit(Mutation.run(save));

		expect(exit).toEqual(Exit.succeed(1));
		expect(settled).toHaveBeenCalledOnce();
	});

	it("is interrupted by dispose along with fetches, not after them", async () => {
		const log: Array<string> = [];
		const client = await makeClient();
		let acquired: () => void = () => {};
		const fetching = new Promise<void>((resolve) => {
			acquired = resolve;
		});
		const query = Query.make({
			key: ["slow"],
			run: Effect.acquireRelease(Effect.sync(acquired), () =>
				Effect.andThen(
					Effect.sleep("10 millis"),
					Effect.sync(() => log.push("fetch released")),
				),
			).pipe(Effect.andThen(Effect.never)),
		});
		client.registry.mount(query);
		await fetching;
		const waiting = Mutation.make({
			run: () =>
				Effect.never.pipe(
					Effect.onInterrupt(() =>
						Effect.sync(() => log.push("mutation interrupted")),
					),
				),
		});
		const run = client.runPromiseExit(Mutation.run(waiting));
		await flush();

		await dispose(client);
		const exit = await run;

		expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
			true,
		);
		expect(log).toEqual(["mutation interrupted", "fetch released"]);
	});

	it("emits started and settled events with one run id", async () => {
		const client = await makeClient();
		const events: Array<CacheEvent> = [];
		subscribe(client.registry.get(StateAtom), (event) => events.push(event));
		const save = Mutation.make({ run: (n: number) => Effect.succeed(n) });

		await client.runPromise(Mutation.run(save, 1));

		expect(events.map((event) => event._tag)).toEqual([
			"MutationStarted",
			"MutationSettled",
		]);
		const [started, settled] = events;
		expect(started).toMatchObject({ mutation: save, variables: 1 });
		expect(settled).toMatchObject({ mutation: save, exit: Exit.succeed(1) });
		expect(started && "runId" in started && started.runId).toBe(
			settled && "runId" in settled && settled.runId,
		);
	});
});

describe("mutation handles", () => {
	it("keep separate state per use", async () => {
		const client = await makeClient();
		const slow = gate();
		const save = Mutation.make({
			run: (n: number) => Effect.as(slow.wait, n),
		});
		const first = makeHandle(client.registry, save);
		const second = makeHandle(client.registry, save);
		const shownFirst = record(client.registry, first.result);
		const shownSecond = record(client.registry, second.result);

		const run = first.run(1);
		slow.open();

		expect(await run).toEqual(Exit.succeed(1));

		expect(shownFirst).toEqual(["Initial", "Initial(waiting)", "Success 1"]);
		expect(shownSecond).toEqual(["Initial"]);
	});

	it("complete concurrent runs, showing the latest", async () => {
		const client = await makeClient();
		const slow = gate();
		const save = Mutation.make({
			run: (n: number) =>
				n === 1 ? Effect.as(slow.wait, n) : Effect.succeed(n),
		});
		const handle = makeHandle(client.registry, save);
		const shown = record(client.registry, handle.result);

		const first = handle.run(1);
		await flush();
		const second = await handle.run(2);
		slow.open();

		expect([await first, second]).toEqual([Exit.succeed(1), Exit.succeed(2)]);
		expect(shown.at(-1)).toBe("Success 2");
	});

	it("with concurrent: false, wait for every replaced run to roll back", async () => {
		const client = await makeClient();
		const { query, current } = await cached(client, "n", 0);
		const save = Mutation.make({
			run: (n: number) =>
				n === 3
					? Effect.succeed(n)
					: Effect.never.pipe(
							Effect.onInterrupt(() => Effect.sleep("20 millis")),
						),
			optimistic: (n) => Query.set(query, n),
			concurrent: false,
		});
		const handle = makeHandle(client.registry, save);

		const first = handle.run(1);
		await flush();
		const second = handle.run(2);
		const third = await handle.run(3);
		await Promise.all([first, second]);

		expect(third).toEqual(Exit.succeed(3));
		expect(current()).toBe(3);
	});

	it("with concurrent: false, interrupt the previous run and roll it back first", async () => {
		const log: Array<string> = [];
		const client = await makeClient({
			mutations: { onSettled: () => Effect.sync(() => log.push("hook")) },
		});
		const { query, current } = await cached(client, "n", 0);
		const shown = record(client.registry, query);
		const save = Mutation.make({
			run: (n: number) => (n === 1 ? Effect.never : Effect.succeed(n)),
			optimistic: (n) => Query.set(query, n),
			concurrent: false,
		});
		const handle = makeHandle(client.registry, save);

		const first = handle.run(1);
		await flush();
		const second = await handle.run(2);
		const firstExit = await first;

		expect(
			Exit.isFailure(firstExit) && Cause.hasInterruptsOnly(firstExit.cause),
		).toBe(true);
		expect(second).toEqual(Exit.succeed(2));
		expect(shown).toEqual([
			"Success 0",
			"Success 1",
			"Success 0",
			"Success 2",
		]);
		expect(current()).toBe(2);
		expect(log).toEqual(["hook"]);
	});

	it("take concurrent: false from the client's defaults", async () => {
		const client = await makeClient({
			mutations: { defaults: { concurrent: false } },
		});
		const save = Mutation.make({
			run: (n: number) => (n === 1 ? Effect.never : Effect.succeed(n)),
		});
		const handle = makeHandle(client.registry, save);

		const first = handle.run(1);
		await flush();
		await handle.run(2);

		expect(Exit.isFailure(await first)).toBe(true);
	});

	it("show a failure with the previous success", async () => {
		const client = await makeClient();
		const slow = gate();
		const save = Mutation.make({
			run: (n: number) =>
				n > 0
					? Effect.succeed(n)
					: Effect.andThen(slow.wait, Effect.fail(new Rejected())),
		});
		const handle = makeHandle(client.registry, save);
		const shown = record(client.registry, handle.result);

		await handle.run(1);
		const run = handle.run(0);
		slow.open();
		const exit = await run;

		expect(Exit.isFailure(exit)).toBe(true);
		expect(shown.slice(-2)).toEqual(["Success(waiting) 1", "Failure 1"]);
	});

	it("reset to Initial while a run carries on", async () => {
		const client = await makeClient();
		const slow = gate();
		const save = Mutation.make({
			run: (n: number) => Effect.as(slow.wait, n),
		});
		const handle = makeHandle(client.registry, save);
		const shown = record(client.registry, handle.result);

		const run = handle.run(1);
		handle.reset();
		slow.open();

		expect(await run).toEqual(Exit.succeed(1));
		expect(shown.at(-1)).toBe("Initial");
	});

	it("show the latest run to a subscriber that comes back", async () => {
		const client = await makeClient();
		const slow = gate();
		const save = Mutation.make({
			run: (n: number) => Effect.as(slow.wait, n),
		});
		const handle = makeHandle(client.registry, save);
		const unsubscribe = client.registry.subscribe(handle.result, () => {});

		const run = handle.run(1);
		unsubscribe();
		await flush();
		const whileRunning = record(client.registry, handle.result);
		slow.open();
		await run;
		await flush();

		expect(whileRunning).toEqual(["Initial(waiting)", "Success 1"]);
		expect(record(client.registry, handle.result)).toEqual(["Success 1"]);
	});

	it("show a run started before anything subscribed", async () => {
		const client = await makeClient();
		const save = Mutation.make({ run: (n: number) => Effect.succeed(n) });
		const handle = makeHandle(client.registry, save);

		await handle.run(1);

		expect(record(client.registry, handle.result)).toEqual(["Success 1"]);
	});

	it("still replace an in-flight run after reset", async () => {
		const client = await makeClient();
		const save = Mutation.make({
			run: (n: number) => (n === 1 ? Effect.never : Effect.succeed(n)),
			concurrent: false,
		});
		const handle = makeHandle(client.registry, save);

		const first = handle.run(1);
		handle.reset();
		await handle.run(2);

		expect(Exit.isFailure(await first)).toBe(true);
	});

	it("resolve a run after dispose with a defect, without throwing", async () => {
		const client = await makeClient();
		const handle = makeHandle(
			client.registry,
			Mutation.make({ run: () => Effect.succeed(1) }),
		);
		await dispose(client);

		const exit = await handle.run();

		expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
	});

	it("finish a run after its last subscriber leaves", async () => {
		const client = await makeClient();
		const slow = gate();
		const { query, current } = await cached(client, "n", 0);
		const save = Mutation.make({
			run: (n: number) => Effect.as(slow.wait, n),
			onSuccess: (n) => Query.set(query, n * 10),
		});
		const handle = makeHandle(client.registry, save);
		const unsubscribe = client.registry.subscribe(handle.result, () => {});

		const run = handle.run(1);
		unsubscribe();
		await flush();
		slow.open();

		expect(await run).toEqual(Exit.succeed(1));
		expect(current()).toBe(10);
	});

	it("are interrupted by dispose, without hooks", async () => {
		const log: Array<string> = [];
		const client = await makeClient({
			mutations: { onSettled: () => Effect.sync(() => log.push("hook")) },
		});
		const { query } = await cached(client, "n", 0);
		const save = Mutation.make({
			run: () => Effect.never,
			optimistic: () => Query.set(query, 1),
		});
		const handle = makeHandle(client.registry, save);

		const run = handle.run(undefined);
		await flush();
		await dispose(client);
		const exit = await run;

		expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
			true,
		);
		expect(log).toEqual([]);
	});
});
