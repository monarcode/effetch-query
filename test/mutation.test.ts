import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schedule from "effect/Schedule";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Mutation, Query, QueryClient } from "../src/index.js";
import { makeActivityHandle, noRuns } from "../src/internal/activity.js";
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
import { Greeting, servicesLayer } from "./services.js";

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

describe("Mutation.isMutation", () => {
	it("tells mutations from other values", () => {
		const ping = Mutation.make({ run: () => Effect.void });

		expect(Mutation.isMutation(ping)).toBe(true);
		expect(Mutation.isMutation({ run: () => Effect.void })).toBe(false);
		expect(
			Mutation.isMutation(Query.make({ key: ["k"], run: Effect.void })),
		).toBe(false);
		expect(Mutation.isMutation(null)).toBe(false);
	});
});

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

	it("fails before its run when invalidates holds a key that holds a query", async () => {
		const client = await makeClient();
		const { query } = tracked(["todos"], () => Effect.succeed(1));
		let runs = 0;
		const save = Mutation.make({
			run: () => Effect.sync(() => runs++),
			invalidates: [[query]],
		});

		const exit = await client.runPromiseExit(Mutation.run(save, undefined));

		expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
			_tag: "KeyHoldsTargetError",
		});
		expect(runs).toBe(0);
	});

	it("succeeds, and skips the target, when invalidates returns a key that holds a query", async () => {
		const client = await makeClient();
		const { query } = tracked(["todos"], () => Effect.succeed(1));
		const settled: Array<string> = [];
		const save = Mutation.make({
			run: () => Effect.succeed("saved"),
			invalidates: () => [[query], ["other"]],
			onSuccess: () => Effect.sync(() => settled.push("success")),
			onFailure: () => Effect.sync(() => settled.push("failure")),
		});

		const exit = await client.runPromiseExit(Mutation.run(save, undefined));

		expect(exit).toEqual(Exit.succeed("saved"));
		expect(settled).toEqual(["success"]);
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
					Mutation.run(save, 5).pipe(Effect.provide(servicesLayer("hi"))),
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

describe("a run's callbacks", () => {
	const logged = (log: Array<string>) => ({
		onSuccess: (value: number, variables: number) =>
			log.push(`success ${value} ${variables}`),
		onFailure: (cause: Cause.Cause<string>) =>
			log.push(`failure ${Cause.squash(cause)}`),
		onSettled: (exit: Exit.Exit<number, string>) =>
			log.push(`settled ${exit._tag}`),
	});

	it("are called after the mutation's own and the client's, before run resolves", async () => {
		const log: Array<string> = [];
		const client = await makeClient({
			mutations: { onSettled: () => Effect.sync(() => log.push("client")) },
		});
		const save = Mutation.make({
			run: (n: number) => Effect.succeed(n * 2),
			onSuccess: () => Effect.sync(() => log.push("mutation")),
		});
		const handle = makeHandle(client.registry, save);

		const exit = await handle.run(2, logged(log));
		log.push("resolved");

		expect(exit).toEqual(Exit.succeed(4));
		expect(log).toEqual([
			"mutation",
			"client",
			"success 4 2",
			"settled Success",
			"resolved",
		]);
	});

	it("get the cause of a failure", async () => {
		const log: Array<string> = [];
		const client = await makeClient();
		const save = Mutation.make<number, never, string>({
			run: () => Effect.fail("boom"),
		});
		const handle = makeHandle(client.registry, save);

		await handle.run(1, logged(log));

		expect(log).toEqual(["failure boom", "settled Failure"]);
	});

	it("log a callback that throws, and still call the rest", async () => {
		const log: Array<string> = [];
		const failed = new Error("callback failed");
		const logError = vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		const save = Mutation.make({ run: (n: number) => Effect.succeed(n) });
		const handle = makeHandle(client.registry, save);

		const exit = await handle.run(1, {
			onSuccess: () => {
				throw failed;
			},
			onSettled: () => log.push("settled"),
		});

		expect(exit).toEqual(Exit.succeed(1));
		expect(log).toEqual(["settled"]);
		expect(logError).toHaveBeenCalledWith(
			"A mutation run's callback failed:",
			failed,
		);
		logError.mockRestore();
	});

	it("are dropped after reset, while the run completes", async () => {
		const log: Array<string> = [];
		const client = await makeClient();
		const slow = gate();
		const save = Mutation.make({
			run: (n: number) => Effect.as(slow.wait, n),
			onSuccess: () => Effect.sync(() => log.push("mutation")),
		});
		const handle = makeHandle(client.registry, save);

		const run = handle.run(1, logged(log));
		handle.reset();
		slow.open();

		expect(await run).toEqual(Exit.succeed(1));
		expect(log).toEqual(["mutation"]);
	});

	it("are dropped when a newer run starts", async () => {
		const log: Array<string> = [];
		const client = await makeClient();
		const slow = gate();
		const save = Mutation.make({
			run: (n: number) =>
				n === 1 ? Effect.as(slow.wait, n) : Effect.succeed(n),
		});
		const handle = makeHandle(client.registry, save);

		const first = handle.run(1, logged(log));
		await handle.run(2, logged(log));
		slow.open();
		await first;

		expect(log).toEqual(["success 2 2", "settled Success"]);
	});

	it("aren't called for an interrupted run", async () => {
		const log: Array<string> = [];
		const client = await makeClient();
		const save = Mutation.make<number, never, never>({
			run: () => Effect.never,
		});
		const handle = makeHandle(client.registry, save);

		const run = handle.run(1, logged(log));
		await flush();
		await dispose(client);
		const exit = await run;

		expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
			true,
		);
		expect(log).toEqual([]);
	});

	it("are dropped once the handle is released, and called again once retained", async () => {
		const log: Array<string> = [];
		const client = await makeClient();
		const save = Mutation.make({ run: (n: number) => Effect.succeed(n) });
		const handle = makeHandle(client.registry, save);

		const release = handle.retain();
		release();
		await handle.run(1, logged(log));
		handle.retain();
		await handle.run(2, logged(log));

		expect(log).toEqual(["success 2 2", "settled Success"]);
	});
});

const isInterrupted = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause);

describe('concurrent: "queue"', () => {
	it("runs one at a time, in order", async () => {
		const client = await makeClient();
		const log: Array<string> = [];
		const gates = [gate(), gate(), gate()];
		const save = Mutation.make({
			run: (n: number) =>
				Effect.sync(() => log.push(`start ${n}`)).pipe(
					Effect.andThen(gates[n]!.wait),
					Effect.tap(() => Effect.sync(() => log.push(`end ${n}`))),
					Effect.as(n),
				),
			concurrent: "queue",
		});
		const handle = makeHandle(client.registry, save);

		const runs = [handle.run(0), handle.run(1), handle.run(2)];
		await flush();
		expect(log).toEqual(["start 0"]);
		gates[2]!.open();
		gates[1]!.open();
		await flush();
		expect(log).toEqual(["start 0"]);
		gates[0]!.open();

		expect(await Promise.all(runs)).toEqual([0, 1, 2].map(Exit.succeed));
		expect(log).toEqual([
			"start 0",
			"end 0",
			"start 1",
			"end 1",
			"start 2",
			"end 2",
		]);
	});

	it("writes a run's optimistic update when it starts, and rolls back only its own", async () => {
		const client = await makeClient();
		const { query, current } = await cached(client, "n", 0);
		const shown = record(client.registry, query);
		const slow = gate();
		const save = Mutation.make({
			run: (n: number) =>
				n === 1
					? Effect.andThen(slow.wait, Effect.fail(new Rejected()))
					: Effect.succeed(n),
			optimistic: (n) => Query.set(query, n),
			concurrent: "queue",
		});
		const handle = makeHandle(client.registry, save);

		const first = handle.run(1);
		const second = handle.run(2);
		await flush();
		expect(current()).toBe(1);
		slow.open();
		await Promise.all([first, second]);

		expect(shown).toEqual([
			"Success 0",
			"Success 1",
			"Success 0",
			"Success 2",
		]);
	});

	it("calls only the latest run's callbacks, and resolves every run", async () => {
		const client = await makeClient();
		const called: Array<number> = [];
		const save = Mutation.make({
			run: (n: number) => Effect.succeed(n),
			concurrent: "queue",
		});
		const handle = makeHandle(client.registry, save);
		const onSuccess = (n: number) => {
			called.push(n);
		};

		const exits = await Promise.all([
			handle.run(1, { onSuccess }),
			handle.run(2, { onSuccess }),
		]);

		expect(exits).toEqual([Exit.succeed(1), Exit.succeed(2)]);
		expect(called).toEqual([2]);
	});

	it("counts a queued run as in progress", async () => {
		const client = await makeClient();
		const slow = gate();
		const save = Mutation.make({
			run: (n: number) => Effect.as(slow.wait, n),
			concurrent: "queue",
		});
		const handle = makeHandle(client.registry, save);
		const activity = makeActivityHandle(client.registry);

		const runs = [handle.run(1), handle.run(2)];
		await flush();

		expect(activity.mutating(save)).toBe(2);
		expect(activity.runs(save).map((run) => run.variables)).toEqual([1, 2]);
		slow.open();
		await Promise.all(runs);
		expect(activity.mutating(save)).toBe(0);
	});

	it("interrupts queued runs on dispose", async () => {
		const client = await makeClient();
		const started: Array<number> = [];
		const save = Mutation.make({
			run: (n: number) =>
				Effect.andThen(
					Effect.sync(() => started.push(n)),
					Effect.never,
				),
			concurrent: "queue",
		});
		const handle = makeHandle(client.registry, save);
		const activity = makeActivityHandle(client.registry);

		const runs = [handle.run(1), handle.run(2)];
		await flush();
		await dispose(client);
		const exits = await Promise.all(runs);

		expect(exits.every(isInterrupted)).toBe(true);
		expect(started).toEqual([1]);
		expect(activity.mutating()).toBe(0);
		expect(activity.runs(save)).toEqual([]);
	});
});

describe('concurrent: "drop"', () => {
	it("ignores a run while one is in progress", async () => {
		const client = await makeClient();
		const slow = gate();
		const started: Array<number> = [];
		const { query, current } = await cached(client, "n", 0);
		const save = Mutation.make({
			run: (n: number) =>
				Effect.andThen(
					Effect.sync(() => started.push(n)),
					Effect.as(slow.wait, n),
				),
			optimistic: (n) => Query.set(query, n),
			concurrent: "drop",
		});
		const handle = makeHandle(client.registry, save);
		const shown = record(client.registry, handle.result);
		const called: Array<number> = [];
		const onSuccess = (n: number) => {
			called.push(n);
		};
		const activity = makeActivityHandle(client.registry);

		const first = handle.run(1, { onSuccess });
		await flush();
		const dropped = await handle.run(2, { onSuccess });

		expect(isInterrupted(dropped)).toBe(true);
		expect(current()).toBe(1);
		expect(client.registry.get(handle.variables)).toBe(1);
		expect(activity.mutating(save)).toBe(1);
		slow.open();
		expect(await first).toEqual(Exit.succeed(1));
		expect(started).toEqual([1]);
		expect(called).toEqual([1]);
		expect(shown).toEqual(["Initial", "Initial(waiting)", "Success 1"]);
	});

	it("starts a run after reset, while the run it stopped showing carries on", async () => {
		const client = await makeClient();
		const slow = gate();
		const started: Array<number> = [];
		const save = Mutation.make({
			run: (n: number) =>
				Effect.andThen(
					Effect.sync(() => started.push(n)),
					n === 1 ? Effect.as(slow.wait, n) : Effect.succeed(n),
				),
			concurrent: "drop",
		});
		const handle = makeHandle(client.registry, save);

		const first = handle.run(1);
		await flush();
		handle.reset();
		const second = await handle.run(2);

		expect(second).toEqual(Exit.succeed(2));
		expect(started).toEqual([1, 2]);
		slow.open();
		expect(await first).toEqual(Exit.succeed(1));
	});

	it("starts a run once the one before has settled", async () => {
		const client = await makeClient({
			mutations: { defaults: { concurrent: "drop" } },
		});
		const save = Mutation.make({ run: (n: number) => Effect.succeed(n) });
		const handle = makeHandle(client.registry, save);

		await handle.run(1);

		expect(await handle.run(2)).toEqual(Exit.succeed(2));
	});
});

describe("a handle's variables", () => {
	it("are the shown run's, and undefined before a run and after reset", async () => {
		const client = await makeClient();
		const slow = gate();
		const save = Mutation.make({
			run: (n: number) => Effect.as(slow.wait, n),
		});
		const handle = makeHandle(client.registry, save);
		const seen: Array<number | undefined> = [];
		client.registry.subscribe(
			handle.variables,
			(variables) => seen.push(variables),
			{ immediate: true },
		);

		const first = handle.run(1);
		const second = handle.run(2);
		handle.reset();
		slow.open();
		await Promise.all([first, second]);

		expect(seen).toEqual([undefined, 1, 2, undefined]);
	});
});

describe("activity", () => {
	it("counts the queries fetching, by target", async () => {
		const client = await makeClient();
		const slow = gate();
		const activity = makeActivityHandle(client.registry);
		const todos = Query.make({ key: ["todos", 1], run: slow.wait });
		const notified = vi.fn();
		activity.subscribe(notified);

		const fetching = client.runPromise(Query.fetch(todos));
		await flush();

		expect(activity.fetching()).toBe(1);
		expect(activity.fetching(["todos"])).toBe(1);
		expect(activity.fetching(todos)).toBe(1);
		expect(activity.fetching(["profile"])).toBe(0);
		slow.open();
		await fetching;
		await flush();
		expect(activity.fetching()).toBe(0);
		expect(notified).toHaveBeenCalledTimes(2);
	});

	it("tells listeners in a microtask, once for changes made together", async () => {
		const client = await makeClient();
		const activity = makeActivityHandle(client.registry);
		const notified = vi.fn();
		activity.subscribe(notified);
		const save = Mutation.make({ run: (n: number) => Effect.succeed(n) });

		// Started and settled in one synchronous run.
		const exit = Effect.runSyncExit(
			Effect.provideService(
				Mutation.run(save, 1),
				QueryClient.QueryClient,
				client,
			) as Effect.Effect<number>,
		);

		expect(exit).toEqual(Exit.succeed(1));
		expect(notified).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(notified).toHaveBeenCalledTimes(1);
		expect(activity.mutating()).toBe(0);
	});

	it("gives one empty list for every mutation with no runs", async () => {
		const client = await makeClient();
		const activity = makeActivityHandle(client.registry);
		const save = Mutation.make({ run: (n: number) => Effect.succeed(n) });

		await client.runPromise(Mutation.run(save, 1));

		expect(activity.runs(save)).toBe(noRuns);
	});

	it("counts a run that replaces another once that one has rolled back", async () => {
		const client = await makeClient();
		const cleanup = gate();
		const save = Mutation.make({
			run: (n: number) =>
				n === 1
					? Effect.never.pipe(Effect.onInterrupt(() => cleanup.wait))
					: Effect.succeed(n),
			concurrent: false,
		});
		const handle = makeHandle(client.registry, save);
		const activity = makeActivityHandle(client.registry);

		const first = handle.run(1);
		await flush();
		const second = handle.run(2);
		const third = handle.run(3);
		await flush();

		expect(activity.runs(save).map((run) => run.variables)).toEqual([1]);
		cleanup.open();
		expect(await third).toEqual(Exit.succeed(3));
		expect(isInterrupted(await first)).toBe(true);
		expect(isInterrupted(await second)).toBe(true);
		expect(activity.mutating()).toBe(0);
	});

	it("lists every run of a mutation in progress, oldest first", async () => {
		const client = await makeClient();
		const slow = gate();
		const save = Mutation.make({
			run: (n: number) => Effect.as(slow.wait, n),
		});
		const other = Mutation.make({ run: () => slow.wait });
		const activity = makeActivityHandle(client.registry);
		const first = makeHandle(client.registry, save);
		const second = makeHandle(client.registry, save);

		const runs = [
			first.run(1),
			second.run(2),
			client.runPromise(Mutation.run(save, 3)),
			client.runPromise(Mutation.run(other)),
		];
		await flush();
		const list = activity.runs(save);

		expect(list.map((run) => run.variables)).toEqual([1, 2, 3]);
		expect(list.every((run) => run.result._tag === "Initial")).toBe(true);
		expect(list.every((run) => run.result.waiting)).toBe(true);
		expect(activity.mutating(save)).toBe(3);
		expect(activity.mutating()).toBe(4);
		slow.open();
		await Promise.all(runs);
		expect(activity.runs(save)).toEqual([]);
	});

	it("keeps a mutation's list while its runs stay the same", async () => {
		const client = await makeClient();
		const slow = gate();
		const save = Mutation.make({
			run: (n: number) => Effect.as(slow.wait, n),
		});
		const other = Mutation.make({ run: () => Effect.void });
		const activity = makeActivityHandle(client.registry);

		const run = client.runPromise(Mutation.run(save, 1));
		await flush();
		const before = activity.runs(save);
		await client.runPromise(Mutation.run(other));

		expect(activity.runs(save)).toBe(before);
		slow.open();
		await run;
	});

	it("drops a run that ends by interruption", async () => {
		const client = await makeClient();
		const save = Mutation.make({
			run: (n: number) => (n === 1 ? Effect.never : Effect.succeed(n)),
			concurrent: false,
		});
		const handle = makeHandle(client.registry, save);
		const activity = makeActivityHandle(client.registry);

		const first = handle.run(1);
		await flush();
		expect(activity.mutating(save)).toBe(1);
		await handle.run(2);

		expect(isInterrupted(await first)).toBe(true);
		expect(activity.mutating(save)).toBe(0);
	});

	it("counts a run started inside another run's callback apart", async () => {
		const client = await makeClient();
		const slow = gate();
		const activity = makeActivityHandle(client.registry);
		const inner = Mutation.make({ run: () => slow.wait });
		const outer = Mutation.make({
			run: () => Effect.void,
			onSuccess: () => Mutation.run(inner),
		});

		const run = client.runPromise(Mutation.run(outer));
		await flush();

		expect(activity.mutating()).toBe(2);
		slow.open();
		await run;
		expect(activity.mutating()).toBe(0);
	});

	it("is empty once the client is disposed", async () => {
		const client = await makeClient();
		const activity = makeActivityHandle(client.registry);
		const waiting = Mutation.make({ run: () => Effect.never });
		const query = Query.make({ key: ["slow"], run: Effect.never });

		void client.runPromiseExit(Mutation.run(waiting));
		void client.runPromiseExit(Query.fetch(query));
		await flush();
		expect([activity.mutating(), activity.fetching()]).toEqual([1, 1]);
		await dispose(client);

		expect([activity.mutating(), activity.fetching()]).toEqual([0, 0]);
	});
});
