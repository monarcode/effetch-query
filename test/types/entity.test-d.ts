import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { describe, expectTypeOf, it } from "vitest";

import { endpoints } from "../../src/effetch/index.js";
import { Entity, type QueryClient } from "../../src/index.js";
import { TestApi } from "../services.js";

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
		const api = endpoints(TestApi);
		api.query(Fetch.endpoint("GET /todos/:id", { output: Todo }), {
			placeholder: ({ params }) => Entity.get(Todos, Number(params.id)),
		});
	});
});
