import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { Entity, Query } from "@monarcode/effetch-query";
import { fromClient } from "@monarcode/effetch-query/effetch";
import { redirect } from "@tanstack/react-router";

import {
	ApiError,
	DummyJson,
	SignedIn,
	Todo,
	TodoPage,
	User,
} from "./dummyjson.js";
import { writeSessionCookie } from "./session.js";

const api = fromClient(DummyJson);

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
				? Effect.die(redirect({ to: "/login" }))
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
		// From the page's own params, not its length: a removed todo
		// (`deleteTodo`) shortens a loaded page.
		nextPageParam: (last) => {
			const next = last.skip + last.limit;
			return next < last.total ? next : undefined;
		},
	},
);

export const everyTodo = allTodos({ query: { limit: 10 } });

/** A todo, written wherever it's cached: its own query, each user's list and every loaded page. */
export const Todos = Entity.make(Todo, { id: (item) => item.id });

// dummyjson saves nothing, so these mutations invalidate nothing: a refetch
// would bring the old todos back. The cache keeps the server's answer.
export const toggleTodo = api.mutation(
	Fetch.endpoint("PATCH /todos/:id", {
		input: Schema.Struct({ completed: Schema.Boolean }),
		output: Todo,
	}),
	{
		optimistic: ({ params, body }) =>
			Entity.update(Todos, Number(params.id), (item) => ({
				...item,
				...body,
			})),
		onSuccess: (saved) => Entity.set(Todos, saved),
	},
);

export const deleteTodo = api.mutation(
	Fetch.endpoint("DELETE /todos/:id", { output: Todo }),
	{
		// Removing it leaves the totals, which only the lists know about.
		optimistic: ({ params }) =>
			Effect.andThen(
				Entity.remove(Todos, Number(params.id)),
				Query.update(userTodos, (page) => ({
					...page,
					total: page.total - 1,
				})),
			),
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
