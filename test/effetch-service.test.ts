import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as Fetch from "@monarcode/effetch";
import { FetchTest } from "@monarcode/effetch/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { endpoints } from "../src/effetch/index.js";
import { InfiniteQuery, Mutation, Query, QueryClient } from "../src/index.js";
import { disposeClients, gate, makeClient, record } from "./helpers.js";
import {
	ApiError,
	ServiceApi,
	servicesLayer,
	SessionExpired,
} from "./services.js";

afterEach(disposeClients);

const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });
type Todo = typeof Todo.Type;

class TodoNotFound extends Schema.TaggedError<TodoNotFound>()("TodoNotFound", {
	message: Schema.String,
}) {}

const getTodo = Fetch.endpoint("GET /todos/:id", {
	output: Todo,
	statusErrors: { 404: TodoNotFound },
});
const getNote = Fetch.endpoint("GET /note", { output: Fetch.text() });
const getFile = Fetch.endpoint("GET /file", { output: Fetch.bytes() });

class TodoApi extends Fetch.Endpoints<TodoApi>()("test/TodoApi", ServiceApi, {
	get: getTodo,
	create: Fetch.endpoint("POST /todos", {
		input: Schema.Struct({ title: Schema.String }),
		output: Todo,
	}),
}) {}

const api = endpoints(ServiceApi);
const todo = api.query(getTodo);

/** A client whose `ServiceApi` answers with the given `FetchTest` handlers. */
const serve = (handlers: ReadonlyArray<FetchTest.Handler>) =>
	makeClient({
		layer: servicesLayer(
			"hello",
			undefined,
			ServiceApi.layer.pipe(Layer.provide(FetchTest.layer(handlers))),
		),
	});

/** Dehydrates the server's failures and hydrates them into a new client. */
const roundTrip = async (server: QueryClient.QueryClient) => {
	const sent = JSON.parse(
		JSON.stringify(QueryClient.dehydrate(server, { failures: "include" })),
	);
	const browser = await serve([]);
	QueryClient.hydrate(browser, sent);
	return browser;
};

const shownError = (
	client: QueryClient.QueryClient,
	query: Query.Query<any, any>,
) => {
	const result = client.registry.get(query);
	return AsyncResult.isFailure(result)
		? Option.getOrUndefined(Cause.findErrorOption(result.cause))
		: undefined;
};

const fail = <A, E>(
	client: QueryClient.QueryClient,
	query: Query.Query<A, E>,
) => client.runPromise(Effect.flip(Query.fetch(query)));

describe("endpoints with a Fetch.Service class", () => {
	it("calls the endpoint through the class's client", async () => {
		const client = await serve([
			FetchTest.respond(getTodo, ({ params }) =>
				Effect.succeed({ id: Number(params.id), title: "Write tests" }),
			),
		]);

		expect(await client.fetch(todo({ params: { id: 1 } }))).toEqual({
			id: 1,
			title: "Write tests",
		});
	});

	it("reads defaultError from the class, for the query and the browser", async () => {
		expect(todo.error).toBe(ApiError);
		const server = await serve([
			FetchTest.fail(getTodo, 500, { message: "down" }),
		]);
		const query = todo({ params: { id: 1 } });
		await fail(server, query);

		const browser = await roundTrip(server);

		expect(shownError(browser, query)).toMatchObject({
			_tag: "HttpError",
			status: 500,
			body: { message: "down" },
		});
	});

	it("reads statusErrors from the class, so its errors reach the browser", async () => {
		const server = await serve([
			FetchTest.fail(getTodo, 401, { message: "signed out" }),
		]);
		const query = todo({ params: { id: 1 } });
		expect(await fail(server, query)).toBeInstanceOf(SessionExpired);

		const browser = await roundTrip(server);

		expect(shownError(browser, query)).toBeInstanceOf(SessionExpired);
	});

	it("lets the options override the class's config", () => {
		const SameShape = Schema.Struct({ message: Schema.String });
		const overridden = endpoints(ServiceApi, { defaultError: SameShape });

		expect(overridden.query(getTodo).error).toBe(SameShape);
	});

	it("takes a Fetch.Endpoints class's definitions", async () => {
		const client = await serve([
			FetchTest.respond(TodoApi.definitions.create, ({ body }) =>
				Effect.succeed({ id: 2, title: body.title }),
			),
			FetchTest.respond(TodoApi.definitions.get, ({ params }) =>
				Effect.succeed({ id: Number(params.id), title: "From the class" }),
			),
		]);
		const create = api.mutation(TodoApi.definitions.create);
		const get = api.query(TodoApi.definitions.get);

		expect(await client.fetch(get({ params: { id: 3 } }))).toEqual({
			id: 3,
			title: "From the class",
		});
		expect(
			await client.runPromise(
				Mutation.run(create, { body: { title: "Ship it" } }),
			),
		).toEqual({ id: 2, title: "Ship it" });
	});

	it("sends a Fetch.text() query to the browser", async () => {
		const note = api.query(getNote, { staleTime: "1 minute" });
		const server = await serve([
			FetchTest.respond(getNote, () => Effect.succeed("hello")),
		]);
		await server.fetch(note());
		// The browser's backend answers nothing: the value comes from the server.
		const browser = await roundTrip(server);

		expect(await browser.fetch(note())).toBe("hello");
	});

	it("doesn't send a Fetch.bytes() query, which has no JSON form", async () => {
		const file = api.query(getFile);
		const server = await serve([
			FetchTest.respond(getFile, () =>
				Effect.succeed(new Uint8Array([1, 2, 3])),
			),
		]);
		expect(await server.fetch(file())).toEqual(new Uint8Array([1, 2, 3]));

		expect(QueryClient.dehydrate(server)).toEqual([]);
	});
});

describe("endpoints with a query schema", () => {
	const Search = Schema.Struct({
		due: Schema.Date,
		perPage: Schema.optional(Schema.Finite),
		page: Schema.optional(Schema.Finite),
	}).pipe(Schema.encodeKeys({ perPage: "per_page" }));
	const Page = Schema.Struct({
		todos: Schema.Array(Todo),
		next: Schema.NullOr(Schema.Finite),
	});
	const searchTodos = Fetch.endpoint("GET /todos/search", {
		output: Page,
		query: Search,
	});
	const search = api.query(searchTodos, { staleTime: "1 minute" });
	const searchPages = api.infiniteQuery(searchTodos, {
		pageParam: "page",
		initialPageParam: 1,
		nextPageParam: (last) => last.next ?? undefined,
	});
	const due = "2026-11-16T00:00:00.000Z";

	/** A backend that answers with the query it decoded, and records it. */
	const backend = () => {
		const seen: Array<typeof Search.Type> = [];
		const handler = FetchTest.respond(searchTodos, ({ query }) =>
			Effect.sync(() => {
				seen.push(query);
				const page = query.page ?? 1;
				return {
					todos: [{ id: page, title: query.due.toISOString() }],
					next: page < 2 ? page + 1 : null,
				};
			}),
		);
		return { seen, handler };
	};

	it("keys a call by its query as sent", () => {
		expect(
			search({ query: { due: new Date(due), perPage: 20 } }).key,
		).toEqual(["todos", "search", { due, per_page: "20" }]);
	});

	it("shares a query between calls that send the same request", () => {
		expect(search({ query: { due: new Date(due) } })).toBe(
			search({ query: { due: new Date(due) } }),
		);
	});

	it("calls the endpoint with the query decoded", async () => {
		const { seen, handler } = backend();
		const client = await serve([handler]);

		const page = await client.fetch(
			search({ query: { due: new Date(due), perPage: 20 } }),
		);

		expect(page.todos[0]?.title).toBe(due);
		expect(seen).toEqual([{ due: new Date(due), perPage: 20 }]);
	});

	it("throws at the call when the query doesn't match the schema", () => {
		expect(() =>
			search({ query: { due: new Date("not a date") } }),
		).toThrow();
	});

	it("pages through an optional field, left out of the key", async () => {
		const { seen, handler } = backend();
		const client = await serve([handler]);
		const pages = searchPages({ query: { due: new Date(due) } });
		expect(pages.key).toEqual(["todos", "search", { due }]);

		await client.fetch(pages);
		await client.runPromise(InfiniteQuery.fetchNextPage(pages));

		expect(seen.map((query) => query.page)).toEqual([1, 2]);
		expect(
			Option.map(QueryClient.get(client, pages), (data) => data.pageParams),
		).toEqual(Option.some([1, 2]));
	});

	it("sends the query to the browser by its encoded key", async () => {
		const { handler } = backend();
		const server = await serve([handler]);
		await server.fetch(search({ query: { due: new Date(due) } }));

		// The browser's backend answers nothing: the value comes from the server.
		const browser = await roundTrip(server);

		expect(
			(await browser.fetch(search({ query: { due: new Date(due) } }))).todos,
		).toEqual([{ id: 1, title: due }]);
	});

	it("passes a mutation's query to the endpoint as given", async () => {
		const archive = Fetch.endpoint("POST /todos/archive", {
			output: Schema.Struct({ archived: Schema.Finite }),
			query: Schema.Struct({ before: Schema.Date }),
		});
		const before: Array<Date> = [];
		const client = await serve([
			FetchTest.respond(archive, ({ query }) =>
				Effect.sync(() => {
					before.push(query.before);
					return { archived: 3 };
				}),
			),
		]);

		const result = await client.runPromise(
			Mutation.run(api.mutation(archive), {
				query: { before: new Date(due) },
			}),
		);

		expect(result).toEqual({ archived: 3 });
		expect(before).toEqual([new Date(due)]);
	});
});

describe("query schemas: the review's regressions", () => {
	it("sends a query whose fields encode to nothing", async () => {
		const filtered = Fetch.endpoint("GET /todos/filtered", {
			output: Schema.Array(Todo),
			query: Schema.Struct({ tags: Schema.Array(Schema.String) }),
		});
		const seen: Array<unknown> = [];
		const client = await serve([
			FetchTest.respond(filtered, ({ query }) =>
				Effect.sync(() => {
					seen.push(query);
					return [];
				}),
			),
		]);
		const query = api.query(filtered)({ query: { tags: [] } });

		expect(query.key).toEqual(["todos", "filtered"]);
		expect(await client.fetch(query)).toEqual([]);
		expect(seen).toHaveLength(1);
	});

	it("gives Query.update the query as it was given", async () => {
		const Dated = Schema.Struct({ due: Schema.Date });
		const dated = Fetch.endpoint("GET /todos/dated", {
			output: Schema.Array(Todo),
			query: Dated,
		});
		const client = await serve([
			FetchTest.respond(dated, () => Effect.succeed([])),
		]);
		const family = api.query(dated, { staleTime: "1 minute" });
		const due = new Date("2026-11-16T00:00:00.000Z");
		await client.fetch(family({ query: { due } }));
		const seen: Array<unknown> = [];

		await client.runPromise(
			Query.update(family, (value, args) => {
				seen.push(args.query?.due);
				return value;
			}),
		);

		expect(seen).toEqual([due]);
	});

	it("rejects a Redacted field, whose secret a key would hold", () => {
		const secret = api.query(
			Fetch.endpoint("GET /todos/secret", {
				output: Schema.Array(Todo),
				query: Schema.Struct({ token: Schema.Redacted(Schema.String) }),
			}),
		);
		expect(() =>
			secret({ query: { token: Redacted.make("s3cret") } }),
		).toThrow(expect.objectContaining({ _tag: "EndpointQueryError" }));
	});

	it("throws an EndpointQueryError naming the route for a bad query", () => {
		const dated = api.query(
			Fetch.endpoint("GET /todos/dated", {
				output: Schema.Array(Todo),
				query: Schema.Struct({ due: Schema.Date }),
			}),
		);
		expect(() => dated({ query: { due: new Date("x") } })).toThrow(
			expect.objectContaining({
				_tag: "EndpointQueryError",
				message: expect.stringContaining("GET /todos/dated"),
			}),
		);
	});

	it("leaves a renamed page field out of the key", () => {
		const Feed = Schema.Struct({
			text: Schema.String,
			page: Schema.optional(Schema.Finite),
		}).pipe(Schema.encodeKeys({ page: "p" }));
		const feed = api.infiniteQuery(
			Fetch.endpoint("GET /feed", {
				output: Schema.Array(Todo),
				query: Feed,
			}),
			{
				pageParam: "page",
				initialPageParam: 1,
				nextPageParam: () => undefined,
			},
		);

		expect(feed({ query: { text: "a", page: 7 } })).toBe(
			feed({ query: { text: "a" } }),
		);
		expect(feed({ query: { text: "a" } }).key).toEqual([
			"feed",
			{ text: "a" },
		]);
	});
});

describe("api.query placeholder", () => {
	it("shows while the endpoint answers, and isn't cached", async () => {
		const answer = gate();
		const client = await serve([
			FetchTest.respond(getTodo, () =>
				Effect.as(answer.wait, { id: 1, title: "Fetched" }),
			),
		]);
		const detail = api.query(getTodo, {
			placeholder: () =>
				Effect.succeed(Option.some({ id: 1, title: "Placeholder" })),
		});

		const shown = record(client.registry, detail({ params: { id: 1 } }));

		expect(shown).toEqual([
			'Success(waiting) {"id":1,"title":"Placeholder"}',
		]);
		await expect(
			client.runPromise(Query.get(detail({ params: { id: 1 } }))),
		).resolves.toEqual(Option.none());
		answer.open();
		await vi.waitFor(() =>
			expect(shown.at(-1)).toBe('Success {"id":1,"title":"Fetched"}'),
		);
	});
});

describe("stream endpoints and live", () => {
	const Progress = Schema.Struct({ percent: Schema.Finite });
	const progressEvents = Fetch.endpoint("GET /jobs/:id/events", {
		output: Progress,
		stream: "sse",
	});
	const progressLines = Fetch.endpoint("GET /jobs/:id/lines", {
		output: Progress,
		stream: "ndjson",
	});

	it("makes a stream query of an SSE endpoint, keyed by route", async () => {
		const client = await serve([
			FetchTest.respond(progressEvents, ({ params }) =>
				Effect.succeed([
					{ data: { percent: 10 } },
					{ event: "done", id: params.id, data: { percent: 100 } },
				]),
			),
		]);
		const job = api.query(progressEvents);
		const query = job({ params: { id: "7" } });
		expect(query.key).toEqual(["jobs", "7", "events"]);
		// The first element, then the latest.
		expect(await client.runPromise(Query.fetch(query))).toEqual({
			event: "message",
			id: undefined,
			data: { percent: 10 },
		});
		const unmount = client.registry.mount(query);
		await client.runPromise(Query.refetch(query));
		await vi.waitFor(() =>
			expect(AsyncResult.value(client.registry.get(query))).toEqual(
				Option.some({ event: "done", id: "7", data: { percent: 100 } }),
			),
		);
		unmount();
	});

	it("sends an SSE query's latest event to the browser", async () => {
		const server = await serve([
			FetchTest.respond(progressEvents, () =>
				Effect.succeed([{ id: "1", data: { percent: 40 } }]),
			),
		]);
		const job = api.query(progressEvents);
		await server.runPromise(Query.prefetch(job({ params: { id: "7" } })));
		const sent = JSON.parse(JSON.stringify(QueryClient.dehydrate(server)));
		const browser = await serve([]);
		QueryClient.hydrate(browser, sent);
		// It shows as it subscribes again.
		const shown = browser.registry.get(job({ params: { id: "7" } }));
		expect(shown.waiting).toBe(true);
		expect(AsyncResult.value(shown)).toEqual(
			Option.some({ event: "message", id: "1", data: { percent: 40 } }),
		);
	});

	it("sends an SSE event without an id", async () => {
		const server = await serve([
			FetchTest.respond(progressEvents, () =>
				Effect.succeed([{ data: { percent: 5 } }]),
			),
		]);
		const job = api.query(progressEvents);
		await server.runPromise(Query.prefetch(job({ params: { id: "8" } })));
		const sent = JSON.parse(JSON.stringify(QueryClient.dehydrate(server)));
		const browser = await serve([]);
		QueryClient.hydrate(browser, sent);
		expect(
			AsyncResult.value(browser.registry.get(job({ params: { id: "8" } }))),
		).toEqual(
			Option.some({ event: "message", id: undefined, data: { percent: 5 } }),
		);
	});

	it("makes a stream query of an NDJSON endpoint", async () => {
		const client = await serve([
			FetchTest.respond(progressLines, () =>
				Effect.succeed([{ percent: 1 }, { percent: 2 }]),
			),
		]);
		const lines = api.query(progressLines);
		expect(
			await client.runPromise(Query.fetch(lines({ params: { id: "1" } }))),
		).toEqual({ percent: 1 });
	});

	it("applies live updates to an endpoint's query", async () => {
		const client = await serve([
			FetchTest.respond(getTodo, ({ params }) =>
				Effect.succeed({ id: Number(params.id), title: "fetched" }),
			),
		]);
		const renamed = api.query(getTodo, {
			// A push after the fetch: one before it is in what it fetches.
			live: ({ params }) =>
				Stream.fromEffect(
					Effect.delay(
						Effect.succeed((todo: Todo) => ({
							...todo,
							title: `pushed ${params.id}`,
						})),
						"20 millis",
					),
				),
		});
		const query = renamed({ params: { id: 3 } });
		const unmount = client.registry.mount(query);
		await vi.waitFor(() =>
			expect(AsyncResult.value(client.registry.get(query))).toEqual(
				Option.some({ id: 3, title: "pushed 3" }),
			),
		);
		unmount();
	});
});
