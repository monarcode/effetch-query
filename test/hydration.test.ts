import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as Hydration from "effect/reactivity/Hydration";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

import * as Fetch from "@monarcode/effetch";
import { afterEach, describe, expect, it, vi } from "vitest";

import { endpoints } from "../src/effetch/index.js";
import { InfiniteQuery, Query, QueryClient } from "../src/index.js";
import { dehydrate } from "../src/internal/dehydrate.js";
import { hashKey } from "../src/internal/hashKey.js";
import { internals, type QueryHydration } from "../src/internal/queryAtom.js";
import {
	dispose,
	disposeClients,
	gate,
	makeClient,
	use,
	useFakeTimers,
	valueOf,
} from "./helpers.js";
import { Greeting, servicesLayer, TestApi } from "./services.js";

afterEach(disposeClients);

const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });

class FinalizerFailed extends Data.TaggedError("FinalizerFailed")<{}> {}

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
	id: Schema.Finite,
}) {}

const hydrationOf = <A, E>(query: Query.Query<A, E>) => {
	const { hydration } = internals(query);
	expect(hydration).toBeDefined();
	return hydration as QueryHydration<A, E>;
};

describe("hashKey", () => {
	it("is the key as JSON with object keys sorted, after a prefix", () => {
		expect(hashKey(["todos", { b: 2, a: [1, { d: null, c: true }] }])).toBe(
			'effetch-query:["todos",{"a":[1,{"c":true,"d":null}],"b":2}]',
		);
		expect(hashKey(["todos", { b: 2, a: 1 }])).toBe(
			hashKey(["todos", { a: 1, b: 2 }]),
		);
	});

	it("drops undefined properties, as JSON.stringify does", () => {
		expect(hashKey(["todos", { page: 1, filter: undefined }])).toBe(
			hashKey(["todos", { page: 1 }]),
		);
	});

	it("tells kinds of queries with one key apart", () => {
		expect(hashKey(["todos"], "infinite")).toBe(
			'effetch-query/infinite:["todos"]',
		);
		expect(hashKey(["todos"], "infinite")).not.toBe(hashKey(["todos"]));
	});

	it.each([
		["a Date", new Date(0)],
		["undefined in an array", [undefined]],
		["NaN", Number.NaN],
		["Infinity", Number.POSITIVE_INFINITY],
		["a bigint", 1n],
		["a function", () => 1],
		["a class instance", new (class Filter {})()],
		["a symbol", Symbol("todos")],
	])("fails with NonJsonKeyError for %s", (_, segment) => {
		const key = ["todos", { segment }];
		try {
			hashKey(key);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(QueryClient.NonJsonKeyError);
			expect(error).toMatchObject({ _tag: "NonJsonKeyError", key });
			expect((error as QueryClient.NonJsonKeyError).message).toContain(
				"todos",
			);
		}
	});
});

describe("schema", () => {
	it("encodes a query's result to JSON and back, timestamp included", async () => {
		const client = await makeClient();
		const todos = Query.make({
			key: ["todos"],
			run: Effect.succeed([{ id: 1, title: "Buy milk" }]),
			schema: { success: Schema.Array(Todo) },
		});
		await valueOf(client.registry, todos);
		const result = client.registry.get(todos);
		const { codec, hash } = hydrationOf(todos);

		const json = JSON.parse(JSON.stringify(codec.encode(result)));

		expect(hash()).toBe('effetch-query:["todos"]');
		expect(codec.decode(json)).toEqual(result);
	});

	it("encodes a failure with the error schema", () => {
		const todo = Query.make({
			key: ["todo"],
			run: Effect.fail(new NotFound({ id: 1 })),
			schema: { success: Todo, error: NotFound },
		});
		const { codec } = hydrationOf(todo);
		const failure = AsyncResult.failure<typeof Todo.Type, NotFound>(
			Cause.fail(new NotFound({ id: 1 })),
		);

		const decoded = codec.decode(codec.encode(failure));

		expect(AsyncResult.isFailure(decoded)).toBe(true);
		expect(
			AsyncResult.isFailure(decoded) && Cause.findErrorOption(decoded.cause),
		).toEqual(Option.some(new NotFound({ id: 1 })));
	});

	it("can't encode a failure without an error schema", () => {
		const todo = Query.make({
			key: ["todo"],
			run: Effect.fail(new NotFound({ id: 1 })),
			schema: { success: Todo },
		});

		expect(() =>
			hydrationOf(todo).codec.encode(
				AsyncResult.failure(Cause.fail(new NotFound({ id: 1 }))),
			),
		).toThrow(Schema.SchemaError);
	});

	it("is left off queries without one", () => {
		const todos = Query.make({ key: ["todos"], run: Effect.succeed(1) });

		expect(internals(todos).hydration).toBeUndefined();
	});

	it("gives each family member its own hash and one shared codec", () => {
		const todo = Query.family({
			key: ["todo"],
			run: (id: number) => Effect.succeed({ id, title: "" }),
			schema: { success: Todo },
		});

		expect(hydrationOf(todo(1)).hash()).toBe('effetch-query:["todo",1]');
		expect(hydrationOf(todo(2)).hash()).toBe('effetch-query:["todo",2]');
		expect(hydrationOf(todo(1)).codec).toBe(hydrationOf(todo(2)).codec);
	});

	it("doesn't hash a key until it's needed", () => {
		const at = Query.family({
			key: ["at"],
			run: (date: Date) => Effect.succeed({ id: date.getTime(), title: "" }),
			schema: { success: Todo },
		});
		const query = at(new Date(0));

		expect(() => hydrationOf(query).hash()).toThrow(
			QueryClient.NonJsonKeyError,
		);
	});
});

describe("InfiniteQuery schema", () => {
	const Page = Schema.Struct({
		items: Schema.Array(Schema.Finite),
		skip: Schema.Finite,
	});

	it("encodes the pages and their params, under its own kind", async () => {
		const client = await makeClient();
		const numbers = InfiniteQuery.make({
			key: ["numbers"],
			initialPageParam: 0,
			run: (skip: number) =>
				Effect.succeed({ items: [skip, skip + 1], skip }),
			nextPageParam: (last) => last.skip + 2,
			schema: { page: Page },
		});
		await client.runPromise(InfiniteQuery.fetchNextPage(numbers));
		await client.runPromise(InfiniteQuery.fetchNextPage(numbers));
		const result = client.registry.get(numbers);
		const { codec, hash } = hydrationOf(numbers);

		const json = JSON.parse(JSON.stringify(codec.encode(result)));

		expect(hash()).toBe('effetch-query/infinite:["numbers"]');
		expect(codec.decode(json)).toEqual(result);
	});

	it("can't encode params that aren't JSON without their schema", () => {
		const after = InfiniteQuery.make({
			key: ["after"],
			initialPageParam: new Date(0),
			run: (date: Date) =>
				Effect.succeed({ items: [], skip: date.getTime() }),
			nextPageParam: () => undefined,
			schema: { page: Page },
		});
		const result = AsyncResult.success({
			pages: [{ items: [], skip: 0 }],
			pageParams: [new Date(0)],
		});

		expect(() => hydrationOf(after).codec.encode(result)).toThrow(
			Schema.SchemaError,
		);
	});
});

describe("effetch schema", () => {
	const Page = Schema.Struct({
		items: Schema.Array(Todo),
		skip: Schema.Finite,
	});
	const api = endpoints(TestApi);

	it("takes the endpoint's output, keyed apart by method", () => {
		const getTodo = api.query(
			Fetch.endpoint("GET /todos/:id", { output: Todo }),
		);
		const headTodo = api.query(
			Fetch.endpoint("HEAD /todos/:id", { output: Todo }),
		);
		const pages = api.infiniteQuery(
			Fetch.endpoint("GET /todos", { output: Page }),
			{
				pageParam: "skip",
				initialPageParam: 0,
				nextPageParam: () => undefined,
			},
		);

		expect(hydrationOf(getTodo({ params: { id: 1 } })).hash()).toBe(
			'effetch-query:["todos",1]',
		);
		expect(hydrationOf(headTodo({ params: { id: 1 } })).hash()).toBe(
			'effetch-query/HEAD:["todos",1]',
		);
		expect(hydrationOf(pages()).hash()).toBe(
			'effetch-query/infinite:["todos"]',
		);
		const todo = AsyncResult.success({ id: 1, title: "Buy milk" });
		const { codec } = hydrationOf(getTodo({ params: { id: 1 } }));
		expect(codec.decode(codec.encode(todo))).toEqual(todo);
	});

	it("has none for an endpoint without output", () => {
		const raw = api.query(Fetch.endpoint("GET /health"));

		expect(internals(raw()).hydration).toBeUndefined();
	});

	it("leaves out a value whose schema needs a service, and fetches it", async () => {
		const Greeted = Schema.String.pipe(
			Schema.decodeTo(Schema.String, {
				decode: SchemaGetter.transformEffect((name: string) =>
					Greeting.useSync(({ text }) => `${text}, ${name}`),
				),
				encode: SchemaGetter.transformEffect((text: string) =>
					Greeting.useSync(() => text),
				),
			}),
		);
		const greet = api.query(
			Fetch.endpoint("GET /greeting", { output: Greeted }),
		);
		const server = await makeClient({
			layer: servicesLayer("hello", () => Response.json("Ada")),
		});
		expect(await server.runPromise(Query.fetch(greet()))).toBe("hello, Ada");

		expect(QueryClient.dehydrate(server)).toEqual([]);

		const browser = await makeClient({
			layer: servicesLayer("hi", () => Response.json("Grace")),
		});
		const sent: Hydration.DehydratedAtomValue = {
			"~effect/reactivity/Hydration/DehydratedAtom": true,
			key: 'effetch-query:["greeting"]',
			value: {
				_tag: "Success",
				value: "Ada",
				waiting: false,
				timestamp: Date.now(),
			},
			dehydratedAt: Date.now(),
		};
		QueryClient.hydrate(browser, [sent]);
		expect(await browser.runPromise(Query.fetch(greet()))).toBe("hi, Grace");
	});
});

/** A todo list served by a counter: each fetch, on any client, is counted. */
const todoList = (options?: Partial<Query.MakeOptions<any, never>>) => {
	const state = {
		runs: 0,
		hold: undefined as Effect.Effect<void> | undefined,
	};
	const todos = Query.make({
		staleTime: "1 minute",
		...options,
		key: ["todos"],
		run: Effect.suspend(() => {
			state.runs += 1;
			const list = [{ id: state.runs, title: `Fetch ${state.runs}` }];
			return Effect.as(state.hold ?? Effect.void, list);
		}),
		schema: { success: Schema.Array(Todo) },
	});
	return { state, todos };
};

/** What crosses the wire: the state through JSON, as a page embeds it. */
const overTheWire = (state: QueryClient.DehydratedState) =>
	JSON.parse(JSON.stringify(state)) as QueryClient.DehydratedState;

describe("dehydrate and hydrate", () => {
	it("send a query to the browser, which shows it without fetching", async () => {
		const { state, todos } = todoList();
		const server = await makeClient();
		await server.runPromise(Query.prefetch(todos));
		const sent = overTheWire(QueryClient.dehydrate(server));
		await dispose(server);

		const browser = await makeClient();
		QueryClient.hydrate(browser, sent);
		const unmount = use(browser.registry, todos);

		expect(await valueOf(browser.registry, todos)).toEqual([
			{ id: 1, title: "Fetch 1" },
		]);
		expect(state.runs).toBe(1);
		unmount();
	});

	it("show a hydrated value to React's server snapshot, and keep it for a later read", async () => {
		const { state, todos } = todoList();
		const server = await makeClient();
		await server.runPromise(Query.prefetch(todos));
		const sent = overTheWire(QueryClient.dehydrate(server));
		await dispose(server);

		const browser = await makeClient();
		QueryClient.hydrate(browser, sent);
		const snapshot = Atom.getServerValue(todos, browser.registry);
		expect(Atom.getServerValue(todos, browser.registry)).toBe(snapshot);
		// React hydrates in slices, so the registry may sweep in between.
		await new Promise((resolve) => setTimeout(resolve, 10));
		const unmount = use(browser.registry, todos);

		expect(AsyncResult.value(snapshot)).toEqual(
			Option.some([{ id: 1, title: "Fetch 1" }]),
		);
		expect(await valueOf(browser.registry, todos)).toEqual([
			{ id: 1, title: "Fetch 1" },
		]);
		expect(state.runs).toBe(1);
		unmount();
	});

	it("keep the server's timestamp, so the query refetches once stale", async () => {
		useFakeTimers();
		const { state, todos } = todoList();
		const server = await makeClient();
		await server.runPromise(Query.prefetch(todos));
		const sent = overTheWire(QueryClient.dehydrate(server));
		const browser = await makeClient();
		QueryClient.hydrate(browser, sent);

		await vi.advanceTimersByTimeAsync(30_000);
		expect(await browser.runPromise(Query.fetch(todos))).toEqual([
			{ id: 1, title: "Fetch 1" },
		]);
		await vi.advanceTimersByTimeAsync(31_000);
		expect(await browser.runPromise(Query.fetch(todos))).toEqual([
			{ id: 2, title: "Fetch 2" },
		]);
		expect(state.runs).toBe(2);
	});

	it("refetch a value that went stale before its query was first read", async () => {
		useFakeTimers();
		const { todos } = todoList();
		const server = await makeClient();
		await server.runPromise(Query.prefetch(todos));
		const sent = overTheWire(QueryClient.dehydrate(server));
		const browser = await makeClient();
		QueryClient.hydrate(browser, sent);

		await vi.advanceTimersByTimeAsync(61_000);

		expect(await browser.runPromise(Query.fetch(todos))).toEqual([
			{ id: 2, title: "Fetch 2" },
		]);
	});

	it("put a newer value into a cached query, and keep a newer one it has", async () => {
		useFakeTimers();
		const { todos } = todoList({ staleTime: 0 });
		const browser = await makeClient();
		const server = await makeClient();
		await browser.runPromise(Query.prefetch(todos));
		await vi.advanceTimersByTimeAsync(1000);
		await server.runPromise(Query.prefetch(todos));
		const newer = QueryClient.dehydrate(server);

		QueryClient.hydrate(browser, newer);
		expect(await browser.runPromise(Query.get(todos))).toEqual(
			Option.some([{ id: 2, title: "Fetch 2" }]),
		);

		await vi.advanceTimersByTimeAsync(1000);
		await browser.runPromise(Query.refetch(todos));
		await browser.runPromise(Query.fetch(todos));
		QueryClient.hydrate(browser, newer);
		expect(await browser.runPromise(Query.get(todos))).not.toEqual(
			Option.some([{ id: 2, title: "Fetch 2" }]),
		);
	});

	it("keep a newer value a cached query shows behind a failure", async () => {
		useFakeTimers();
		const runs = { count: 0, fail: false };
		const todo = Query.make({
			key: ["todo"],
			run: Effect.suspend(() => {
				runs.count += 1;
				return runs.fail
					? Effect.fail(new NotFound({ id: 1 }))
					: Effect.succeed({ id: 1, title: `Fetch ${runs.count}` });
			}),
			schema: { success: Todo, error: NotFound },
			staleTime: "1 minute",
		});
		const server = await makeClient();
		await server.runPromise(Query.prefetch(todo));
		const sent = overTheWire(QueryClient.dehydrate(server));
		await vi.advanceTimersByTimeAsync(1_000);
		const browser = await makeClient();
		const unmount = use(browser.registry, todo);
		await browser.runPromise(Query.fetch(todo));
		runs.fail = true;
		await browser.runPromise(Query.refetch(todo));

		QueryClient.hydrate(browser, sent);

		const shown = browser.registry.get(todo);
		expect(AsyncResult.isFailure(shown)).toBe(true);
		expect(AsyncResult.value(shown)).toEqual(
			Option.some({ id: 1, title: "Fetch 2" }),
		);
		unmount();
	});

	it("send only queries with a schema, matched by `queries`", async () => {
		const server = await makeClient();
		const { todos } = todoList();
		const plain = Query.make({ key: ["plain"], run: Effect.succeed(1) });
		const other = Query.make({
			key: ["other"],
			run: Effect.succeed("x"),
			schema: { success: Schema.String },
		});
		await server.runPromise(
			Effect.all([
				Query.prefetch(todos),
				Query.prefetch(plain),
				Query.prefetch(other),
			]),
		);

		const keys = (state: QueryClient.DehydratedState) =>
			Hydration.toValues(state).map((entry) => entry.key);

		expect(keys(QueryClient.dehydrate(server)).sort()).toEqual([
			'effetch-query:["other"]',
			'effetch-query:["todos"]',
		]);
		expect(
			keys(QueryClient.dehydrate(server, { queries: ["todos"] })),
		).toEqual(['effetch-query:["todos"]']);
	});

	it("leave failures out unless asked, so the browser fetches them", async () => {
		const todo = Query.make({
			key: ["todo"],
			run: Effect.fail(new NotFound({ id: 1 })),
			schema: { success: Todo, error: NotFound },
		});
		const server = await makeClient();
		await server.runPromiseExit(Query.fetch(todo));

		expect(QueryClient.dehydrate(server)).toEqual([]);

		const sent = overTheWire(
			QueryClient.dehydrate(server, { failures: "include" }),
		);
		const browser = await makeClient();
		QueryClient.hydrate(browser, sent);
		const result = browser.registry.get(todo);
		expect(
			AsyncResult.isFailure(result) && Cause.findErrorOption(result.cause),
		).toEqual(Option.some(new NotFound({ id: 1 })));
	});

	it("fail for two cached queries with one key", async () => {
		const server = await makeClient();
		const first = todoList().todos;
		const second = todoList().todos;
		await server.runPromise(
			Effect.all([Query.prefetch(first), Query.prefetch(second)]),
		);

		expect(() => QueryClient.dehydrate(server)).toThrow(
			QueryClient.DuplicateQueryKeyError,
		);
	});

	it("send a query that replaced one an earlier batch sent", async () => {
		const server = await makeClient();
		const first = todoList({ gcTime: 0 }).todos;
		const second = todoList().todos;
		const sent = new Map<string, Query.Query<any, any>>();
		await server.runPromise(Query.prefetch(first));
		expect(dehydrate(server.registry, {}, sent)).toHaveLength(1);
		await vi.waitFor(() =>
			expect(server.registry.getNodes().has(first)).toBe(false),
		);
		await server.runPromise(Query.prefetch(second));

		const batch = Hydration.toValues(dehydrate(server.registry, {}, sent));

		expect(batch.map((entry) => entry.key)).toEqual([...sent.keys()]);
		expect([...sent.values()]).toEqual([second]);
	});

	it("fail for a key that isn't JSON, only when it's sent", async () => {
		const at = Query.family({
			key: ["at"],
			run: (date: Date) => Effect.succeed(date.getTime()),
			schema: { success: Schema.Finite },
		});
		const server = await makeClient();
		await server.runPromise(Query.prefetch(at(new Date(0))));

		expect(() => QueryClient.dehydrate(server)).toThrow(
			QueryClient.NonJsonKeyError,
		);
		expect(QueryClient.dehydrate(server, { queries: ["todos"] })).toEqual([]);
	});

	it("keep concurrent server requests apart", async () => {
		const greeting = Query.make({
			key: ["greeting"],
			run: Greeting.useSync(({ text }) => text),
			schema: { success: Schema.String },
			staleTime: "1 minute",
		});
		const [first, second] = await Promise.all(
			["hello", "bonjour"].map(async (text) => {
				const server = await makeClient({ layer: servicesLayer(text) });
				await server.runPromise(Query.prefetch(greeting));
				return overTheWire(QueryClient.dehydrate(server));
			}),
		);

		const read = async (state: QueryClient.DehydratedState) => {
			const browser = await makeClient();
			QueryClient.hydrate(browser, state);
			return browser.runPromise(Query.fetch(greeting));
		};
		expect(await read(first!)).toBe("hello");
		expect(await read(second!)).toBe("bonjour");
	});

	it("load other atoms' state from Effect's Hydration too", async () => {
		const count = Atom.serializable(Atom.make(0), {
			key: "count",
			schema: Schema.Finite,
		});
		const server = await makeClient();
		server.registry.set(count, 7);
		const browser = await makeClient();

		QueryClient.hydrate(browser, Hydration.dehydrate(server.registry));

		expect(browser.registry.get(count)).toBe(7);
	});
});

describe("streaming", () => {
	it("sends a query still loading as a promise the browser waits for", async () => {
		const { state, todos } = todoList();
		const server = await makeClient();
		const { wait, open } = gate();
		state.hold = wait;
		void server.runPromise(Query.prefetch(todos));
		const sent = QueryClient.dehydrate(server, { pending: "promise" });
		expect(Hydration.toValues(sent)[0]?.resultPromise).toBeInstanceOf(
			Promise,
		);

		const browser = await makeClient();
		QueryClient.hydrate(browser, sent);
		const unmount = use(browser.registry, todos);
		expect(browser.registry.get(todos)).toMatchObject({
			_tag: "Initial",
			waiting: true,
		});
		state.hold = undefined;
		open();

		expect(await valueOf(browser.registry, todos)).toEqual([
			{ id: 1, title: "Fetch 1" },
		]);
		expect(state.runs).toBe(1);
		unmount();
	});

	it("waits for a result handed over as a thenable whose then returns nothing", async () => {
		const { state, todos } = todoList();
		const server = await makeClient();
		const { wait, open } = gate();
		state.hold = wait;
		void server.runPromise(Query.prefetch(todos));
		const [entry] = Hydration.toValues(
			QueryClient.dehydrate(server, { pending: "promise" }),
		);
		expect(entry?.resultPromise).toBeInstanceOf(Promise);
		const sent = entry as Hydration.DehydratedAtomValue;
		// As React's RSC client hands a streamed promise to client components.
		const thenable = {
			// oxlint-disable-next-line unicorn/no-thenable -- a thenable is the point
			then: (resolve: (value: unknown) => void) => {
				void sent.resultPromise?.then(resolve);
			},
		} as unknown as Promise<unknown>;

		const browser = await makeClient();
		const loaded: Hydration.DehydratedAtomValue = {
			...sent,
			resultPromise: thenable,
		};
		QueryClient.hydrate(browser, [loaded]);
		state.hold = undefined;
		open();

		expect(await browser.runPromise(Query.fetch(todos))).toEqual([
			{ id: 1, title: "Fetch 1" },
		]);
		expect(state.runs).toBe(1);
	});

	it("leaves a thenable alone that a fetching query doesn't wait for", async () => {
		const { state, todos } = todoList();
		const { wait, open } = gate();
		state.hold = wait;
		const browser = await makeClient();
		const unmount = use(browser.registry, todos);
		const hash = hydrationOf(todos).hash();
		const then = vi.fn();
		const thenable = {
			// oxlint-disable-next-line unicorn/no-thenable -- a thenable is the point
			then,
		} as unknown as Promise<unknown>;

		const entry: Hydration.DehydratedAtomValue = {
			"~effect/reactivity/Hydration/DehydratedAtom": true,
			key: hash,
			value: { _tag: "Initial", waiting: true },
			dehydratedAt: Date.now(),
			resultPromise: thenable,
		};
		QueryClient.hydrate(browser, [entry]);
		await Promise.resolve();

		// A connection that drops rejects the thenable: nothing is listening.
		expect(then).not.toHaveBeenCalled();
		state.hold = undefined;
		open();
		expect(await valueOf(browser.registry, todos)).toEqual([
			{ id: 1, title: "Fetch 1" },
		]);
		unmount();
	});

	it("keeps the server's timestamp for a result that lands before it's read", async () => {
		useFakeTimers();
		const { state, todos } = todoList();
		const server = await makeClient();
		const { wait, open } = gate();
		state.hold = wait;
		const fetched = server.runPromise(Query.prefetch(todos));
		const sent = QueryClient.dehydrate(server, { pending: "promise" });
		const browser = await makeClient();
		QueryClient.hydrate(browser, sent);
		state.hold = undefined;
		open();
		await fetched;

		await vi.advanceTimersByTimeAsync(61_000);
		expect(await browser.runPromise(Query.fetch(todos))).toEqual([
			{ id: 2, title: "Fetch 2" },
		]);
		expect(state.runs).toBe(2);
	});

	it("leaves a query still loading out by default", async () => {
		const { state, todos } = todoList();
		const server = await makeClient();
		state.hold = gate().wait;
		void server.runPromiseExit(Query.prefetch(todos));

		expect(QueryClient.dehydrate(server)).toEqual([]);
	});

	it("lets the browser fetch when the server's fetch fails", async () => {
		const runs = { server: 0, browser: 0 };
		const { wait, open } = gate();
		const todo = Query.make({
			key: ["todo"],
			run: Greeting.use(({ text }) => {
				if (text === "server") {
					runs.server += 1;
					return Effect.andThen(
						wait,
						Effect.fail(new NotFound({ id: 1 })),
					);
				}
				runs.browser += 1;
				return Effect.succeed({ id: 1, title: "From the browser" });
			}),
			schema: { success: Todo, error: NotFound },
		});
		const server = await makeClient({ layer: servicesLayer("server") });
		void server.runPromiseExit(Query.fetch(todo));
		const sent = QueryClient.dehydrate(server, { pending: "promise" });
		const browser = await makeClient();
		QueryClient.hydrate(browser, sent);
		const unmount = use(browser.registry, todo);
		open();

		expect(await valueOf(browser.registry, todo)).toEqual({
			id: 1,
			title: "From the browser",
		});
		expect(runs).toEqual({ server: 1, browser: 1 });
		unmount();
	});

	it("settles its promise when the server's client is disposed first", async () => {
		const { state, todos } = todoList();
		const server = await makeClient();
		state.hold = gate().wait;
		void server.runPromiseExit(Query.fetch(todos));
		const [entry] = Hydration.toValues(
			QueryClient.dehydrate(server, { pending: "promise" }),
		);

		await dispose(server);

		expect(await entry?.resultPromise).toEqual({
			_tag: "Initial",
			waiting: false,
		});
	});

	it("settles its promise when a cache finalizer throws during dispose", async () => {
		const { state, todos } = todoList();
		const server = await makeClient();
		state.hold = gate().wait;
		void server.runPromiseExit(Query.fetch(todos));
		const [entry] = Hydration.toValues(
			QueryClient.dehydrate(server, { pending: "promise" }),
		);
		server.registry.mount(
			Atom.readable((get) => {
				get.addFinalizer(() => {
					throw new FinalizerFailed();
				});
				return 1;
			}),
		);

		await expect(dispose(server)).rejects.toBeInstanceOf(FinalizerFailed);

		expect(await entry?.resultPromise).toEqual({
			_tag: "Initial",
			waiting: false,
		});
	});
});
