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

/** One page of todos: `skip` is where it starts, `total` how many there are. */
export const TodoPage = Schema.Struct({
	todos: Schema.Array(Todo),
	skip: Schema.Finite,
	total: Schema.Finite,
});
export type TodoPage = typeof TodoPage.Type;

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

/** The list, a page at a time: `todos({ query: { limit } })`, then "load more". */
export const todos = api.infiniteQuery(
	Fetch.endpoint("GET /todos", { output: TodoPage }),
	{
		pageParam: "skip",
		initialPageParam: 0,
		nextPageParam: (last) => {
			const next = last.skip + last.todos.length;
			return next < last.total ? next : undefined;
		},
		staleTime: "30 seconds",
	},
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
		// Shown at once in every cached list and the detail, and undone if the
		// request fails.
		optimistic: ({ params, body }) =>
			Effect.all(
				[
					Query.update(todos, (data) => ({
						...data,
						pages: data.pages.map((page) => ({
							...page,
							todos: page.todos.map((item) =>
								item.id === params.id
									? { ...item, done: body.done }
									: item,
							),
						})),
					})),
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
