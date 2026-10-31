import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { afterEach, describe, expect, it, vi } from "vitest";

import { endpoints } from "../src/effetch/index.js";
import { Mutation, Query, type QueryClient } from "../src/index.js";
import { segments } from "../src/internal/routeKey.js";
import { disposeClients, makeClient, use } from "./helpers.js";
import {
	ApiError,
	type ApiRequest,
	servicesLayer,
	TestApi,
} from "./services.js";

afterEach(disposeClients);

const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });

const getTodo = Fetch.endpoint("GET /todos/:id", { output: Todo });
const listTodos = Fetch.endpoint("GET /todos", { output: Schema.Array(Todo) });
const getComments = Fetch.endpoint("GET /todos/:id/comments", {
	output: Schema.Array(Schema.String),
});
const getRecentComments = Fetch.endpoint("GET /todos/comments", {
	output: Schema.Array(Schema.String),
});
const createTodo = Fetch.endpoint("POST /todos", {
	input: Schema.Struct({ title: Schema.String }),
	output: Todo,
});
const removeTodo = Fetch.endpoint("DELETE /todos/:id");
const signOut = Fetch.endpoint("POST /auth/logout");

const api = endpoints(TestApi, { defaultError: ApiError });
const todo = api.query(getTodo);
const todos = api.query(listTodos);
const comments = api.query(getComments);
const recentComments = api.query(getRecentComments);

/** An in-memory todos API that counts the requests to each path. */
const todosServer = () => {
	const items = new Map([[1, { id: 1, title: "Write tests" }]]);
	const hits = new Map<string, number>();
	const handle = ({ method, url, body }: ApiRequest) => {
		const path = `${method} ${url.pathname}`;
		hits.set(path, (hits.get(path) ?? 0) + 1);
		const id = Number(url.pathname.split("/")[2]);
		if (method === "GET" && url.pathname === "/todos") {
			return Response.json([...items.values()]);
		}
		if (method === "GET" && url.pathname.endsWith("/comments")) {
			return Response.json(["looks good"]);
		}
		if (method === "GET" && items.has(id)) {
			return Response.json(items.get(id));
		}
		if (method === "POST" && url.pathname === "/auth/logout") {
			return new Response(null, { status: 204 });
		}
		if (method === "POST" && url.pathname === "/todos") {
			const { title } = body as { readonly title: string };
			const created = { id: items.size + 1, title };
			items.set(created.id, created);
			return Response.json(created, { status: 201 });
		}
		return undefined;
	};
	return { handle, hits: (path: string) => hits.get(path) ?? 0 };
};

const serve = async (handler = todosServer().handle) =>
	makeClient({ layer: servicesLayer("hello", handler) });

const failure = <A, E>(
	client: QueryClient.QueryClient,
	query: Query.Query<A, E>,
): Promise<E> =>
	client.runPromise(Effect.flip(Query.fetch(query))) as Promise<E>;

describe("keys", () => {
	it("are the path with params filled in, then the query object", () => {
		expect(todo({ params: { id: 1 } }).key).toEqual(["todos", 1]);
		expect(comments({ params: { id: 1 } }).key).toEqual([
			"todos",
			1,
			"comments",
		]);
		expect(todos().key).toEqual(["todos"]);
		expect(todos({ query: { page: 2, tags: ["a", "b"] } }).key).toEqual([
			"todos",
			{ page: 2, tags: ["a", "b"] },
		]);
	});

	it("leave out what isn't sent, so the same request is the same query", () => {
		expect(todos({ query: { page: undefined, tags: [] } })).toBe(todos());
		expect(todos({ query: { page: 2, sort: undefined } })).toBe(
			todos({ query: { page: 2 } }),
		);
		expect(todo({ params: { id: 1 } })).toBe(todo({ params: { id: 1 } }));
	});

	it("drop a full URL's scheme and host, and take the builder's prefix", () => {
		const wallet = endpoints(TestApi, { key: ["wallet"] });
		const account = wallet.query(
			Fetch.endpoint("GET https://wallet.test/v1/accounts/:id"),
		);

		expect(account({ params: { id: "a1" } }).key).toEqual([
			"wallet",
			"v1",
			"accounts",
			"a1",
		]);
		expect(account.key).toEqual(["wallet", "v1", "accounts"]);
		expect(segments("HTTPS://WALLET.TEST/v1")).toEqual(segments("/v1"));
	});
});

describe("queries", () => {
	it("fetch the endpoint's decoded output through the registered client", async () => {
		const client = await serve();

		await expect(
			client.runPromise(Query.fetch(todo({ params: { id: 1 } }))),
		).resolves.toEqual({ id: 1, title: "Write tests" });
	});

	it("invalidating a key prefix refetches every endpoint under it", async () => {
		const server = todosServer();
		const client = await serve(server.handle);
		use(client.registry, todo({ params: { id: 1 } }));
		use(client.registry, todos());
		use(client.registry, comments({ params: { id: 1 } }));
		await vi.waitFor(() => expect(server.hits("GET /todos")).toBe(1));

		await client.runPromise(Query.invalidate(["todos"]));

		await vi.waitFor(() => {
			expect(server.hits("GET /todos")).toBe(2);
			expect(server.hits("GET /todos/1")).toBe(2);
			expect(server.hits("GET /todos/1/comments")).toBe(2);
		});
	});

	it("invalidating a family refetches its own queries only", async () => {
		const server = todosServer();
		const client = await serve(server.handle);
		use(client.registry, todo({ params: { id: 1 } }));
		use(client.registry, todos({ query: { page: 2 } }));
		use(client.registry, comments({ params: { id: 1 } }));
		use(client.registry, recentComments());
		await vi.waitFor(() => {
			expect(server.hits("GET /todos")).toBe(1);
			expect(server.hits("GET /todos/comments")).toBe(1);
		});

		await client.runPromise(Query.refetch(todo));

		expect(server.hits("GET /todos/1")).toBe(2);
		expect(server.hits("GET /todos")).toBe(1);
		expect(server.hits("GET /todos/1/comments")).toBe(1);
		expect(server.hits("GET /todos/comments")).toBe(1);
	});

	it("a builder's prefix keeps its endpoints apart from the same paths elsewhere", async () => {
		const server = todosServer();
		const client = await serve(server.handle);
		const mirror = endpoints(TestApi, { key: ["mirror"] }).query(getTodo);
		use(client.registry, todo({ params: { id: 1 } }));
		use(client.registry, mirror({ params: { id: 1 } }));
		await vi.waitFor(() => expect(server.hits("GET /todos/1")).toBe(2));

		await client.runPromise(Query.invalidate(["todos"]));
		await vi.waitFor(() => expect(server.hits("GET /todos/1")).toBe(3));
		await client.runPromise(Query.refetch(mirror));
		await client.runPromise(Query.invalidate(["mirror", "todos"]));

		await vi.waitFor(() => expect(server.hits("GET /todos/1")).toBe(5));
		expect(mirror({ params: { id: 1 } }).key).toEqual(["mirror", "todos", 1]);
	});

	it("bind the endpoint once per client", async () => {
		const client = await serve();
		const api = await client.runPromise(TestApi.useSync((api) => api));
		const bind = vi.spyOn(api, "bind");
		const query = todo({ params: { id: 1 } });

		await client.runPromise(Query.fetch(query));
		await client.runPromise(Query.refetch(query));

		expect(bind).toHaveBeenCalledTimes(1);
	});
});

describe("errors", () => {
	it("an error status is an HttpError with the decoded error body", async () => {
		const client = await serve();

		const error = await failure(client, todo({ params: { id: 404 } }));

		expect(error._tag).toBe("HttpError");
		expect(error._tag === "HttpError" && error.status).toBe(404);
		expect(error._tag === "HttpError" && error.body).toEqual({
			message: "not found",
		});
	});

	it("a body that doesn't match the output is a DecodeError", async () => {
		const client = await serve(() => Response.json({ id: "one" }));

		const error = await failure(client, todo({ params: { id: 1 } }));

		expect(error._tag).toBe("DecodeError");
	});

	it("a plugin's error reaches the query", async () => {
		const client = await serve();
		const denied = api.query(getTodo, { headers: { "x-deny": "1" } });

		const error = await failure(client, denied({ params: { id: 1 } }));

		expect(error._tag).toBe("Denied");
	});

	it("show the error schema: the endpoint's, else the builder's default", () => {
		const Own = Schema.Struct({ code: Schema.Number });
		const withOwn = api.query(
			Fetch.endpoint("GET /todos/:id", { output: Todo, error: Own }),
		);

		expect(todo.error).toBe(ApiError);
		expect(withOwn.error).toBe(Own);
		expect(endpoints(TestApi).query(getTodo).error).toBeUndefined();
	});
});

describe("mutations", () => {
	it("send the variables and invalidate what they say", async () => {
		const server = todosServer();
		const client = await serve(server.handle);
		const addTodo = api.mutation(createTodo, { invalidates: [todos] });
		use(client.registry, todos());
		await vi.waitFor(() => expect(server.hits("GET /todos")).toBe(1));

		const created = await client.runPromise(
			Mutation.run(addTodo, { body: { title: "Ship it" } }),
		);

		expect(created).toEqual({ id: 2, title: "Ship it" });
		await vi.waitFor(() => expect(server.hits("GET /todos")).toBe(2));
	});

	it("invalidate nothing unless told to", async () => {
		const server = todosServer();
		const client = await serve(server.handle);
		const addTodo = api.mutation(createTodo);
		use(client.registry, todos());
		await vi.waitFor(() => expect(server.hits("GET /todos")).toBe(1));

		await client.runPromise(
			Mutation.run(addTodo, { body: { title: "Quietly" } }),
		);

		expect(server.hits("GET /todos")).toBe(1);
	});

	it("run without variables when the endpoint needs none", async () => {
		const client = await serve();

		const response = await client.runPromise(
			Mutation.run(api.mutation(signOut)),
		);

		expect(response.status).toBe(204);
	});

	it("fail with the endpoint's errors", async () => {
		const client = await serve();
		const remove = api.mutation(removeTodo);

		const exit = await client.runPromiseExit(
			Mutation.run(remove, { params: { id: 9 } }),
		);

		expect(Exit.isFailure(exit)).toBe(true);
		expect(
			Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === "Fail"
				? exit.cause.reasons[0].error._tag
				: undefined,
		).toBe("HttpError");
	});
});
