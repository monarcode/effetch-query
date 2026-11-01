import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { Query } from "@monarcode/effetch-query";
import { endpoints } from "@monarcode/effetch-query/effetch";
import { redirect } from "react-router";

import {
	ApiError,
	DummyJson,
	SignedIn,
	Todo,
	TodoPage,
	User,
} from "./dummyjson.js";
import { writeSessionCookie } from "./session.js";

const api = endpoints(DummyJson, { defaultError: ApiError });

/**
 * The signed-in user. Signed out, or with an expired token, it dies with a
 * redirect to sign in: a loader that fetches it sends the visitor there.
 */
export const viewer = Query.make({
	key: ["auth", "me"],
	run: DummyJson.use((client) =>
		client.get("/auth/me", { output: User }),
	).pipe(
		Effect.catchTag("HttpError", (error) =>
			error.status === 401
				? Effect.die(redirect("/login"))
				: Effect.fail(error),
		),
	),
	schema: { success: User },
	staleTime: "5 minutes",
});

// userTodos({ params: { userId: 1 } }) is keyed ["todos", "user", 1]
export const userTodos = api.query(
	Fetch.endpoint("GET /todos/user/:userId", { output: TodoPage }),
);

// todo({ params: { id: 1 } }) is keyed ["todos", 1]
export const todo = api.query(
	Fetch.endpoint("GET /todos/:id", { output: Todo }),
);

/** Every todo, ten at a time: `skip` is each page's param. */
export const allTodos = api.infiniteQuery(
	Fetch.endpoint("GET /todos", { output: TodoPage }),
	{
		pageParam: "skip",
		initialPageParam: 0,
		nextPageParam: (last) => {
			const next = last.skip + last.todos.length;
			return next < last.total ? next : undefined;
		},
	},
);

export const everyTodo = allTodos({ query: { limit: 10 } });

/** Writes `f` of a todo wherever it's cached: its own query and every list. */
const updateTodo = (id: number, f: (todo: Todo) => Todo) => {
	const inPage = (page: TodoPage): TodoPage => ({
		...page,
		todos: page.todos.map((item) => (item.id === id ? f(item) : item)),
	});
	return Effect.all(
		[
			Query.update(todo({ params: { id } }), f),
			Query.update(userTodos, inPage),
			Query.update(allTodos, (data) => ({
				...data,
				pages: data.pages.map(inPage),
			})),
		],
		{ discard: true },
	);
};

// dummyjson saves nothing, so these mutations invalidate nothing: a refetch
// would bring the old todos back. The cache keeps the server's answer.
export const toggleTodo = api.mutation(
	Fetch.endpoint("PATCH /todos/:id", {
		input: Schema.Struct({ completed: Schema.Boolean }),
		output: Todo,
	}),
	{
		optimistic: ({ params, body }) =>
			updateTodo(Number(params.id), (item) => ({ ...item, ...body })),
		onSuccess: (saved) => updateTodo(saved.id, () => saved),
	},
);

export const deleteTodo = api.mutation(
	Fetch.endpoint("DELETE /todos/:id", { output: Todo }),
	{
		optimistic: ({ params }) =>
			Query.update(userTodos, (page) => ({
				...page,
				todos: page.todos.filter((item) => item.id !== params.id),
				total: page.total - 1,
			})),
	},
);

export const login = api.mutation(
	Fetch.endpoint("POST /auth/login", {
		input: Schema.Struct({
			username: Schema.String,
			password: Schema.String,
			expiresInMins: Schema.Finite,
		}),
		output: SignedIn,
	}),
	{
		// The next request sends the token, and the next page has the viewer
		// without fetching it.
		onSuccess: ({ accessToken, ...user }) =>
			Effect.andThen(
				Effect.sync(() => writeSessionCookie(accessToken)),
				Query.set(viewer, user),
			),
	},
);

/** A failure as a sentence: dummyjson's own message, when it sent one. */
export const describeError = (error: unknown): string =>
	error instanceof Fetch.HttpError
		? Option.match(Schema.decodeUnknownOption(ApiError)(error.body), {
				onNone: () => error.message,
				onSome: ({ message }) => message,
			})
		: error instanceof Error
			? error.message
			: "Something went wrong.";
