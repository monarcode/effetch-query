import * as Schema from "effect/Schema";

import { Fetch } from "@monarcode/effetch";
import { Entity } from "@monarcode/effetch-query";
import { fromClient } from "@monarcode/effetch-query/effetch";

export const Todo = Schema.Struct({
	id: Schema.Finite,
	todo: Schema.String,
	completed: Schema.Boolean,
	userId: Schema.Finite,
});
export type Todo = typeof Todo.Type;

/** A todo, written in every cached query that holds it. */
export const Todos = Entity.make(Todo, { id: (todo) => todo.id });

const TodoPage = Schema.Struct({
	todos: Schema.Array(Todo),
	total: Schema.Finite,
	skip: Schema.Finite,
	limit: Schema.Finite,
});

// What dummyjson sends back when a request fails.
const ApiError = Schema.Struct({ message: Schema.String });

/** The client; its `layer` needs the `HttpClient` the app provides. */
export class DummyJson extends Fetch.Service<DummyJson>()("DummyJson", {
	baseUrl: import.meta.env.VITE_DUMMYJSON_URL ?? "https://dummyjson.com",
	defaultError: ApiError,
}) {}

declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: DummyJson;
	}
}

const api = fromClient(DummyJson);

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
		// Every cached copy shows the change at once; it's undone if the
		// request fails.
		optimistic: ({ params, body }) =>
			Entity.update(Todos, Number(params.id), (todo) => ({
				...todo,
				...body,
			})),
		// dummyjson saves nothing, so a refetch would bring the old todo
		// back: the cache keeps the server's answer instead.
		onSuccess: (saved) => Entity.set(Todos, saved),
	},
);
