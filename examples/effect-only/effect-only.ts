import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { Mutation, Query, QueryClient } from "@monarcode/effetch-query";

export interface Todo {
	readonly id: number;
	readonly title: string;
}

export class TodoNotFound extends Data.TaggedError("TodoNotFound")<{
	readonly id: number;
}> {}

/** A todo store, standing in for an HTTP API or a database. */
export class TodoStore extends Context.Service<
	TodoStore,
	{
		readonly list: Effect.Effect<ReadonlyArray<Todo>>;
		readonly get: (id: number) => Effect.Effect<Todo, TodoNotFound>;
		readonly add: (title: string) => Effect.Effect<Todo>;
		/** How many times the store was read, to show what the cache saves. */
		readonly reads: Effect.Effect<number>;
	}
>()("examples/TodoStore") {}

declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: TodoStore;
	}
}

export const TodoStoreLive = Layer.sync(TodoStore, () => {
	const todos = new Map([[1, { id: 1, title: "Write the docs" }]]);
	let reads = 0;
	const read = <A>(f: () => A) =>
		Effect.sync(() => {
			reads++;
			return f();
		});
	return {
		list: read(() => [...todos.values()]),
		get: (id) =>
			Effect.flatMap(
				read(() => todos.get(id)),
				(todo) =>
					todo === undefined
						? Effect.fail(new TodoNotFound({ id }))
						: Effect.succeed(todo),
			),
		add: (title) =>
			Effect.sync(() => {
				const todo = { id: todos.size + 1, title };
				todos.set(todo.id, todo);
				return todo;
			}),
		reads: Effect.sync(() => reads),
	};
});

export const todos = Query.make({
	key: ["todos", "list"],
	run: TodoStore.use((store) => store.list),
	staleTime: "1 minute",
});

export const todo = Query.family({
	key: ["todos", "detail"],
	run: (id: number) => TodoStore.use((store) => store.get(id)),
	staleTime: "1 minute",
});

export const addTodo = Mutation.make({
	run: (title: string) => TodoStore.use((store) => store.add(title)),
	// The new todo is cached as it is, so opening it needs no read.
	onSuccess: (created) => Query.set(todo(created.id), created),
	invalidates: [todos],
});

export const program = Effect.gen(function* () {
	// The first fetch reads the store; the second is answered from the cache.
	yield* Query.fetch(todos);
	const listed = yield* Query.fetch(todos);

	const created = yield* Mutation.run(addTodo, "Ship it");
	const opened = yield* Query.get(todo(created.id));

	// The mutation invalidated the list, so this fetch reads it again.
	const relisted = yield* Query.fetch(todos);

	const missing = yield* Query.fetch(todo(99)).pipe(
		Effect.as("found"),
		Effect.catchTag("TodoNotFound", (error) =>
			Effect.succeed(`no todo ${error.id}`),
		),
	);

	return {
		listed: listed.map((item) => item.title),
		opened: Option.map(opened, (item) => item.title),
		relisted: relisted.map((item) => item.title),
		missing,
		reads: yield* TodoStore.use((store) => store.reads),
	};
});

/**
 * The program with a client of its own, disposed when it ends. Layers given
 * to one `provide` share their builds, so the client's queries and the
 * program use the same `TodoStore`.
 */
export const main = program.pipe(
	Effect.provide(
		Layer.merge(QueryClient.layer({ layer: TodoStoreLive }), TodoStoreLive),
	),
);
