import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Mutation, Query, QueryClient } from "../src/index.js";
import { type CacheEvent, subscribe } from "../src/internal/events.js";
import { StateAtom } from "../src/internal/runtime.js";
import { whenShowable } from "../src/internal/suspense.js";
import {
	disposeClients,
	gate,
	makeClient,
	manualSignals,
	record,
	show,
	use,
	useFakeTimers,
} from "./helpers.js";

afterEach(disposeClients);

/** Lets the registry's tasks and the stream's fibers run. */
const tick = async () => {
	for (let i = 0; i < 3; i++) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
};

/** Past the grace a live query's stream outlives its last reader by. */
const pastGrace = async () => {
	await vi.advanceTimersByTimeAsync(2_500);
	await tick();
};

/** A stream a test drives by hand, counting its subscriptions. */
const source = <A, E = never>() => {
	let starts = 0;
	let stops = 0;
	let queue: Queue.Queue<A, E | Cause.Done> | undefined;
	const stream = Stream.callback<A, E>((q) =>
		Effect.sync(() => {
			starts++;
			queue = q;
		}).pipe(
			Effect.andThen(Effect.addFinalizer(() => Effect.sync(() => stops++))),
		),
	);
	return {
		stream,
		emit: (value: A) => Queue.offerUnsafe(queue!, value),
		fail: (error: E) => Queue.failCauseUnsafe(queue!, Cause.fail(error)),
		end: () => Queue.endUnsafe(queue!),
		counts: () => ({ starts, stops }),
	};
};

describe("Query.stream", () => {
	it("shows each element, from one stream for every reader", async () => {
		const client = await makeClient();
		const { registry } = client;
		const ticks = source<number>();
		const price = Query.stream({ key: ["price"], run: ticks.stream });
		// React reads as it renders and subscribes on a later task.
		expect(show(registry.get(price))).toBe("Initial(waiting)");
		await tick();
		const seen = record(registry, price);
		const other = registry.mount(price);
		ticks.emit(1);
		ticks.emit(2);
		await tick();
		expect(seen).toEqual(["Initial(waiting)", "Success 1", "Success 2"]);
		expect(ticks.counts()).toEqual({ starts: 1, stops: 0 });
		other();
	});

	it("stops after its last reader leaves, keeps the value, and starts again", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { registry } = client;
		const ticks = source<number>();
		const price = Query.stream({ key: ["price"], run: ticks.stream });
		const unmount = registry.mount(price);
		await tick();
		ticks.emit(1);
		await tick();
		unmount();
		// A reader that comes back at once keeps the stream.
		const again = registry.mount(price);
		await tick();
		again();
		await tick();
		expect(ticks.counts()).toEqual({ starts: 1, stops: 0 });
		await pastGrace();
		expect(ticks.counts()).toEqual({ starts: 1, stops: 1 });
		expect(await client.runPromise(Query.get(price))).toEqual(Option.some(1));
		const seen = record(registry, price);
		await tick();
		ticks.emit(2);
		await tick();
		expect(seen).toEqual(["Success(waiting) 1", "Success 2"]);
		expect(ticks.counts()).toEqual({ starts: 2, stops: 1 });
	});

	it("isn't refetched on mount, focus or reconnect", async () => {
		const { focus, online, signals } = manualSignals();
		const client = await makeClient({ signals });
		const { registry } = client;
		const ticks = source<number>();
		const price = Query.stream({ key: ["price"], run: ticks.stream });
		const first = use(registry, price);
		await tick();
		ticks.emit(1);
		await tick();
		const second = use(registry, price);
		registry.set(focus, 1);
		registry.set(online, false);
		registry.set(online, true);
		await tick();
		expect(ticks.counts()).toEqual({ starts: 1, stops: 0 });
		first();
		second();
	});

	it("fetch returns the first element, or the latest while it runs", async () => {
		useFakeTimers();
		const client = await makeClient();
		const ticks = source<number>();
		const price = Query.stream({ key: ["price"], run: ticks.stream });
		const fetched = client.runPromise(Query.fetch(price));
		await tick();
		ticks.emit(7);
		expect(await fetched).toBe(7);
		const unmount = client.registry.mount(price);
		ticks.emit(8);
		await tick();
		expect(await client.runPromise(Query.fetch(price))).toBe(8);
		unmount();
		await pastGrace();
		expect(ticks.counts()).toEqual({ starts: 1, stops: 1 });
	});

	it("prefetch runs it to its first element, then lets it stop", async () => {
		useFakeTimers();
		const client = await makeClient();
		const ticks = source<number>();
		const price = Query.stream({ key: ["price"], run: ticks.stream });
		const prefetched = client.runPromise(Query.prefetch(price));
		await tick();
		ticks.emit(1);
		await prefetched;
		await pastGrace();
		expect(ticks.counts()).toEqual({ starts: 1, stops: 1 });
		expect(await client.runPromise(Query.get(price))).toEqual(Option.some(1));
	});

	it("resubscribes on retry, and shows the failure once it's done", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { registry } = client;
		const ticks = source<number, string>();
		const price = Query.stream({
			key: ["price"],
			run: ticks.stream,
			retry: Schedule.spaced("1 second").pipe(Schedule.upTo({ times: 1 })),
		});
		const unmount = registry.mount(price);
		await tick();
		ticks.emit(1);
		await tick();
		ticks.fail("dropped");
		await tick();
		expect(show(registry.get(price))).toBe("Success 1");
		await vi.advanceTimersByTimeAsync(1_000);
		await tick();
		expect(ticks.counts().starts).toBe(2);
		// An element starts the schedule over.
		ticks.emit(2);
		await tick();
		ticks.fail("dropped");
		await vi.advanceTimersByTimeAsync(1_000);
		await tick();
		expect(ticks.counts().starts).toBe(3);
		ticks.fail("dropped");
		await tick();
		const result = registry.get(price);
		expect(AsyncResult.isFailure(result) && !result.waiting).toBe(true);
		expect(Option.map(AsyncResult.value(result), (v) => v)).toEqual(
			Option.some(2),
		);
		// A new reader of a failed stream subscribes again.
		const second = use(registry, price);
		await tick();
		expect(ticks.counts().starts).toBe(4);
		expect(show(registry.get(price))).toBe("Failure(waiting) 2");
		unmount();
		second();
	});

	it("shows a failure over a value written on it", async () => {
		const client = await makeClient();
		const { registry } = client;
		const ticks = source<number, string>();
		const price = Query.stream({ key: ["price"], run: ticks.stream });
		const unmount = registry.mount(price);
		await tick();
		ticks.emit(1);
		await tick();
		await client.runPromise(Query.set(price, 5));
		expect(show(registry.get(price))).toBe("Success 5");

		ticks.fail("dropped");
		await tick();

		expect(AsyncResult.isFailure(registry.get(price))).toBe(true);
		unmount();
	});

	it("keeps the last element when it ends, and fails when it ends with none", async () => {
		const client = await makeClient();
		const ended = Query.stream({ key: ["ended"], run: Stream.make(1, 2) });
		expect(await client.runPromise(Query.fetch(ended))).toBe(1);
		await tick();
		expect(show(client.registry.get(ended))).toBe("Success 2");
		const empty = Query.stream({ key: ["empty"], run: Stream.empty });
		const exit = await client.runPromiseExit(Query.fetch(empty));
		expect(
			Exit.isFailure(exit) &&
				Cause.hasDies(exit.cause) &&
				Cause.isNoSuchElementError(Cause.squash(exit.cause)),
		).toBe(true);
	});

	it("refetch and invalidate subscribe again; reset drops the value", async () => {
		const client = await makeClient();
		const { registry } = client;
		const ticks = source<number>();
		const price = Query.stream({ key: ["price"], run: ticks.stream });
		const unmount = registry.mount(price);
		await tick();
		ticks.emit(1);
		await tick();
		// It settles with the new subscription's first element.
		const refetched = client.runPromise(Query.refetch(price));
		await tick();
		expect(ticks.counts()).toEqual({ starts: 2, stops: 1 });
		expect(show(registry.get(price))).toBe("Success(waiting) 1");
		ticks.emit(2);
		await refetched;
		expect(show(registry.get(price))).toBe("Success 2");
		const invalidated = client.runPromise(Query.invalidate(["price"]));
		await tick();
		expect(ticks.counts()).toEqual({ starts: 3, stops: 2 });
		ticks.emit(3);
		await invalidated;
		await client.runPromise(Query.reset(price));
		await tick();
		expect(ticks.counts()).toEqual({ starts: 4, stops: 3 });
		expect(show(registry.get(price))).toBe("Initial(waiting)");
		unmount();
	});

	it("clear stops it until the query is asked for", async () => {
		const client = await makeClient();
		const { registry } = client;
		const ticks = source<number>();
		const price = Query.stream({ key: ["price"], run: ticks.stream });
		const unmount = registry.mount(price);
		await tick();
		ticks.emit(1);
		await tick();
		await client.runPromise(Query.clear(price));
		await tick();
		expect(ticks.counts()).toEqual({ starts: 1, stops: 1 });
		expect(show(registry.get(price))).toBe("Initial");
		const fetched = client.runPromise(Query.fetch(price));
		await tick();
		ticks.emit(2);
		expect(await fetched).toBe(2);
		unmount();
	});

	it("is found by key while no one reads it", async () => {
		useFakeTimers();
		const client = await makeClient();
		const ticks = source<number>();
		const price = Query.stream({ key: ["price"], run: ticks.stream });
		const fetched = client.runPromise(Query.fetch(price));
		await tick();
		ticks.emit(1);
		await fetched;
		await pastGrace();
		const { index } = client.registry.get(StateAtom);
		expect(index.has(price)).toBe(true);
		await client.runPromise(Query.clear(["price"]));
		expect(await client.runPromise(Query.get(price))).toEqual(Option.none());
	});

	it("shows a written value until the next element", async () => {
		const client = await makeClient();
		const { registry } = client;
		const ticks = source<number>();
		const price = Query.stream({ key: ["price"], run: ticks.stream });
		const unmount = registry.mount(price);
		await tick();
		ticks.emit(1);
		await tick();
		await client.runPromise(Query.set(price, 5));
		expect(show(registry.get(price))).toBe("Success 5");
		ticks.emit(2);
		await tick();
		expect(show(registry.get(price))).toBe("Success 2");
		unmount();
	});

	it("suspends to the first element, showing a placeholder meanwhile", async () => {
		const client = await makeClient();
		const { registry } = client;
		const ticks = source<number>();
		const price = Query.stream({
			key: ["price"],
			run: ticks.stream,
			placeholder: Effect.succeed(Option.some(0)),
		});
		expect(show(registry.get(price))).toBe("Success(waiting) 0");
		let ready = false;
		void whenShowable(registry, price).then(() => {
			ready = true;
		});
		await tick();
		expect(ready).toBe(false);
		ticks.emit(1);
		await tick();
		expect(ready).toBe(true);
		expect(show(registry.get(price))).toBe("Success 1");
	});

	it("sends its latest value to the browser, which subscribes again", async () => {
		const Price = Schema.Finite;
		const server = await makeClient();
		const serverTicks = source<number>();
		const onServer = Query.stream({
			key: ["price"],
			run: serverTicks.stream,
			schema: { success: Price },
		});
		const prefetched = server.runPromise(Query.prefetch(onServer));
		await tick();
		serverTicks.emit(3);
		await prefetched;
		const state = JSON.parse(JSON.stringify(QueryClient.dehydrate(server)));
		const browser = await makeClient();
		const browserTicks = source<number>();
		const onBrowser = Query.stream({
			key: ["price"],
			run: browserTicks.stream,
			schema: { success: Price },
		});
		QueryClient.hydrate(browser, state);
		const seen = record(browser.registry, onBrowser);
		await tick();
		browserTicks.emit(4);
		await tick();
		expect(seen).toEqual(["Success(waiting) 3", "Success 4"]);
	});

	it("reports one fetch per subscription, settled by its first element", async () => {
		const client = await makeClient();
		const events: Array<CacheEvent["_tag"]> = [];
		subscribe(client.registry.get(StateAtom), (event) =>
			events.push(event._tag),
		);
		const ticks = source<number>();
		const price = Query.stream({ key: ["price"], run: ticks.stream });
		const unmount = client.registry.mount(price);
		await tick();
		ticks.emit(1);
		ticks.emit(2);
		await tick();
		expect(
			events.filter(
				(tag) => tag === "FetchStarted" || tag === "FetchSettled",
			),
		).toEqual(["FetchStarted", "FetchSettled"]);
		unmount();
	});

	it("leaves no timer or fiber after dispose", async () => {
		useFakeTimers();
		const client = await makeClient();
		const ticks = source<number>();
		const price = Query.stream({ key: ["price"], run: ticks.stream });
		client.registry.mount(price);
		await tick();
		ticks.emit(1);
		await tick();
		const { fibers } = client.registry.get(StateAtom);
		await client.dispose();
		expect(ticks.counts()).toEqual({ starts: 1, stops: 1 });
		expect(fibers.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("streamFamily makes one stream per argument", async () => {
		const client = await makeClient();
		const prices = Query.streamFamily({
			key: ["price"],
			run: (symbol: string) => Stream.make(`${symbol}:1`),
		});
		expect(prices("ACME").key).toEqual(["price", "ACME"]);
		expect(await client.runPromise(Query.fetch(prices("ACME")))).toBe(
			"ACME:1",
		);
		expect(await client.runPromise(Query.fetch(prices("INIT")))).toBe(
			"INIT:1",
		);
	});
});

interface Todo {
	readonly id: number;
	readonly title: string;
}

type Update = (list: ReadonlyArray<Todo>) => ReadonlyArray<Todo>;

const upsert =
	(todo: Todo): Update =>
	(list) =>
		list.some((item) => item.id === todo.id)
			? list.map((item) => (item.id === todo.id ? todo : item))
			: [...list, todo];

describe("live", () => {
	const todos = (run: Effect.Effect<ReadonlyArray<Todo>>) => {
		const pushes = source<Update, string>();
		const query = Query.make({
			key: ["todos"],
			run,
			live: pushes.stream,
			staleTime: "1 minute",
		});
		return { query, pushes };
	};

	const titles = (
		result: AsyncResult.AsyncResult<ReadonlyArray<Todo>, unknown>,
	) =>
		Option.map(AsyncResult.value(result), (list) =>
			list.map((todo) => todo.title),
		);

	it("applies pushes to the fetched value, keeping its age", async () => {
		const client = await makeClient();
		const { registry } = client;
		const { query, pushes } = todos(Effect.succeed([{ id: 1, title: "a" }]));
		const unmount = registry.mount(query);
		await tick();
		const fetched = registry.get(query) as AsyncResult.Success<
			ReadonlyArray<Todo>,
			never
		>;
		pushes.emit(upsert({ id: 2, title: "b" }));
		await tick();
		const pushed = registry.get(query);
		expect(titles(pushed)).toEqual(Option.some(["a", "b"]));
		expect(AsyncResult.isSuccess(pushed) && pushed.timestamp).toBe(
			fetched.timestamp,
		);
		unmount();
	});

	it("applies pushes that come during a fetch to its result", async () => {
		const client = await makeClient();
		const { registry } = client;
		const fetch = gate();
		const { query, pushes } = todos(
			Effect.as(fetch.wait, [{ id: 1, title: "a" }]),
		);
		const unmount = registry.mount(query);
		await tick();
		pushes.emit(upsert({ id: 2, title: "b" }));
		await tick();
		fetch.open();
		await tick();
		expect(titles(registry.get(query))).toEqual(Option.some(["a", "b"]));
		// Nothing is kept once no fetch or undo needs it.
		expect(registry.get(StateAtom).pushes.get(query)?.entries.length).toBe(0);
		unmount();
	});

	it("applies pushes again after an optimistic write is undone", async () => {
		const client = await makeClient();
		const { registry } = client;
		const { query, pushes } = todos(Effect.succeed([{ id: 1, title: "a" }]));
		const unmount = registry.mount(query);
		await tick();
		const save = gate();
		const rename = Mutation.make({
			run: () => Effect.andThen(save.wait, Effect.fail("rejected")),
			optimistic: () =>
				Query.update(query, upsert({ id: 1, title: "renamed" })),
		});
		const run = client.runPromiseExit(Mutation.run(rename, undefined));
		await tick();
		expect(titles(registry.get(query))).toEqual(Option.some(["renamed"]));
		pushes.emit(upsert({ id: 2, title: "b" }));
		await tick();
		expect(titles(registry.get(query))).toEqual(
			Option.some(["renamed", "b"]),
		);
		save.open();
		await run;
		expect(titles(registry.get(query))).toEqual(Option.some(["a", "b"]));
		unmount();
	});

	it("logs a failed push stream, and keeps the value", async () => {
		const client = await makeClient();
		const { registry } = client;
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const logs = vi.spyOn(console, "log").mockImplementation(() => {});
		const { query, pushes } = todos(Effect.succeed([{ id: 1, title: "a" }]));
		const unmount = registry.mount(query);
		await tick();
		pushes.fail("socket closed");
		await tick();
		expect(titles(registry.get(query))).toEqual(Option.some(["a"]));
		expect(show(registry.get(query))).toBe('Success [{"id":1,"title":"a"}]');
		const output = [...logged.mock.calls, ...logs.mock.calls]
			.flat()
			.map(String)
			.join("\n");
		expect(output).toContain("A query's live stream failed");
		unmount();
	});

	it("runs only while read; writes don't start it", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { registry } = client;
		const { query, pushes } = todos(Effect.succeed([]));
		await client.runPromise(Query.set(query, [{ id: 1, title: "a" }]));
		await tick();
		expect(pushes.counts().starts).toBe(0);
		const unmount = registry.mount(query);
		await tick();
		expect(pushes.counts()).toEqual({ starts: 1, stops: 0 });
		unmount();
		await pastGrace();
		expect(pushes.counts()).toEqual({ starts: 1, stops: 1 });
		expect(titles(registry.get(query))).toEqual(Option.some(["a"]));
	});

	it("family members get their own pushes", async () => {
		const client = await makeClient();
		const { registry } = client;
		const updates = source<(title: string) => string>();
		const todo = Query.family({
			key: ["todo"],
			run: (id: number) => Effect.succeed(`todo ${id}`),
			live: (id) =>
				Stream.map(
					updates.stream,
					(f) => (title: string) => (id === 1 ? f(title) : title),
				),
		});
		const unmount = registry.mount(todo(1));
		await tick();
		updates.emit((title) => `${title}!`);
		await tick();
		expect(show(registry.get(todo(1)))).toBe('Success "todo 1!"');
		unmount();
	});
});

describe("live queries, from the review", () => {
	const listOf = (titles: ReadonlyArray<string>): ReadonlyArray<Todo> =>
		titles.map((title, i) => ({ id: i + 1, title }));
	const titlesOf = (
		result: AsyncResult.AsyncResult<ReadonlyArray<Todo>, unknown>,
	) =>
		Option.map(AsyncResult.value(result), (list) =>
			list.map((todo) => todo.title),
		);

	it("keeps one updates stream from a read, through a fetch, to a subscribe", async () => {
		const client = await makeClient();
		const { registry } = client;
		const fetch = gate();
		const pushes = source<Update>();
		const query = Query.make({
			key: ["todos"],
			run: Effect.as(fetch.wait, listOf(["a"])),
			live: pushes.stream,
		});
		registry.get(query);
		await tick();
		fetch.open();
		await tick();
		pushes.emit(upsert({ id: 2, title: "b" }));
		await tick();
		const unmount = registry.mount(query);
		await tick();
		expect(pushes.counts()).toEqual({ starts: 1, stops: 0 });
		expect(titlesOf(registry.get(query))).toEqual(Option.some(["a", "b"]));
		unmount();
	});

	it("clear and reset drop a value set on a live query no one reads", async () => {
		const client = await makeClient();
		for (const drop of [Query.clear, Query.reset]) {
			const pushes = source<Update>();
			const query = Query.make({
				key: ["todos"],
				run: Effect.succeed(listOf(["fetched"])),
				live: pushes.stream,
			});
			await client.runPromise(Query.set(query, listOf(["set"])));
			await client.runPromise(drop(query));
			expect(await client.runPromise(Query.get(query))).toEqual(
				Option.none(),
			);
			expect(pushes.counts().starts).toBe(0);
		}
	});

	it("clear interrupts a fetch of a live query no one reads, without fetching again", async () => {
		const client = await makeClient();
		const pushes = source<Update>();
		const respond = gate();
		let runs = 0;
		const query = Query.make({
			key: ["todos"],
			run: Effect.suspend(() => {
				runs++;
				return Effect.as(respond.wait, listOf([`run ${runs}`]));
			}),
			live: pushes.stream,
		});
		const fetch = client.runPromiseExit(Query.fetch(query));
		await tick();

		await client.clear(query);
		respond.open();

		expect(Exit.hasInterrupts(await fetch)).toBe(true);
		await tick();
		expect(runs).toBe(1);
	});

	it("doesn't apply pushes from before a clear to what's fetched after it", async () => {
		const client = await makeClient();
		const { registry } = client;
		let account = "a";
		const pushes = source<Update>();
		const query = Query.make({
			key: ["todos"],
			run: Effect.sync(() => listOf([account])),
			live: pushes.stream,
		});
		const unmount = registry.mount(query);
		await tick();
		const save = gate();
		const rename = Mutation.make({
			run: () => Effect.andThen(save.wait, Effect.fail("rejected")),
			optimistic: () =>
				Query.update(query, upsert({ id: 1, title: "renamed" })),
		});
		const run = client.runPromiseExit(Mutation.run(rename, undefined));
		await tick();
		pushes.emit(upsert({ id: 2, title: "pushed" }));
		await tick();
		await client.runPromise(Query.clear(query));
		account = "b";
		await client.runPromise(Query.fetch(query));
		save.open();
		await run;
		expect(titlesOf(registry.get(query))).toEqual(Option.some(["b"]));
		unmount();
	});

	it("lets go of what an update of a family holds when it throws", async () => {
		const client = await makeClient();
		const pushes = source<(title: string) => string>();
		const todo = Query.family({
			key: ["todo"],
			run: (id: number) => Effect.succeed(`todo ${id}`),
			live: () => pushes.stream,
		});
		for (const id of [1, 2, 3]) {
			await client.runPromise(Query.fetch(todo(id)));
		}
		const exit = await client.runPromiseExit(
			Query.update(todo, (title, id) => {
				if (id === 3) {
					throw new Error("bad");
				}
				return `${title}!`;
			}),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		const { pushes: logs } = client.registry.get(StateAtom);
		for (const id of [1, 2, 3]) {
			expect(logs.get(todo(id))?.marks.size ?? 0).toBe(0);
		}
	});

	it("skips an update that throws, and keeps the stream", async () => {
		const client = await makeClient();
		const { registry } = client;
		const logs = vi.spyOn(console, "log").mockImplementation(() => {});
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const pushes = source<Update>();
		const query = Query.make({
			key: ["todos"],
			run: Effect.succeed(listOf(["a"])),
			live: pushes.stream,
		});
		const unmount = registry.mount(query);
		await tick();
		pushes.emit(() => {
			throw new Error("bad update");
		});
		pushes.emit(upsert({ id: 2, title: "b" }));
		await tick();
		expect(titlesOf(registry.get(query))).toEqual(Option.some(["a", "b"]));
		expect(pushes.counts()).toEqual({ starts: 1, stops: 0 });
		const output = [...logged.mock.calls, ...logs.mock.calls]
			.flat()
			.map(String)
			.join("\n");
		expect(output).toContain("A query's live update threw, and was skipped");
		unmount();
	});

	it("keeps a failed stream failed for a new reader without retryOnMount", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { registry } = client;
		const ticks = source<number, string>();
		const price = Query.stream({
			key: ["price"],
			run: ticks.stream,
			retryOnMount: false,
		});
		const unmount = use(registry, price);
		await tick();
		ticks.fail("down");
		await tick();
		unmount();
		await pastGrace();
		const again = use(registry, price);
		await tick();
		expect(ticks.counts().starts).toBe(1);
		expect(show(registry.get(price))).toBe("Failure");
		// A refetch subscribes again.
		void client.runPromiseExit(Query.refetch(price));
		await tick();
		expect(ticks.counts().starts).toBe(2);
		again();
	});

	it("isn't restarted by more readers while it connects", async () => {
		const client = await makeClient();
		const { registry } = client;
		const ticks = source<number, string>();
		const price = Query.stream({ key: ["price"], run: ticks.stream });
		const first = use(registry, price);
		await tick();
		ticks.fail("down");
		await tick();
		const second = use(registry, price);
		await tick();
		expect(ticks.counts().starts).toBe(2);
		const third = use(registry, price);
		const fourth = use(registry, price);
		await tick();
		expect(ticks.counts().starts).toBe(2);
		first();
		second();
		third();
		fourth();
	});

	it("an undone write doesn't bring back a push a refetch replaced", async () => {
		const client = await makeClient();
		const { registry } = client;
		let server = ["a"];
		const pushes = source<Update>();
		const query = Query.make({
			key: ["todos"],
			run: Effect.sync(() => listOf(server)),
			live: pushes.stream,
		});
		const unmount = registry.mount(query);
		await tick();
		pushes.emit(upsert({ id: 2, title: "pushed" }));
		await tick();
		const save = gate();
		const rename = Mutation.make({
			run: () => Effect.andThen(save.wait, Effect.fail("rejected")),
			optimistic: () =>
				Query.update(query, upsert({ id: 1, title: "renamed" })),
		});
		const run = client.runPromiseExit(Mutation.run(rename, undefined));
		await tick();
		server = ["a", "b", "c"];
		await client.runPromise(Query.refetch(query));
		save.open();
		await run;
		expect(titlesOf(registry.get(query))).toEqual(
			Option.some(["a", "b", "c"]),
		);
		unmount();
	});

	it("a fetch of a live query doesn't start its pushes", async () => {
		const client = await makeClient();
		const pushes = source<Update>();
		const query = Query.make({
			key: ["todos"],
			run: Effect.succeed(listOf(["a"])),
			live: pushes.stream,
		});
		expect(await client.runPromise(Query.fetch(query))).toEqual(
			listOf(["a"]),
		);
		await tick();
		expect(pushes.counts().starts).toBe(0);
	});
});
