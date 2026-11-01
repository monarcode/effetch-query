import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { afterEach, describe, expect, it } from "vitest";

import { endpoints } from "../src/effetch/index.js";
import { InfiniteQuery, Query, QueryClient } from "../src/index.js";
import { hashKey } from "../src/internal/hashKey.js";
import { internals, type QueryHydration } from "../src/internal/queryAtom.js";
import { disposeClients, makeClient, valueOf } from "./helpers.js";
import { TestApi } from "./services.js";

afterEach(disposeClients);

const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });

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
	])("fails with NonJsonKey for %s", (_, segment) => {
		const key = ["todos", { segment }];
		try {
			hashKey(key);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(QueryClient.NonJsonKey);
			expect(error).toMatchObject({ _tag: "NonJsonKey", key });
			expect((error as QueryClient.NonJsonKey).message).toContain("todos");
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

		expect(() => hydrationOf(query).hash()).toThrow(QueryClient.NonJsonKey);
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
});
