import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Headers from "effect/http/Headers";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { afterEach, describe, expect, it, vi } from "vitest";

import { endpoints } from "../src/effetch/index.js";
import { InfiniteQuery, Mutation, Query, QueryClient } from "../src/index.js";
import { internals, type QueryHydration } from "../src/internal/queryAtom.js";
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

	it("take only the route's params, so a whole record can be the params", () => {
		const record = { id: 1, title: "Write tests" };

		expect(todo({ params: record })).toBe(todo({ params: { id: 1 } }));
	});

	it("leave a missing param missing, so effetch reports it", async () => {
		const client = await serve();
		const untyped = todo as unknown as (
			args: object,
		) => Query.Query<unknown, unknown>;

		const exit = await client.runPromiseExit(
			Query.fetch(untyped({ params: {} })),
		);

		expect(Exit.hasDies(exit)).toBe(true);
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

	it("Query.update writes the endpoint's own cached queries, with their arguments", async () => {
		const client = await serve();
		await client.runPromise(Query.fetch(todo({ params: { id: 1 } })));
		await client.runPromise(Query.fetch(comments({ params: { id: 1 } })));
		const seen: Array<unknown> = [];

		await client.runPromise(
			Query.update(todo, (value, args) => {
				seen.push(args);
				return { ...value, title: "Renamed" };
			}),
		);

		expect(seen).toEqual([{ params: { id: 1 } }]);
		expect(
			await client.runPromise(Query.get(todo({ params: { id: 1 } }))),
		).toEqual(Option.some({ id: 1, title: "Renamed" }));
		expect(
			await client.runPromise(Query.get(comments({ params: { id: 1 } }))),
		).not.toEqual(Option.none());
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

describe("infinite queries", () => {
	const Page = Schema.Struct({
		items: Schema.Array(Schema.Finite),
		skip: Schema.Finite,
		total: Schema.Finite,
	});
	const listNumbers = Fetch.endpoint("GET /numbers", { output: Page });
	const numberPages = api.infiniteQuery(listNumbers, {
		pageParam: "skip",
		initialPageParam: 0,
		nextPageParam: (last) =>
			last.skip + last.items.length < last.total
				? last.skip + last.items.length
				: undefined,
	});

	/** Serves 0..total in pages of `limit` (default 2), and records each request's query. */
	const numbersServer = (total = 5) => {
		const requests: Array<string> = [];
		const handle = ({ method, url }: ApiRequest) => {
			if (method !== "GET" || url.pathname !== "/numbers") {
				return undefined;
			}
			requests.push(url.search);
			const skip = Number(url.searchParams.get("skip") ?? 0);
			const limit = Number(url.searchParams.get("limit") ?? 2);
			const items = Array.from(
				{ length: Math.max(0, Math.min(limit, total - skip)) },
				(_, i) => skip + i,
			);
			return Response.json({ items, skip, total });
		};
		return { handle, requests };
	};

	it("send each page's param in the page field, keyed without it", async () => {
		const server = numbersServer();
		const client = await serve(server.handle);
		const pages = numberPages({ query: { limit: 2 } });

		await client.runPromise(Query.fetch(pages));
		const data = await client.runPromise(InfiniteQuery.fetchNextPage(pages));

		expect(data.pages.flatMap((page) => page.items)).toEqual([0, 1, 2, 3]);
		expect(data.pageParams).toEqual([0, 2]);
		expect(server.requests).toEqual(["?limit=2&skip=0", "?limit=2&skip=2"]);
		expect(pages.key).toEqual(["numbers", { limit: 2 }]);
	});

	it("leave the call's own page field out of the key, and send their own", async () => {
		const server = numbersServer();
		const client = await serve(server.handle);

		expect(numberPages({ query: { skip: 4 } })).toBe(numberPages());
		await client.runPromise(Query.fetch(numberPages({ query: { skip: 4 } })));

		expect(server.requests).toEqual(["?skip=0"]);
	});

	it("are matched and updated as their family's members", async () => {
		const server = numbersServer();
		const client = await serve(server.handle);
		await client.runPromise(Query.fetch(numberPages()));
		await client.runPromise(
			Query.fetch(numberPages({ query: { limit: 3 } })),
		);
		server.requests.length = 0;

		await client.runPromise(
			Query.update(numberPages, (data, args) => ({
				...data,
				pages: data.pages.map((page) => ({
					...page,
					items: [args?.query === undefined ? -1 : -3],
				})),
			})),
		);
		client.registry.mount(numberPages());
		await client.runPromise(Query.refetch(numberPages));

		expect(server.requests).toEqual(["?skip=0"]);
		expect(
			Option.map(
				await client.runPromise(
					Query.get(numberPages({ query: { limit: 3 } })),
				),
				(data) => data.pages[0]?.items,
			),
		).toEqual(Option.some([-3]));
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

describe("hydration", () => {
	/** A query's error, as the client that hydrated it shows it. */
	const shownError = (
		client: QueryClient.QueryClient,
		query: Query.Query<any, any>,
	) => {
		const result = client.registry.get(query);
		return AsyncResult.isFailure(result)
			? Cause.findErrorOption(result.cause)
			: Option.none();
	};

	const sendFailure = async (
		handler: Parameters<typeof serve>[0],
		query: Query.Query<any, any>,
	) => {
		const server = await serve(handler);
		await failure(server, query);
		const sent = QueryClient.dehydrate(server, { failures: "include" });
		const browser = await serve();
		QueryClient.hydrate(browser, JSON.parse(JSON.stringify(sent)));
		return { sent, browser };
	};

	it("sends an endpoint query without code", async () => {
		const freshTodo = api.query(getTodo, { staleTime: "1 minute" });
		const server = await serve();
		await server.runPromise(Query.prefetch(freshTodo({ params: { id: 1 } })));
		const sent = JSON.parse(JSON.stringify(QueryClient.dehydrate(server)));
		const handler = todosServer();
		const browser = await serve(handler.handle);

		QueryClient.hydrate(browser, sent);

		expect(
			await browser.runPromise(
				Query.fetch(freshTodo({ params: { id: 1 } })),
			),
		).toEqual({ id: 1, title: "Write tests" });
		expect(handler.hits("GET /todos/1")).toBe(0);
	});

	it("sends an HttpError with its decoded body, and no headers", async () => {
		const query = todo({ params: { id: 1 } });
		const { sent, browser } = await sendFailure(
			() =>
				Response.json(
					{ message: "gone" },
					{ status: 410, headers: { "set-cookie": "session=secret" } },
				),
			query,
		);

		expect(JSON.stringify(sent)).not.toContain("secret");
		const error = shownError(browser, query);
		expect(Option.getOrUndefined(error)).toBeInstanceOf(Fetch.HttpError);
		expect(Option.getOrUndefined(error)).toMatchObject({
			status: 410,
			body: { message: "gone" },
			headers: Headers.empty,
		});
	});

	it("sends a DecodeError without its issue", async () => {
		const query = todo({ params: { id: 1 } });
		const { browser } = await sendFailure(
			() => Response.json({ id: "one" }),
			query,
		);

		const error = Option.getOrUndefined(shownError(browser, query));
		expect(error).toBeInstanceOf(Fetch.DecodeError);
		expect(error).toMatchObject({ status: 200, issue: undefined });
	});

	it("sends a NetworkError without its cause", () => {
		const { hydration } = internals(todo({ params: { id: 1 } }));
		expect(hydration).toBeDefined();
		const { codec } = hydration as QueryHydration<unknown, unknown>;
		const failed = AsyncResult.failure(
			Cause.fail(
				new Fetch.NetworkError({
					method: "GET",
					url: "/todos/1",
					cause: new TypeError("Failed to fetch"),
				}),
			),
		);

		const decoded = codec.decode(
			JSON.parse(JSON.stringify(codec.encode(failed))),
		);

		const error =
			AsyncResult.isFailure(decoded) &&
			Option.getOrUndefined(Cause.findErrorOption(decoded.cause));
		expect(error).toBeInstanceOf(Fetch.NetworkError);
		expect(error).toMatchObject({ url: "/todos/1", cause: undefined });
	});

	it("leaves out a query that failed with a plugin's error", async () => {
		const server = await serve();
		const denied = api.query(getTodo, { headers: { "x-deny": "1" } });
		await failure(server, denied({ params: { id: 1 } }));

		expect(QueryClient.dehydrate(server, { failures: "include" })).toEqual(
			[],
		);
	});
});
