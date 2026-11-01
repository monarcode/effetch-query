import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { Query } from "@monarcode/effetch-query";
import { endpoints } from "@monarcode/effetch-query/effetch";

export const Todo = Schema.Struct({
	id: Schema.Finite,
	todo: Schema.String,
	completed: Schema.Boolean,
	userId: Schema.Finite,
});
export type Todo = typeof Todo.Type;

const TodoPage = Schema.Struct({
	todos: Schema.Array(Todo),
	total: Schema.Finite,
	skip: Schema.Finite,
	limit: Schema.Finite,
});

// What dummyjson sends back when a request fails.
const ApiError = Schema.Struct({ message: Schema.String });

const makeDummyJson = Fetch.make({
	baseUrl: import.meta.env.VITE_DUMMYJSON_URL ?? "https://dummyjson.com",
	defaultError: ApiError,
});

export class DummyJson extends Context.Service<
	DummyJson,
	Effect.Success<typeof makeDummyJson>
>()("DummyJson") {}

declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: DummyJson;
	}
}

/** The client, over whichever `HttpClient` the app provides. */
export const DummyJsonLive = Layer.effect(DummyJson)(makeDummyJson);

const api = endpoints(DummyJson, { defaultError: ApiError });

// todos({ query: { limit: 10 } }) is the query keyed ["todos", { limit: 10 }]
export const todos = api.query(
	Fetch.endpoint("GET /todos", { output: TodoPage }),
	{ staleTime: "1 minute" },
);

export const toggleTodo = api.mutation(
	Fetch.endpoint("PATCH /todos/:id", {
		input: Schema.Struct({ completed: Schema.Boolean }),
		output: Todo,
	}),
	{
		// Every cached page shows the change at once; it's undone if the
		// request fails.
		optimistic: ({ params, body }) =>
			Query.update(todos, (page) => ({
				...page,
				todos: page.todos.map((todo) =>
					todo.id === params.id ? { ...todo, ...body } : todo,
				),
			})),
		// dummyjson saves nothing, so a refetch would bring the old todo
		// back: the cache keeps the server's answer instead.
		onSuccess: (saved) =>
			Query.update(todos, (page) => ({
				...page,
				todos: page.todos.map((todo) =>
					todo.id === saved.id ? saved : todo,
				),
			})),
	},
);
