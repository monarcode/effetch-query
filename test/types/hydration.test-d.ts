import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { describe, expectTypeOf, it } from "vitest";

import { InfiniteQuery, Query } from "../../src/index.js";
import type { Greeting } from "../services.js";

const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });
type Todo = typeof Todo.Type;

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
	id: Schema.Finite,
}) {}

declare const listTodos: Effect.Effect<ReadonlyArray<Todo>, NotFound>;

describe("Query schema", () => {
	it("takes schemas for the value and the error", () => {
		const todos = Query.make({
			key: ["todos"],
			run: listTodos,
			schema: { success: Schema.Array(Todo), error: NotFound },
		});

		expectTypeOf(todos).toEqualTypeOf<
			Query.Query<ReadonlyArray<Todo>, NotFound>
		>();
	});

	it("rejects a schema for another value", () => {
		Query.make({
			key: ["todos"],
			run: listTodos,
			// @ts-expect-error: the schema is for one todo, not the list
			schema: { success: Todo },
		});
	});

	it("rejects a schema that needs a service", () => {
		const Greeted: Schema.Codec<string, string, Greeting> =
			Schema.String as never;
		Query.make({
			key: ["greeting"],
			run: Effect.succeed("Ada"),
			// @ts-expect-error: decoding needs Greeting
			schema: { success: Greeted },
		});
	});

	it("types the value as the schema's, which run's value fits", () => {
		const todo = Query.family({
			key: ["todo"],
			run: (id: number) => Effect.succeed({ id, title: "" }),
			schema: { success: Todo },
		});

		expectTypeOf(todo(1)).toEqualTypeOf<Query.Query<Todo, never>>();
	});
});

describe("InfiniteQuery schema", () => {
	it("takes a page schema, and a param schema", () => {
		const Page = Schema.Struct({
			items: Schema.Array(Todo),
			next: Schema.NullOr(Schema.Finite),
		});
		const pages = InfiniteQuery.make({
			key: ["todos"],
			initialPageParam: 0,
			run: (skip: number) =>
				Effect.succeed({ items: [], next: skip < 9 ? skip + 1 : null }),
			nextPageParam: (last) => last.next,
			schema: { page: Page, pageParam: Schema.Finite },
		});

		expectTypeOf(pages).toEqualTypeOf<
			InfiniteQuery.InfiniteQuery<typeof Page.Type, never, number>
		>();
	});
});
