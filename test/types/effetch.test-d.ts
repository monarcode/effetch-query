import * as Context from "effect/Context";
import type * as Exit from "effect/Exit";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { describe, expectTypeOf, it } from "vitest";

import { endpoints } from "../../src/effetch/index.js";
import type { InfiniteQuery, Mutation, Query } from "../../src/index.js";
import { useMutation } from "../../src/react/index.js";
import { ApiError, type Denied, TestApi } from "../services.js";

class Unregistered extends Context.Service<
	Unregistered,
	Fetch.Client<[], Schema.Unknown>
>()("test/UnregisteredApi") {}

const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });
type Todo = typeof Todo.Type;

const api = endpoints(TestApi);

/** Every error a call through `TestApi` can fail with, for an error schema `EB`. */
type CallErrors<EB, Decode = Fetch.DecodeError> =
	| Fetch.NetworkError
	| Fetch.HttpError.With<EB>
	| Decode
	| Denied;

describe("Endpoints.query", () => {
	it("takes A from the output and E from the error schema and the plugins", () => {
		const todo = api.query(
			Fetch.endpoint("GET /todos/:id", { output: Todo }),
		);

		expectTypeOf(todo({ params: { id: 1 } })).toEqualTypeOf<
			Query.Query<Todo, CallErrors<typeof ApiError.Type>>
		>();
	});

	it("uses the endpoint's own error schema over the client's", () => {
		const Own = Schema.Struct({ code: Schema.Number });
		const todo = api.query(
			Fetch.endpoint("GET /todos/:id", { output: Todo, error: Own }),
		);

		expectTypeOf(todo({ params: { id: 1 } })).toEqualTypeOf<
			Query.Query<Todo, CallErrors<typeof Own.Type>>
		>();
	});

	it("gives the raw response, with no DecodeError, without an output", () => {
		const ping = api.query(Fetch.endpoint("HEAD /ping"));

		expectTypeOf(ping()).toEqualTypeOf<
			Query.Query<
				HttpClientResponse.HttpClientResponse,
				CallErrors<typeof ApiError.Type, never>
			>
		>();
	});

	it("requires exactly the path's params", () => {
		const todo = api.query(
			Fetch.endpoint("GET /todos/:id", { output: Todo }),
		);
		const todos = api.query(Fetch.endpoint("GET /todos", { output: Todo }));

		// @ts-expect-error: `id` is missing
		todo();
		// @ts-expect-error: `id` is missing
		todo({ params: {} });
		// @ts-expect-error: the path has no `slug`
		todo({ params: { id: 1, slug: "x" } });
		todos();
		todos({ query: { page: 2 } });
	});

	it("only takes endpoints without a body", () => {
		const create = Fetch.endpoint("POST /todos", { output: Todo });

		// @ts-expect-error: a POST endpoint is a mutation
		api.query(create);
	});

	it("is a target for invalidation", () => {
		const todo = api.query(
			Fetch.endpoint("GET /todos/:id", { output: Todo }),
		);

		expectTypeOf(todo).toExtend<Query.QueryTarget>();
	});
});

describe("Endpoints.infiniteQuery", () => {
	const Page = Schema.Struct({
		items: Schema.Array(Todo),
		next: Schema.NullOr(Schema.String),
	});
	type Page = typeof Page.Type;
	const listTodos = Fetch.endpoint("GET /todos", { output: Page });

	it("takes A from the output, E as Endpoints.query, and P from initialPageParam", () => {
		const todoPages = api.infiniteQuery(listTodos, {
			pageParam: "cursor",
			initialPageParam: null as string | null,
			nextPageParam: (last) => last.next,
		});

		expectTypeOf(todoPages({ query: { limit: 20 } })).toEqualTypeOf<
			InfiniteQuery.InfiniteQuery<
				Page,
				CallErrors<typeof ApiError.Type>,
				string | null
			>
		>();
		expectTypeOf(todoPages).toExtend<Query.QueryTarget>();
	});

	it("needs a page param a query field takes", () => {
		api.infiniteQuery(listTodos, {
			// @ts-expect-error: an object can't be sent in a query field
			pageParam: "cursor",
			initialPageParam: { after: "a" },
			nextPageParam: () => undefined,
		});
		api.infiniteQuery(listTodos, {
			// @ts-expect-error: a Date, one of the param's types, can't be sent either
			pageParam: "cursor",
			initialPageParam: 0 as number | Date,
			nextPageParam: () => undefined,
		});
	});

	it("only takes endpoints without a body", () => {
		api.infiniteQuery(
			// @ts-expect-error: POST has a body
			Fetch.endpoint("POST /todos/search", { output: Page }),
			{
				pageParam: "cursor",
				initialPageParam: null,
				nextPageParam: () => undefined,
			},
		);
	});
});

describe("Endpoints.mutation", () => {
	it("takes the endpoint's call options as variables", () => {
		const create = api.mutation(
			Fetch.endpoint("POST /todos/:list", {
				input: Schema.Struct({ title: Schema.String }),
				output: Todo,
			}),
		);
		const { run } = useMutation(create);

		void run({ params: { list: "inbox" }, body: { title: "Ship it" } });
		// @ts-expect-error: the body is required
		void run({ params: { list: "inbox" } });
		// @ts-expect-error: the params are required
		void run({ body: { title: "Ship it" } });
		expectTypeOf(run).returns.toEqualTypeOf<
			Promise<Exit.Exit<Todo, CallErrors<typeof ApiError.Type>>>
		>();
	});

	it("runs with no variables when the endpoint needs none", () => {
		const signOut = api.mutation(Fetch.endpoint("POST /auth/logout"));

		expectTypeOf(signOut).toExtend<
			Mutation.Mutation<
				void,
				HttpClientResponse.HttpClientResponse,
				CallErrors<typeof ApiError.Type, never>
			>
		>();
		void useMutation(signOut).run();
	});
});

describe("endpoints", () => {
	it("needs the client's service to be registered", () => {
		// @effect-diagnostics-next-line missingEffectContext:off
		// @ts-expect-error: Unregistered isn't in Register["services"]
		endpoints(Unregistered);
	});

	it("checks defaultError against the client's", () => {
		endpoints(TestApi, { defaultError: ApiError });
		// @ts-expect-error: the client decodes errors with ApiError
		endpoints(TestApi, { defaultError: Schema.Number });
	});

	it("rejects a schema that needs an unregistered service", () => {
		const needy = Schema.String as unknown as Schema.Codec<
			string,
			string,
			Unregistered
		>;

		// @ts-expect-error: decoding the output needs Unregistered
		api.query(Fetch.endpoint("GET /needy", { output: needy }));
	});
});
