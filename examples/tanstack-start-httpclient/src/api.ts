import * as Effect from "effect/Effect";

import { InfiniteQuery, Mutation, Query } from "@monarcode/effetch-query";
import { redirect } from "@tanstack/react-router";

import {
	type Credentials,
	DummyJson,
	Todo,
	TodoPage,
	User,
} from "./dummyjson.js";
import { writeSessionCookie } from "./session.js";

/**
 * The signed-in user. Signed out, or with an expired token, it dies with a
 * redirect to sign in: a loader that fetches it sends the visitor there.
 */
export const viewer = Query.make({
	key: ["auth", "me"],
	run: DummyJson.use((dummyjson) => dummyjson.me).pipe(
		Effect.catchTag("ApiError", (error) =>
			error.status === 401
				? Effect.die(redirect({ to: "/login" }))
				: Effect.fail(error),
		),
	),
	schema: { success: User },
	staleTime: "5 minutes",
});

// userTodos(1) is keyed ["todos", "user", 1]
export const userTodos = Query.family({
	key: ["todos", "user"],
	run: (userId: number) =>
		DummyJson.use((dummyjson) => dummyjson.userTodos(userId)),
	schema: { success: TodoPage },
});

// todo(1) is keyed ["todos", "detail", 1]
export const todo = Query.family({
	key: ["todos", "detail"],
	run: (id: number) => DummyJson.use((dummyjson) => dummyjson.todo(id)),
	schema: { success: Todo },
});

/** Every todo, ten at a time: each page's param is its `skip`. */
export const allTodos = InfiniteQuery.make({
	key: ["todos", "all"],
	initialPageParam: 0,
	run: (skip) =>
		DummyJson.use((dummyjson) => dummyjson.todos({ limit: 10, skip })),
	nextPageParam: (last) => {
		const next = last.skip + last.todos.length;
		return next < last.total ? next : undefined;
	},
	schema: { page: TodoPage },
});

/** Writes `f` of a todo wherever it's cached: its own query and every list. */
const updateTodo = (id: number, f: (todo: Todo) => Todo) => {
	const inPage = (page: TodoPage): TodoPage => ({
		...page,
		todos: page.todos.map((item) => (item.id === id ? f(item) : item)),
	});
	return Effect.all(
		[
			Query.update(todo(id), f),
			Query.update(userTodos, inPage),
			Query.update(allTodos, (data) => ({
				...data,
				pages: data.pages.map(inPage),
			})),
		],
		{ discard: true },
	);
};

interface TodoChange {
	readonly id: number;
	readonly completed: boolean;
}

// dummyjson saves nothing, so these mutations invalidate nothing: a refetch
// would bring the old todos back. The cache keeps the server's answer.
export const toggleTodo = Mutation.make({
	run: ({ id, completed }: TodoChange) =>
		DummyJson.use((dummyjson) => dummyjson.updateTodo(id, { completed })),
	optimistic: ({ id, completed }) =>
		updateTodo(id, (item) => ({ ...item, completed })),
	onSuccess: (saved) => updateTodo(saved.id, () => saved),
});

export const deleteTodo = Mutation.make({
	run: (id: number) => DummyJson.use((dummyjson) => dummyjson.deleteTodo(id)),
	optimistic: (id) =>
		Query.update(userTodos, (page) => ({
			...page,
			todos: page.todos.filter((item) => item.id !== id),
			total: page.total - 1,
		})),
});

export const login = Mutation.make({
	run: (credentials: Credentials) =>
		DummyJson.use((dummyjson) => dummyjson.login(credentials)),
	// The next request sends the token, and the next page has the viewer
	// without fetching it.
	onSuccess: ({ accessToken, ...user }) =>
		Effect.andThen(
			Effect.sync(() => writeSessionCookie(accessToken)),
			Query.set(viewer, user),
		),
});

/** A failure as a sentence: dummyjson's own message, when it sent one. */
export const describeError = (error: unknown): string =>
	error instanceof Error ? error.message : "Something went wrong.";
