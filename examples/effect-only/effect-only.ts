import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { Mutation, Query, QueryClient } from "@monarcode/effetch-query";

export interface Todo {
	readonly id: number;
	readonly title: string;
}

export class TodoNotFound extends Data.TaggedError("TodoNotFound")<{
	readonly id: number;
	readonly message: string;
}> {}

/** A todo store, standing in for an HTTP API or a database. */
export class TodoStore extends Context.Service<
	TodoStore,
	{
		readonly list: Effect.Effect<ReadonlyArray<Todo>>;
		readonly get: (id: number) => Effect.Effect<Todo, TodoNotFound>;
		readonly add: (title: string) => Effect.Effect<Todo>;
		/** How many todos there are, now and after every change: what a socket would push. */
		readonly count: Stream.Stream<number>;
		/** How many times the store was read, to show what the cache saves. */
		readonly reads: Effect.Effect<number>;
		/** How many times `count` was subscribed to. */
		readonly countSubscriptions: Effect.Effect<number>;
	}
>()("examples/TodoStore") {}

declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: TodoStore;
	}
}

export const TodoStoreLive = Layer.effect(
	TodoStore,
	Effect.gen(function* () {
		const todos = yield* SubscriptionRef.make<ReadonlyArray<Todo>>([
			{ id: 1, title: "Write the docs" },
		]);
		let reads = 0;
		let countSubscriptions = 0;
		const read = Effect.andThen(
			Effect.sync(() => reads++),
			SubscriptionRef.get(todos),
		);
		return {
			list: read,
			get: (id) =>
				Effect.flatMap(read, (all) => {
					const todo = all.find((item) => item.id === id);
					return todo === undefined
						? Effect.fail(
								new TodoNotFound({ id, message: `No todo ${id}` }),
							)
						: Effect.succeed(todo);
				}),
			add: (title) =>
				SubscriptionRef.modify(todos, (all) => {
					const todo = { id: all.length + 1, title };
					return [todo, [...all, todo]];
				}),
			count: SubscriptionRef.changes(todos).pipe(
				Stream.onStart(Effect.sync(() => countSubscriptions++)),
				Stream.map((all) => all.length),
			),
			reads: Effect.sync(() => reads),
			countSubscriptions: Effect.sync(() => countSubscriptions),
		};
	}),
);

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

/**
 * A live query: its value is the stream's latest element, pushed by the
 * store with no read. It's never stale, so focus, reconnect and `staleTime`
 * leave it alone; `refetch`, `invalidate` and `reset` subscribe again.
 */
export const todoCount = Query.stream({
	key: ["todoCount"],
	run: Stream.unwrap(TodoStore.useSync((store) => store.count)),
});

/** What a todo list screen shows: two queries under unrelated keys. */
export const listScreen = Query.group(todos, todoCount);

export const addTodo = Mutation.make({
	run: (title: string) => TodoStore.use((store) => store.add(title)),
	// The new todo is cached as it is, so opening it needs no read.
	onSuccess: (created) => Query.set(todo(created.id), created),
	invalidates: [todos],
});

const reads = TodoStore.use((store) => store.reads);

export const program = Effect.gen(function* () {
	// `mount` and `toStreamResult` are Effect's own, and unstable: their
	// names may change in a later Effect 4 release.
	const { registry } = yield* QueryClient.QueryClient;

	// The first fetch reads the store; the second is answered from the cache.
	yield* Query.fetch(todos);
	const listed = yield* Query.fetch(todos);
	const readsCached = yield* reads;

	// Mounted, as a component mounts it, the count's stream runs and pushes.
	yield* AtomRegistry.mount(registry, todoCount);
	const countBefore = yield* Query.fetch(todoCount);

	const created = yield* Mutation.run(addTodo, "Ship it");
	const opened = yield* Query.get(todo(created.id));

	// The store pushed the new count; nothing refetched it.
	const countAfter = yield* AtomRegistry.toStreamResult(
		registry,
		todoCount,
	).pipe(
		Stream.filter((count) => count !== countBefore),
		Stream.runHead,
		Effect.flatMap(Effect.fromOption),
		Effect.timeout("1 second"),
	);

	// The mutation invalidated the list, so this fetch reads it again.
	const relisted = yield* Query.fetch(todos);
	const readsAfterAdd = yield* reads;

	// A failure is the query's own error, caught by tag. The client's
	// `onFailure` hook logs it too, in a fiber of its own.
	const missing = yield* Query.fetch(todo(99)).pipe(
		Effect.as("found"),
		Effect.catchTag("TodoNotFound", (error) => Effect.succeed(error.message)),
	);
	const readsAfterMissing = yield* reads;

	// `refetch` refetches the matches in use, and waits for them: mounted,
	// the list is read again, and the count's stream starts over.
	yield* AtomRegistry.mount(registry, todos);
	yield* Query.refetch(listScreen);
	const readsAfterRefetch = yield* reads;
	const countSubscriptions = yield* TodoStore.use(
		(store) => store.countSubscriptions,
	);

	// `invalidate` reaches every match, in use or not: `todo(1)` isn't, so
	// its next fetch reads the store despite its `staleTime`.
	yield* Query.fetch(todo(1));
	yield* Query.invalidate(todo);
	yield* Query.fetch(todo(1));
	const readsAfterInvalidate = yield* reads;

	return {
		listed: listed.map((item) => item.title),
		opened: Option.map(opened, (item) => item.title),
		count: { before: countBefore, after: countAfter, countSubscriptions },
		relisted: relisted.map((item) => item.title),
		missing,
		reads: {
			cached: readsCached,
			afterAdd: readsAfterAdd,
			afterMissing: readsAfterMissing,
			afterRefetch: readsAfterRefetch,
			afterInvalidate: readsAfterInvalidate,
		},
	};
}).pipe(Effect.scoped);

/**
 * The program with a client of its own, disposed when it ends. Layers given
 * to one `provide` share their builds, so the client's queries and the
 * program use the same `TodoStore`. The client logs every failed fetch,
 * whichever query it was. Query hooks run in a fiber of their own, after
 * the fetch, so one still running when the client is disposed is cut short.
 */
export const main = program.pipe(
	Effect.provide(
		Layer.merge(
			QueryClient.layer({
				layer: TodoStoreLive,
				queries: {
					onFailure: ({ key, cause }) =>
						Effect.logWarning(
							"Fetch failed",
							key,
							String(Cause.squash(cause)),
						),
				},
			}),
			TodoStoreLive,
		),
	),
);
