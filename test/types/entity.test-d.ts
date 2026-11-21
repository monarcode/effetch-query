import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { Fetch } from "@monarcode/effetch";
import { describe, expectTypeOf, it } from "vitest";

import { fromClient } from "../../src/effetch/index.js";
import { Entity, InfiniteQuery, Query, QueryClient } from "../../src/index.js";
import { servicesLayer, TestApi } from "../services.js";

const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });
type Todo = typeof Todo.Type;

class TodoClass extends Schema.Class<TodoClass>("TodoClass")({
	id: Schema.String,
}) {}

describe("Entity.make", () => {
	it("takes the value from the schema and the id from the function", () => {
		expectTypeOf(Entity.make(Todo, { id: (todo) => todo.id })).toEqualTypeOf<
			Entity.Entity<Todo, number>
		>();
		expectTypeOf(
			Entity.make(TodoClass, { id: (todo) => todo.id }),
		).toEqualTypeOf<Entity.Entity<TodoClass, string>>();
	});
});

describe("Entity.Entity", () => {
	it("is made by Entity.make only", () => {
		// @ts-expect-error: it lacks the TypeId only make sets
		const hand: Entity.Entity<Todo, number> = {
			schema: Todo,
			id: (todo: Todo) => todo.id,
		};
		expectTypeOf(hand).not.toBeNever();
	});

	it("isEntity narrows", () => {
		const value: unknown = Entity.make(Todo, { id: (todo) => todo.id });
		if (Entity.isEntity(value)) {
			expectTypeOf(value).toEqualTypeOf<Entity.Entity<unknown, unknown>>();
		}
	});
});

describe("writes and reads", () => {
	const Todos = Entity.make(Todo, { id: (todo) => todo.id });

	it("type the id by the entity's, without widening it", () => {
		expectTypeOf(
			Entity.update(Todos, 1, (todo) => ({ ...todo, title: "x" })),
		).toEqualTypeOf<Effect.Effect<void, never, QueryClient.QueryClient>>();
		const wrong = [
			// @ts-expect-error: the id is a number
			Entity.update(Todos, "1", (todo) => todo),
			// @ts-expect-error: the id is a number
			Entity.remove(Todos, "1"),
			// @ts-expect-error: the id is a number
			Entity.get(Todos, "1"),
		];
		expectTypeOf(wrong).not.toBeNever();
	});

	it("type the value", () => {
		const writes = [
			Entity.set(Todos, { id: 1, title: "x" }),
			// @ts-expect-error: title is missing
			Entity.set(Todos, { id: 1 }),
			// @ts-expect-error: f returns a Todo
			Entity.update(Todos, 1, () => ({ id: 1 })),
		];
		expectTypeOf(writes).not.toBeNever();
		expectTypeOf(Entity.get(Todos, 1)).toEqualTypeOf<
			Effect.Effect<Option.Option<Todo>, never, QueryClient.QueryClient>
		>();
	});

	it("fit a placeholder, with the route's id converted", () => {
		const api = fromClient(TestApi);
		api.query(Fetch.endpoint("GET /todos/:id", { output: Todo }), {
			placeholder: ({ params }) => Entity.get(Todos, Number(params.id)),
		});
	});
});

describe("entity sync", () => {
	const Todos = Entity.make(Todo, { id: (todo) => todo.id });
	const Ids = Entity.make(TodoClass, { id: (todo) => todo.id });

	it("takes the client's entities, of any types", () => {
		QueryClient.make({
			layer: servicesLayer("hello"),
			entities: { sync: [Todos, Ids] },
		});
		expectTypeOf<QueryClient.EntitiesOptions["sync"]>().toEqualTypeOf<
			ReadonlyArray<Entity.Entity<any, any>> | undefined
		>();
		QueryClient.make({
			layer: servicesLayer("hello"),
			// @ts-expect-error: an entity, not its schema
			entities: { sync: [Todo] },
		});
	});

	it("is opted out of on queries that fetch, not on stream queries", () => {
		const run = Effect.succeed({ id: 1, title: "x" });
		Query.make({ key: ["a"], run, entities: { sync: false } });
		Query.family({
			key: ["b"],
			run: (id: number) => Effect.succeed({ id, title: "x" }),
			entities: { sync: false },
		});
		InfiniteQuery.make({
			key: ["c"],
			run: (page: number) => Effect.succeed({ id: page, title: "x" }),
			initialPageParam: 0,
			nextPageParam: () => null,
			entities: { sync: false },
		});
		fromClient(TestApi).query(
			Fetch.endpoint("GET /todos/:id", { output: Todo }),
			{ entities: { sync: false } },
		);
		expectTypeOf<Query.Options<never>["entities"]>().toEqualTypeOf<
			Query.EntitiesOptions | undefined
		>();
		Query.stream({
			key: ["d"],
			run: Stream.make(1),
			// @ts-expect-error: a stream query's elements aren't synced
			entities: { sync: false },
		});
	});
});
