import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { FetchTest } from "@monarcode/effetch/test";
import { afterEach, describe, expect, it } from "vitest";

import { endpoints } from "../src/effetch/index.js";
import { Mutation, Query, QueryClient } from "../src/index.js";
import { disposeClients, makeClient } from "./helpers.js";
import {
	ApiError,
	ServiceApi,
	servicesLayer,
	SessionExpired,
} from "./services.js";

afterEach(disposeClients);

const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });

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
