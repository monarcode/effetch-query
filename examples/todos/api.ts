import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { Query } from "@monarcode/effetch-query";
import { endpoints } from "@monarcode/effetch-query/effetch";

export const Todo = Schema.Struct({
	id: Schema.Finite,
	title: Schema.String,
	done: Schema.Boolean,
});
export type Todo = typeof Todo.Type;

export const ApiError = Schema.Struct({ message: Schema.String });

const makeAppApi = Fetch.make({
	baseUrl: "https://todos.example",
	defaultError: ApiError,
});

export class AppApi extends Context.Service<
	AppApi,
	Effect.Success<typeof makeAppApi>
>()("examples/AppApi") {}

declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: AppApi;
	}
}

/** The client over whichever `HttpClient` the app provides. */
export const AppApiLive = Layer.effect(AppApi)(makeAppApi);

const api = endpoints(AppApi, { defaultError: ApiError });

export const todos = api.query(
	Fetch.endpoint("GET /todos", { output: Schema.Array(Todo) }),
	{ staleTime: "30 seconds" },
);

export const todo = api.query(
	Fetch.endpoint("GET /todos/:id", { output: Todo }),
	{ staleTime: "30 seconds" },
);

export const toggleTodo = api.mutation(
	Fetch.endpoint("PATCH /todos/:id", {
		input: Schema.Struct({ done: Schema.Boolean }),
		output: Todo,
	}),
	{
		// Shown at once in the list and the detail, and undone if the request
		// fails.
		optimistic: ({ params, body }) =>
			Effect.all(
				[
					Query.update(todos(), (list) =>
						list.map((item) =>
							item.id === params.id
								? { ...item, done: body.done }
								: item,
						),
					),
					Query.update(todo({ params }), (item) => ({
						...item,
						done: body.done,
					})),
				],
				{ discard: true },
			),
		onSuccess: (updated) => Query.set(todo({ params: updated }), updated),
		invalidates: [todos],
	},
);
