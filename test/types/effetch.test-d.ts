import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { Fetch } from "@monarcode/effetch";
import { describe, expectTypeOf, it } from "vitest";

import {
	type EndpointQuery,
	type EndpointQueryOptions,
	fromClient,
} from "../../src/effetch/index.js";
import { type InfiniteQuery, Mutation, Query } from "../../src/index.js";
import { useMutation, useQuery } from "../../src/react/index.js";
import {
	ApiError,
	clientStatusErrors,
	type Denied,
	ServiceApi,
	type SessionExpired,
	TestApi,
} from "../services.js";

class Unregistered extends Context.Service<
	Unregistered,
	Fetch.Client<[], Schema.Unknown>
>()("test/UnregisteredApi") {}

const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });
type Todo = typeof Todo.Type;

const api = fromClient(TestApi);

/** Every error a call through `TestApi` can fail with, for an error schema `EB`. */
type CallErrors<EB, Decode = Fetch.DecodeError> =
	| Fetch.NetworkError
	| Fetch.HttpError.With<EB>
	| Decode
	| Denied
	| SessionExpired;

class TodoNotFound extends Schema.TaggedError<TodoNotFound>()("TodoNotFound", {
	message: Schema.String,
}) {}

class InvalidRole extends Schema.TaggedError<InvalidRole>()("InvalidRole", {
	code: Schema.Literal("INVALID_ROLE"),
	message: Schema.String,
}) {}

class RoleTaken extends Schema.TaggedError<RoleTaken>()("RoleTaken", {
	code: Schema.Literal("ROLE_TAKEN"),
	message: Schema.String,
}) {}

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

	it("takes a query typed with an interface, and checks its fields", () => {
		interface ListTodosParams {
			readonly page: number;
			readonly tags?: ReadonlyArray<string> | undefined;
		}
		interface Nested {
			readonly filter: { readonly done: boolean };
		}
		const todos = api.query(Fetch.endpoint("GET /todos", { output: Todo }));
		const todoPages = api.infiniteQuery(
			Fetch.endpoint("GET /todos", { output: Todo }),
			{
				pageParam: "skip",
				initialPageParam: 0,
				nextPageParam: () => undefined,
			},
		);
		const params: ListTodosParams = { page: 2 };
		const nested: Nested = { filter: { done: true } };

		todos({ query: params });
		todoPages({ query: params });
		// @ts-expect-error: an object can't be sent in a query field
		todos({ query: nested });
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

		expectTypeOf(todo).toExtend<Query.Target>();
	});
});

describe("Endpoints.query placeholder", () => {
	it("is typed by the route's params and the endpoint's output", () => {
		const todos = api.query(
			Fetch.endpoint("GET /todos", { output: Schema.Array(Todo) }),
		);
		api.query(Fetch.endpoint("GET /todos/:id", { output: Todo }), {
			placeholder: (args) => {
				expectTypeOf(args.params.id).toEqualTypeOf<string | number>();
				return Effect.map(Query.get(todos()), (list) =>
					Option.flatMap(list, (items) =>
						Option.fromUndefinedOr(
							items.find((item) => item.id === Number(args.params.id)),
						),
					),
				);
			},
		});
		api.query(Fetch.endpoint("GET /todos/:id", { output: Todo }), {
			// @ts-expect-error: the value is a Todo
			placeholder: () => Effect.succeed(Option.some("Todo")),
		});
		api.query(Fetch.endpoint("GET /todos/:id", { output: Todo }), {
			// @ts-expect-error: it can't fail
			// @effect-diagnostics-next-line missingEffectError:off
			placeholder: () => Effect.fail("no"),
		});
	});

	it("still takes options typed with two parameters, as before", () => {
		const options = <E, Ps extends ReadonlyArray<Fetch.Plugin.Any>>(
			value: EndpointQueryOptions<E, Ps>,
		): EndpointQueryOptions<E, Ps> => value;
		const todo = api.query(
			Fetch.endpoint("GET /todos/:id", { output: Todo }),
			options({ staleTime: "1 minute" }),
		);
		expectTypeOf(todo({ params: { id: 1 } })).toExtend<
			Query.Query<Todo, unknown>
		>();
	});

	it("gets the query the schema types", () => {
		api.query(
			Fetch.endpoint("GET /todos/due", {
				output: Schema.Array(Todo),
				query: Schema.Struct({ before: Schema.Date }),
			}),
			{
				placeholder: (args) => {
					expectTypeOf(args.query.before).toEqualTypeOf<Date>();
					return Effect.succeed(Option.none());
				},
			},
		);
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
		expectTypeOf(todoPages).toExtend<Query.Target>();
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

	it("types a multipart body by its schema", () => {
		const upload = api.mutation(
			Fetch.endpoint("POST /documents", {
				input: Fetch.multipart(
					Schema.Struct({ file: Fetch.UploadFile, kind: Schema.String }),
				),
				output: Todo,
			}),
		);
		const { run } = useMutation(upload);
		const file = new File(["%PDF"], "scan.pdf");

		void run({ body: { file, kind: "PASSPORT" } });
		void run({
			body: {
				file: { uri: "file:///scan.pdf", name: "scan.pdf" },
				kind: "PASSPORT",
			},
		});
		// @ts-expect-error: the file is required
		void run({ body: { kind: "PASSPORT" } });
		// @ts-expect-error: a string isn't a file
		void run({ body: { file: "scan.pdf", kind: "PASSPORT" } });
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

describe("fromClient", () => {
	it("needs the client's service to be registered", () => {
		// @effect-diagnostics-next-line missingEffectContext:off
		// @ts-expect-error: Unregistered isn't in Register["services"]
		fromClient(Unregistered);
	});

	it("checks defaultError against the client's", () => {
		fromClient(TestApi, { defaultError: ApiError });
		// @ts-expect-error: the client decodes errors with ApiError
		fromClient(TestApi, { defaultError: Schema.Number });
	});

	it('takes invalidates: "route" and nothing else', () => {
		fromClient(TestApi, { invalidates: "route" });
		fromClient(TestApi, { invalidates: undefined });
		// @ts-expect-error: "route" is the only mode
		fromClient(TestApi, { invalidates: "all" });
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

describe("fromClient with a Fetch.Service class", () => {
	const fromClass = fromClient(ServiceApi);
	const getTodo = Fetch.endpoint("GET /todos/:id", { output: Todo });

	it("types errors from the class's config, with no options", () => {
		expectTypeOf(
			fromClass.query(getTodo)({ params: { id: 1 } }),
		).toEqualTypeOf<
			Query.Query<
				Todo,
				| Fetch.NetworkError
				| Fetch.HttpError.With<typeof ApiError.Type>
				| Fetch.DecodeError
				| SessionExpired
			>
		>();
	});

	it("checks the options against the class's config", () => {
		fromClient(ServiceApi, { defaultError: ApiError });
		// @ts-expect-error: the class decodes errors with ApiError
		fromClient(ServiceApi, { defaultError: Schema.Number });
	});

	it("takes a Fetch.Endpoints class's definitions", () => {
		class TodoApi extends Fetch.Endpoints<TodoApi>()(
			"test/TypedTodoApi",
			ServiceApi,
			{ get: getTodo },
		) {}
		expectTypeOf(
			fromClass.query(TodoApi.definitions.get)({ params: { id: 1 } }),
		).toExtend<Query.Query<Todo, unknown>>();
	});
});

const MutationRun = Mutation.run;

describe("fromClient with a query schema", () => {
	const Search = Schema.Struct({
		due: Schema.Date,
		page: Schema.optional(Schema.Finite),
	});
	const search = Fetch.endpoint("GET /todos/search", {
		output: Schema.Array(Todo),
		query: Search,
	});

	it("types a call's query by the schema, and requires it when needed", () => {
		const query = api.query(search);
		expectTypeOf(query).toEqualTypeOf<
			EndpointQuery<
				"GET /todos/search",
				ReadonlyArray<Todo>,
				CallErrors<typeof ApiError.Type>,
				typeof Search
			>
		>();
		query({ query: { due: new Date() } });
		// @ts-expect-error: due is a Date
		query({ query: { due: "2026-11-16" } });
		// @ts-expect-error: the schema has a required field
		query();
	});

	it("keeps endpoints without a query schema as they were", () => {
		expectTypeOf(
			api.query(
				Fetch.endpoint("GET /todos", { output: Schema.Array(Todo) }),
			),
		).toEqualTypeOf<
			EndpointQuery<
				"GET /todos",
				ReadonlyArray<Todo>,
				CallErrors<typeof ApiError.Type>
			>
		>();
	});

	it("takes an optional field of the schema as an infinite query's pageParam", () => {
		api.infiniteQuery(search, {
			pageParam: "page",
			initialPageParam: 1,
			nextPageParam: () => undefined,
		});
		api.infiniteQuery(search, {
			// @ts-expect-error: due is required, and isn't a number
			pageParam: "due",
			initialPageParam: 1,
			nextPageParam: () => undefined,
		});
	});

	it("takes a cursor whose first page sends none", () => {
		const Feed = Schema.Struct({ cursor: Schema.optional(Schema.String) });
		api.infiniteQuery(
			Fetch.endpoint("GET /feed", { output: Todo, query: Feed }),
			{
				pageParam: "cursor",
				initialPageParam: undefined as string | undefined,
				nextPageParam: () => undefined,
			},
		);
	});

	it("rejects a page param with no JSON form", () => {
		const Since = Schema.Struct({ after: Schema.optional(Schema.Date) });
		api.infiniteQuery(
			Fetch.endpoint("GET /since", { output: Todo, query: Since }),
			{
				// @ts-expect-error: a Date page wouldn't reach the browser
				pageParam: "after",
				initialPageParam: new Date(0),
				nextPageParam: () => undefined,
			},
		);
	});

	it("takes a query schema whose decoding needs a service", () => {
		const decodesWithService = Search as unknown as Schema.Codec<
			typeof Search.Type,
			typeof Search.Encoded,
			Unregistered,
			never
		>;
		api.query(
			Fetch.endpoint("GET /todos/decoded", {
				output: Todo,
				query: decodesWithService,
			}),
		);
	});

	it("rejects a query schema that needs a service for a query's key", () => {
		const needy = Search as unknown as Schema.Codec<
			typeof Search.Type,
			typeof Search.Encoded,
			never,
			Unregistered
		>;
		const withNeedy = Fetch.endpoint("GET /todos/needy", {
			output: Todo,
			query: needy,
		});
		// @ts-expect-error: a key is encoded outside any Effect
		api.query(withNeedy);
	});

	it("types a mutation's variables by the schema", () => {
		const archive = api.mutation(
			Fetch.endpoint("POST /todos/archive", {
				query: Schema.Struct({ before: Schema.Date }),
			}),
		);
		expectTypeOf(archive).toExtend<
			Mutation.Mutation<
				{ readonly query: { readonly before: Date } },
				unknown,
				unknown
			>
		>();
		// @ts-expect-error: before is a Date
		const wrong = MutationRun(archive, { query: { before: "x" } });
		expectTypeOf(wrong).not.toBeNever();
	});
});

describe("status errors", () => {
	const getTodo = Fetch.endpoint("GET /todos/:id", {
		output: Todo,
		statusErrors: { 404: TodoNotFound },
	});
	const assignRole = Fetch.endpoint("POST /users/:id/roles", {
		input: Schema.Struct({ role: Schema.String }),
		output: Todo,
		statusErrors: { 400: [InvalidRole, RoleTaken] },
	});

	it("add the endpoint's and the client's to a query's errors", () => {
		const todo = api.query(getTodo);

		expectTypeOf(todo({ params: { id: 1 } })).toEqualTypeOf<
			Query.Query<Todo, CallErrors<typeof ApiError.Type> | TodoNotFound>
		>();
	});

	it("add them to an infinite query's and a mutation's errors", () => {
		const pages = api.infiniteQuery(
			Fetch.endpoint("GET /todos", {
				output: Schema.Array(Todo),
				statusErrors: { 404: TodoNotFound },
			}),
			{
				pageParam: "page",
				initialPageParam: 1,
				nextPageParam: () => undefined,
			},
		);
		const assign = api.mutation(assignRole);

		expectTypeOf(pages()).toEqualTypeOf<
			InfiniteQuery.InfiniteQuery<
				ReadonlyArray<Todo>,
				CallErrors<typeof ApiError.Type> | TodoNotFound,
				number
			>
		>();
		expectTypeOf(assign).toExtend<
			Mutation.Mutation<
				any,
				Todo,
				CallErrors<typeof ApiError.Type> | InvalidRole | RoleTaken
			>
		>();
	});

	it("narrow with catchTag and onErrorTag", () => {
		const todo = api.query(getTodo);

		const found = Query.fetch(todo({ params: { id: 1 } })).pipe(
			Effect.catchTag("TodoNotFound", (error) =>
				Effect.succeed({ id: 0, title: error.message }),
			),
			Effect.catchTag("SessionExpired", () =>
				Effect.succeed({ id: 0, title: "" }),
			),
		);
		expectTypeOf<Effect.Error<typeof found>>().toEqualTypeOf<
			| Fetch.NetworkError
			| Fetch.HttpError.With<typeof ApiError.Type>
			| Fetch.DecodeError
			| Denied
		>();
		const shown = AsyncResult.builder(useQuery(todo({ params: { id: 1 } })))
			.onErrorTag("TodoNotFound", (error) => error.message)
			.orNull();
		expectTypeOf(shown).toEqualTypeOf<string | null>();
	});

	it("show the endpoint's map on its definition", () => {
		const todo = api.query(getTodo);

		expectTypeOf(todo.endpoint.statusErrors).toEqualTypeOf<
			Fetch.StatusErrorMap | undefined
		>();
	});

	it("check the client's statusErrors against the client's", () => {
		fromClient(TestApi, { statusErrors: clientStatusErrors });
		// @ts-expect-error: the client maps 401 to SessionExpired
		fromClient(TestApi, { statusErrors: { 401: TodoNotFound } });
	});

	it("reject a status error schema that needs an unregistered service", () => {
		const needy = TodoNotFound as unknown as Schema.Codec<
			TodoNotFound,
			unknown,
			Unregistered
		>;

		api.query(
			// @ts-expect-error: decoding the error needs Unregistered
			Fetch.endpoint("GET /needy", {
				output: Todo,
				statusErrors: { 404: needy },
			}),
		);
	});
});

describe("Endpoints.query with a stream endpoint", () => {
	const Progress = Schema.Struct({ percent: Schema.Finite });
	type Progress = typeof Progress.Type;

	it("holds an SseEvent of the output, or the output for NDJSON", () => {
		const events = api.query(
			Fetch.endpoint("GET /jobs/:id/events", {
				output: Progress,
				stream: "sse",
			}),
		);
		expectTypeOf(events({ params: { id: 1 } })).toEqualTypeOf<
			Query.Query<Fetch.SseEvent<Progress>, CallErrors<typeof ApiError.Type>>
		>();
		const lines = api.query(
			Fetch.endpoint("GET /jobs/:id/lines", {
				output: Progress,
				stream: "ndjson",
			}),
		);
		expectTypeOf(lines({ params: { id: 1 } })).toEqualTypeOf<
			Query.Query<Progress, CallErrors<typeof ApiError.Type>>
		>();
	});

	it("takes a stream query's options, not a fetched one's", () => {
		const endpoint = Fetch.endpoint("GET /jobs/:id/events", {
			output: Progress,
			stream: "sse",
		});
		api.query(endpoint, {
			placeholder: ({ params }) =>
				Effect.succeed(
					Option.some({
						event: "message",
						id: String(params.id),
						data: { percent: 0 },
					}),
				),
		});
		// @ts-expect-error: a stream keeps its query current
		api.query(endpoint, { staleTime: "1 minute" });
	});
});

describe("EndpointQueryOptions.live", () => {
	it("updates the endpoint's output, from the call's params", () => {
		api.query(Fetch.endpoint("GET /todos/:id", { output: Todo }), {
			live: ({ params }) =>
				Stream.make((todo: Todo) => ({
					...todo,
					title: String(params.id),
				})),
		});
		api.query(Fetch.endpoint("GET /todos/:id", { output: Todo }), {
			// @ts-expect-error: an update returns a Todo
			live: () => Stream.make((todo: Todo) => todo.title),
		});
	});

	it("is taken by options typed with two parameters, as before", () => {
		const options = <E, Ps extends ReadonlyArray<Fetch.Plugin.Any>>(
			value: EndpointQueryOptions<E, Ps>,
		): EndpointQueryOptions<E, Ps> => value;
		api.query(
			Fetch.endpoint("GET /todos/:id", { output: Todo }),
			options({ live: () => Stream.empty }),
		);
	});
});
