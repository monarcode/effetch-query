import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as Reactivity from "effect/reactivity/Reactivity";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Query, QueryClient } from "../src/index.js";
import { type CacheEvent, subscribe } from "../src/internal/events.js";
import { StateAtom } from "../src/internal/runtime.js";
import {
	disposeClients,
	isStale,
	makeClient,
	record,
	show,
	tracked,
	trackedFamily,
	useFakeTimers,
	valueOf,
} from "./helpers.js";
import { Greeting } from "./services.js";

afterEach(disposeClients);

describe("Query.make and Query.family", () => {
	it("returns the same query for structurally equal arguments", () => {
		const todos = Query.family({
			key: ["todos", "list"],
			run: (params: { readonly limit: number }) =>
				Effect.succeed(params.limit),
		});

		expect(todos({ limit: 20 })).toBe(todos({ limit: 20 }));
		expect(todos({ limit: 20 })).not.toBe(todos({ limit: 50 }));
		expect(todos({ limit: 20 }).key).toEqual([
			"todos",
			"list",
			{ limit: 20 },
		]);
		expect(todos.key).toEqual(["todos", "list"]);
	});

	it("fetches when first used, with the client's services", async () => {
		const client = await makeClient();
		const greeting = Query.make({
			key: ["greeting"],
			run: Greeting.useSync(({ text }) => `${text}, world`),
		});

		expect(await valueOf(client.registry, greeting)).toBe("hello, world");
	});

	it("isQuery tells queries from other atoms", () => {
		const { query } = tracked(["q"], () => Effect.succeed(1));

		expect(Query.isQuery(query)).toBe(true);
		expect(Query.isQuery(Atom.make(0))).toBe(false);
		expect(Query.isQuery({ [Query.QueryTypeId]: Query.QueryTypeId })).toBe(
			false,
		);
	});
});

describe("writing to the cache", () => {
	it("shows a written value while the next fetch runs, never the old one (G1, P2)", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { query } = tracked(["todo"], (fetch) =>
			Effect.succeed({ fetch }).pipe(Effect.delay("30 millis")),
		);
		const seen = record(client.registry, query);
		await vi.advanceTimersByTimeAsync(30);

		const afterFetch = seen.length;
		await client.runPromise(Query.set(query, { fetch: 0 }));
		await client.runPromise(Query.invalidate(query));
		await vi.advanceTimersByTimeAsync(30);

		expect(seen.slice(afterFetch)).toEqual([
			'Success {"fetch":0}',
			'Success(waiting) {"fetch":0}',
			'Success {"fetch":2}',
		]);
	});

	it("caches a value set on a query that isn't cached, without fetching", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(["preloaded"], () =>
			Effect.succeed("fetched"),
		);

		await client.runPromise(Query.set(query, "preloaded"));
		client.registry.mount(query);

		expect(show(client.registry.get(query))).toBe('Success "preloaded"');
		expect(fetches.count).toBe(0);

		await client.runPromise(Query.invalidate(query));
		expect(await valueOf(client.registry, query)).toBe("fetched");
		expect(fetches.count).toBe(1);
	});

	it("a plain atom write on a query that isn't cached still fetches on first read", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(["raw"], () =>
			Effect.succeed("fetched"),
		);

		client.registry.set(query, "written");

		expect(await valueOf(client.registry, query)).toBe("fetched");
		expect(fetches.count).toBe(1);
	});

	it("keeps a written value as the last success when the next fetch fails (G1)", async () => {
		const client = await makeClient();
		const { query } = tracked(["flaky"], (fetch) =>
			fetch === 1 ? Effect.succeed("server") : Effect.fail("boom"),
		);
		client.registry.mount(query);
		await valueOf(client.registry, query);

		await client.runPromise(Query.set(query, "written"));
		await client.runPromise(Query.refetch(query));

		expect(show(client.registry.get(query))).toBe('Failure "written"');
		expect(await client.runPromise(Query.get(query))).toEqual(
			Option.some("written"),
		);
	});

	it("a written value is replaced by the next successful fetch, then stays replaced", async () => {
		const client = await makeClient();
		const { query } = tracked(["replaced"], (fetch) =>
			fetch === 3 ? Effect.fail("boom") : Effect.succeed(`server ${fetch}`),
		);
		client.registry.mount(query);
		await valueOf(client.registry, query);

		await client.runPromise(Query.set(query, "written"));
		await client.runPromise(Query.refetch(query));
		expect(show(client.registry.get(query))).toBe('Success "server 2"');

		await client.runPromise(Query.refetch(query));
		expect(show(client.registry.get(query))).toBe('Failure "server 2"');
	});

	it("get never fetches, and keeps the last value after a failure", async () => {
		const client = await makeClient();
		const { query } = tracked(["flaky"], (fetch) =>
			fetch === 1 ? Effect.succeed(1) : Effect.fail("boom"),
		);

		expect(await client.runPromise(Query.get(query))).toEqual(Option.none());
		expect(client.registry.getNodes().has(query)).toBe(false);

		client.registry.mount(query);
		await valueOf(client.registry, query);
		await client.runPromise(Query.refetch(query));

		expect(AsyncResult.isFailure(client.registry.get(query))).toBe(true);
		expect(await client.runPromise(Query.get(query))).toEqual(Option.some(1));
	});

	it("get sees a fetch that settled while nothing used the query", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { query } = tracked(["background"], () =>
			Effect.succeed("server").pipe(Effect.delay("100 millis")),
		);
		const unmount = client.registry.mount(query);
		await vi.advanceTimersByTimeAsync(10);
		unmount();
		await vi.advanceTimersByTimeAsync(100);

		expect(await client.runPromise(Query.get(query))).toEqual(
			Option.some("server"),
		);
	});

	it("update applies a function to the value, and does nothing without one", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(["list"], () => Effect.succeed(["a"]));

		await client.runPromise(Query.update(query, (list) => [...list, "b"]));
		expect(await client.runPromise(Query.get(query))).toEqual(Option.none());

		client.registry.mount(query);
		await valueOf(client.registry, query);
		await client.runPromise(Query.update(query, (list) => [...list, "b"]));

		expect(await client.runPromise(Query.get(query))).toEqual(
			Option.some(["a", "b"]),
		);
		expect(fetches.count).toBe(1);
	});

	it("a write makes a query invalidated while idle fresh again, and later invalidations still refetch", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(["c"], (fetch) =>
			Effect.succeed(fetch),
		);
		const unmount = client.registry.mount(query);
		await valueOf(client.registry, query);
		unmount();
		await client.runPromise(Query.invalidate(query));
		await client.runPromise(Query.set(query, 100));

		const seen = record(client.registry, query);
		expect(seen).toEqual(["Success 100"]);
		expect(fetches.count).toBe(1);

		await client.runPromise(Query.invalidate(["c"]));
		await valueOf(client.registry, query);
		await client.runPromise(Query.refetch(["c"]));

		expect(fetches.count).toBe(3);
		expect(seen.at(-1)).toBe("Success 3");
	});
});

describe("invalidation", () => {
	const setup = async () => {
		const client = await makeClient();
		const list = trackedFamily<{ readonly limit: number }>(["todos", "list"]);
		const detail = trackedFamily<number>(["todos", "detail"]);
		const user = trackedFamily<number>(["users", "detail"]);
		const queries = [
			list.family({ limit: 20 }),
			detail.family(1),
			detail.family(2),
			user.family(1),
		];
		for (const query of queries) {
			client.registry.mount(query);
			await valueOf(client.registry, query);
		}
		const fetches = () => [
			list.fetches({ limit: 20 }),
			detail.fetches(1),
			detail.fetches(2),
			user.fetches(1),
		];
		return { client, detail: detail.family, fetches };
	};

	it("refetches only the queries a key, a prefix or a family matches (G3, P3)", async () => {
		const { client, detail, fetches } = await setup();

		await client.runPromise(Query.invalidate(["todos", "detail", 1]));
		expect(fetches()).toEqual([1, 2, 1, 1]);

		await client.runPromise(Query.invalidate(detail));
		expect(fetches()).toEqual([1, 3, 2, 1]);

		await client.runPromise(Query.invalidate(["todos"]));
		expect(fetches()).toEqual([2, 4, 3, 1]);
	});

	it("a query target matches its own key only, not longer keys", async () => {
		const client = await makeClient();
		const root = tracked(["todos"], () => Effect.succeed("root"));
		const child = tracked(["todos", "list"], () => Effect.succeed("child"));
		client.registry.mount(root.query);
		client.registry.mount(child.query);
		await valueOf(client.registry, root.query);
		await valueOf(client.registry, child.query);

		await client.runPromise(Query.invalidate(root.query));

		expect([root.fetches.count, child.fetches.count]).toEqual([2, 1]);
	});

	it("refetches an idle query on its next use, not before (P4)", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(["idle"], () => Effect.succeed(1));
		const unmount = client.registry.mount(query);
		await valueOf(client.registry, query);
		unmount();

		await client.runPromise(Query.invalidate(query));
		expect(isStale(client.registry, query)).toBe(true);
		expect(fetches.count).toBe(1);

		await valueOf(client.registry, query);
		expect(fetches.count).toBe(2);
	});

	it("Reactivity.invalidate through the client reaches only matching reactivityKeys (G4)", async () => {
		const client = await makeClient();
		const todos = tracked(["todos"], (fetch) => Effect.succeed(fetch), {
			reactivityKeys: ["todos"],
		});
		const users = tracked(["users"], (fetch) => Effect.succeed(fetch), {
			reactivityKeys: ["users"],
		});
		client.registry.mount(todos.query);
		client.registry.mount(users.query);
		await valueOf(client.registry, todos.query);
		await valueOf(client.registry, users.query);

		await client.runPromise(Reactivity.invalidate(["todos"]));

		expect(await valueOf(client.registry, todos.query)).toBe(2);
		expect([todos.fetches.count, users.fetches.count]).toEqual([2, 1]);
	});

	it("an idle query with reactivityKeys refetches on its next use, not before (G4, P4)", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(
			["todos"],
			(fetch) => Effect.succeed(fetch),
			{ reactivityKeys: ["todos"] },
		);
		const unmount = client.registry.mount(query);
		await valueOf(client.registry, query);
		unmount();

		await client.runPromise(Query.invalidate(query));
		expect(fetches.count).toBe(1);
		expect(await valueOf(client.registry, query)).toBe(2);

		await client.runPromise(Reactivity.invalidate(["todos"]));
		expect(isStale(client.registry, query)).toBe(true);
		expect(fetches.count).toBe(2);
		expect(await valueOf(client.registry, query)).toBe(3);
	});
});

describe("Query.fetch and Query.prefetch", () => {
	it("joins a fetch in progress", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { fetches, query } = tracked(["slow"], (fetch) =>
			Effect.succeed(fetch).pipe(Effect.delay("1 second")),
		);
		client.registry.mount(query);

		const both = Promise.all([
			client.runPromise(Query.fetch(query)),
			client.runPromise(Query.fetch(query)),
		]);
		await vi.advanceTimersByTimeAsync(1000);

		expect(await both).toEqual([1, 1]);
		expect(fetches.count).toBe(1);
	});

	it("returns a fresh value from the cache and refetches a stale one", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { query } = tracked(["fresh"], (fetch) => Effect.succeed(fetch), {
			staleTime: "1 minute",
		});

		expect(await client.runPromise(Query.fetch(query))).toBe(1);
		expect(await client.runPromise(Query.fetch(query))).toBe(1);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(await client.runPromise(Query.fetch(query))).toBe(2);
	});

	it("uses the client's default staleTime, and refetches every time without one", async () => {
		const withDefault = await makeClient({
			queries: { defaults: { staleTime: "1 minute" } },
		});
		const withoutDefault = await makeClient();
		const first = tracked(["a"], () => Effect.succeed("a"));
		const second = tracked(["b"], () => Effect.succeed("b"));

		await withDefault.runPromise(Query.fetch(first.query));
		await withDefault.runPromise(Query.fetch(first.query));
		await withoutDefault.runPromise(Query.fetch(second.query));
		await withoutDefault.runPromise(Query.fetch(second.query));

		expect([first.fetches.count, second.fetches.count]).toEqual([1, 2]);
	});

	it("resolves after a query left mid-fetch is written to", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { query } = tracked(["left"], (fetch) =>
			Effect.succeed(`server ${fetch}`).pipe(Effect.delay("100 millis")),
		);
		const unmount = client.registry.mount(query);
		await vi.advanceTimersByTimeAsync(10);
		unmount();
		await vi.advanceTimersByTimeAsync(100);
		await client.runPromise(Query.set(query, "written"));

		const fetched = client.runPromise(Query.fetch(query));
		await vi.advanceTimersByTimeAsync(100);

		expect(await fetched).toBe("server 2");
	});

	it("fails with the query's error and dies on its defects", async () => {
		const client = await makeClient();
		const failing = Query.make({
			key: ["failing"],
			run: Effect.fail("boom"),
		});
		const dying = Query.make({ key: ["dying"], run: Effect.die("kaboom") });

		const failure = await client.runPromiseExit(Query.fetch(failing));
		const defect = await client.runPromiseExit(Query.fetch(dying));

		expect(failure).toEqual(Exit.fail("boom"));
		expect(Exit.isFailure(defect) && Cause.hasDies(defect.cause)).toBe(true);
		expect(await client.runPromiseExit(Query.prefetch(failing))).toEqual(
			Exit.void,
		);
	});
});

describe("Query.refetch", () => {
	it("refetches the queries in use and completes when they've settled (G8)", async () => {
		useFakeTimers();
		const client = await makeClient();
		const used = tracked(["items", "used"], (fetch) =>
			Effect.succeed(fetch).pipe(Effect.delay("1 second")),
		);
		const unused = tracked(["items", "unused"], (fetch) =>
			Effect.succeed(fetch),
		);
		client.registry.mount(used.query);
		client.registry.get(unused.query);
		await vi.advanceTimersByTimeAsync(1000);

		let done = false;
		const refetching = client
			.runPromise(Query.refetch(["items"]))
			.then(() => {
				done = true;
			});
		await vi.advanceTimersByTimeAsync(500);
		expect(done).toBe(false);
		expect(client.registry.get(used.query).waiting).toBe(true);

		await vi.advanceTimersByTimeAsync(500);
		await refetching;
		expect(show(client.registry.get(used.query))).toBe("Success 2");
		expect([used.fetches.count, unused.fetches.count]).toEqual([2, 1]);
	});

	it("doesn't count a dependent that is only cached as a use", async () => {
		const client = await makeClient();
		const me = tracked(["me"], (fetch) => Effect.succeed(fetch));
		const mine = Query.make({
			key: ["mine"],
			run: (ctx) => ctx.result(me.query),
		});
		const unmount = client.registry.mount(mine);
		await valueOf(client.registry, mine);
		unmount();

		await client.runPromise(Query.refetch(me.query));
		expect(me.fetches.count).toBe(1);

		await client.runPromise(Query.reset(me.query));
		expect(me.fetches.count).toBe(1);
		expect(await client.runPromise(Query.get(me.query))).toEqual(
			Option.none(),
		);
	});
});

describe("dependent queries and reset", () => {
	it("refetches a query when a query it reads changes", async () => {
		const client = await makeClient();
		const me = Query.make({ key: ["me"], run: Effect.succeed({ id: 1 }) });
		const fetches = { count: 0 };
		const mine = Query.make({
			key: ["todos", "mine"],
			run: (ctx) =>
				Effect.map(ctx.result(me), (user) => {
					fetches.count++;
					return `todos of ${user.id}`;
				}),
		});
		client.registry.mount(mine);
		expect(await valueOf(client.registry, mine)).toBe("todos of 1");

		await client.runPromise(Query.set(me, { id: 2 }));

		expect(await valueOf(client.registry, mine)).toBe("todos of 2");
		expect(fetches.count).toBe(2);
	});

	it("reset drops the value; a query in use fetches again", async () => {
		useFakeTimers();
		const client = await makeClient();
		const { query } = tracked(["session", "me"], (fetch) =>
			Effect.succeed(fetch).pipe(Effect.delay("1 second")),
		);
		const seen = record(client.registry, query);
		await vi.advanceTimersByTimeAsync(1000);
		await client.runPromise(Query.set(query, 100));

		await client.runPromise(Query.reset(["session"]));
		expect(show(client.registry.get(query))).toBe("Initial(waiting)");
		await vi.advanceTimersByTimeAsync(1000);

		expect(seen).toEqual([
			"Initial(waiting)",
			"Success 1",
			"Success 100",
			"Initial(waiting)",
			"Success 2",
		]);
	});

	it("reset of a query not in use leaves it Initial until it's used", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(["idle", "reset"], () =>
			Effect.succeed("value"),
		);
		const unmount = client.registry.mount(query);
		await valueOf(client.registry, query);
		unmount();
		await client.runPromise(Query.invalidate(query));

		await client.runPromise(Query.reset(query));
		expect(await client.runPromise(Query.get(query))).toEqual(Option.none());
		expect(fetches.count).toBe(1);

		expect(await valueOf(client.registry, query)).toBe("value");
		expect(fetches.count).toBe(2);
	});

	it("a value set after a reset of an unused query is cached without fetching", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(["reset", "set"], () =>
			Effect.succeed("fetched"),
		);
		const unmount = client.registry.mount(query);
		await valueOf(client.registry, query);
		unmount();

		await client.runPromise(Query.reset(query));
		await client.runPromise(Query.set(query, "written"));
		client.registry.mount(query);

		expect(show(client.registry.get(query))).toBe('Success "written"');
		expect(fetches.count).toBe(1);
	});
});

describe("the cache event channel", () => {
	const listen = (client: QueryClient.QueryClient) => {
		const events: Array<CacheEvent> = [];
		subscribe(client.registry.get(StateAtom), (event) => events.push(event));
		return events;
	};

	it("reports a query added, fetched and removed, in order", async () => {
		useFakeTimers();
		const client = await makeClient();
		const events = listen(client);
		const query = Query.make({
			key: ["events"],
			run: Effect.succeed(1).pipe(Effect.delay("1 second")),
			gcTime: "1 second",
		});

		const unmount = client.registry.mount(query);
		await vi.advanceTimersByTimeAsync(1000);
		unmount();
		await vi.advanceTimersByTimeAsync(2000);

		expect(
			events.map((event) =>
				event._tag === "FetchSettled"
					? `${event._tag} ${Exit.isSuccess(event.exit)}`
					: event._tag,
			),
		).toEqual([
			"QueryAdded",
			"FetchStarted",
			"FetchSettled true",
			"QueryRemoved",
		]);
	});

	it("pairs each fetch's start and settle, including one replaced mid-fetch", async () => {
		useFakeTimers();
		const client = await makeClient();
		const events = listen(client);
		const { query } = tracked(["replaced"], (fetch) =>
			Effect.succeed(fetch).pipe(Effect.delay("100 millis")),
		);
		client.registry.mount(query);
		await vi.advanceTimersByTimeAsync(10);
		await client.runPromise(Query.invalidate(query));
		await vi.advanceTimersByTimeAsync(100);

		const settled = new Map<number, string>();
		for (const event of events) {
			if (event._tag === "FetchSettled") {
				settled.set(
					event.fetchId,
					Exit.isSuccess(event.exit)
						? `success ${String(event.exit.value)}`
						: Cause.hasInterruptsOnly(event.exit.cause)
							? "interrupted"
							: "failed",
				);
			}
		}
		const started = events.flatMap((event) =>
			event._tag === "FetchStarted" ? [event.fetchId] : [],
		);
		expect(started.map((fetchId) => settled.get(fetchId))).toEqual([
			"interrupted",
			"success 2",
		]);
	});

	it("reports a listener that throws without failing the fetch", async () => {
		const client = await makeClient();
		const reported: Array<unknown> = [];
		const queueMicrotask = globalThis.queueMicrotask;
		vi.spyOn(globalThis, "queueMicrotask").mockImplementation((task) =>
			queueMicrotask(() => {
				try {
					task();
				} catch (error) {
					reported.push(error);
				}
			}),
		);
		const unsubscribe = subscribe(client.registry.get(StateAtom), () => {
			throw new Error("listener");
		});
		const { query } = tracked(["listened"], () => Effect.succeed("value"));

		expect(await client.runPromise(Query.fetch(query))).toBe("value");
		unsubscribe();
		await Promise.resolve();
		expect(reported).toEqual([
			new Error("listener"),
			new Error("listener"),
			new Error("listener"),
		]);
	});
});

describe("disposing a client", () => {
	it("waits for interrupted fetches to finish their finalizers before releasing the layer", async () => {
		const log: Array<string> = [];
		const client = QueryClient.make({
			layer: Layer.effect(
				Greeting,
				Effect.acquireRelease(Effect.succeed({ text: "hello" }), () =>
					Effect.sync(() => log.push("layer released")),
				),
			),
		});
		let resolve!: () => void;
		const acquired = new Promise<void>((done) => {
			resolve = done;
		});
		const query = Query.make({
			key: ["forever"],
			run: Effect.acquireRelease(Effect.sync(resolve), () =>
				Effect.sleep("10 millis").pipe(
					Effect.andThen(Effect.sync(() => log.push("fetch released"))),
				),
			).pipe(Effect.andThen(Effect.never)),
		});
		client.registry.mount(query);
		await acquired;

		await client.dispose();
		log.push("disposed");

		expect(log).toEqual(["fetch released", "layer released", "disposed"]);
	});
});
