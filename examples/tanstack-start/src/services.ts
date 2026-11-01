import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { findTodo, getViewer, listTodos } from "./api.js";

export const Todo = Schema.Struct({
	id: Schema.Finite,
	title: Schema.String,
	done: Schema.Boolean,
});
export type Todo = typeof Todo.Type;

export class TodoNotFound extends Data.TaggedError("TodoNotFound")<{
	readonly id: number;
}> {}

/** The todos. The live layer calls Start server functions. */
export class TodoApi extends Context.Service<
	TodoApi,
	{
		readonly list: Effect.Effect<ReadonlyArray<Todo>>;
		readonly find: (id: number) => Effect.Effect<Todo, TodoNotFound>;
	}
>()("examples/tanstack-start/TodoApi") {}

/** Who's signed in. */
export class Session extends Context.Service<
	Session,
	{ readonly viewer: Effect.Effect<string | null> }
>()("examples/tanstack-start/Session") {}

// Server functions run in-process on the server and over HTTP from the
// browser, so these layers serve both.

export const TodoApiLive: Layer.Layer<TodoApi> = Layer.succeed(TodoApi, {
	list: Effect.promise(() => listTodos()),
	find: (id) =>
		Effect.promise(() => findTodo({ data: id })).pipe(
			Effect.filterOrFail(
				Predicate.isNotNull,
				() => new TodoNotFound({ id }),
			),
		),
});

export const SessionLive: Layer.Layer<Session> = Layer.succeed(Session, {
	viewer: Effect.promise(() => getViewer()),
});

/** Every service the app's queries use. */
export const AppLayer = Layer.mergeAll(TodoApiLive, SessionLive);

declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: Layer.Success<typeof AppLayer>;
	}
}
