import * as Effect from "effect/Effect";

import {
	Entity,
	InfiniteQuery,
	Mutation,
	Query,
} from "@monarcode/effetch-query";
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
 * A todo, written wherever it's cached: its own query, each user's list and
 * every loaded page. Each query's `schema` is how it's found.
 */
export const Todos = Entity.make(Todo, { id: (item) => item.id });

/**
 * The signed-in user. Signed out, or with an expired token, it dies with a
 * redirect to sign in: a loader that fetches it sends the visitor there.
 */
export const viewer = Query.make({
	key: ["auth", "me"],
	run: DummyJson.use((dummyjson) => dummyjson.me).pipe(
		Effect.catchTag("Unauthorized", () =>
			Effect.die(redirect({ to: "/login" })),
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
	// A todo opened from a list shows at once, while its own fetch runs.
	// dummyjson saves nothing, so a todo toggled in a list comes back
	// untoggled from that fetch; a server that saves sends the change.
	placeholder: (id) => Entity.get(Todos, id),
});

/** Every todo, ten at a time: each page's param is its `skip`. */
export const allTodos = InfiniteQuery.make({
	key: ["todos", "all"],
	initialPageParam: 0,
	run: (skip) =>
		DummyJson.use((dummyjson) => dummyjson.todos({ limit: 10, skip })),
	// From the page's own params, not its length: a removed todo
	// (`deleteTodo`) shortens a loaded page.
	nextPageParam: (last) => {
		const next = last.skip + last.limit;
		return next < last.total ? next : undefined;
	},
	schema: { page: TodoPage },
});

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
		Entity.update(Todos, id, (item) => ({ ...item, completed })),
	onSuccess: (saved) => Entity.set(Todos, saved),
});

/** A page of todos, counting one fewer. */
const oneFewer = (page: TodoPage): TodoPage => ({
	...page,
	total: page.total - 1,
});

export const deleteTodo = Mutation.make({
	run: (id: number) => DummyJson.use((dummyjson) => dummyjson.deleteTodo(id)),
	// Removing it leaves the totals, which only the lists know about.
	optimistic: (id) =>
		Effect.all(
			[
				Entity.remove(Todos, id),
				Query.update(userTodos, oneFewer),
				Query.update(allTodos, (data) => ({
					...data,
					pages: data.pages.map(oneFewer),
				})),
			],
			{ discard: true },
		),
});

export const login = Mutation.make({
	run: (credentials: Credentials) =>
		DummyJson.use((dummyjson) => dummyjson.login(credentials)),
	// A second click while signing in does nothing.
	concurrent: "drop",
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
