import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as Schedule from "effect/Schedule";

import { describe, expectTypeOf, it } from "vitest";

import { Query, type QueryClient } from "../../src/index.js";
import { Greeting } from "../services.js";

class Unregistered extends Context.Service<
	Unregistered,
	{ readonly value: number }
>()("test/Unregistered") {}

class NotFound {
	readonly _tag = "NotFound";
}

describe("Query.make", () => {
	it("infers the value and the error from run", () => {
		const todo = Query.make({
			key: ["todo"],
			run: Effect.fail(new NotFound()).pipe(Effect.as({ title: "" })),
		});

		expectTypeOf(todo).toEqualTypeOf<
			Query.Query<{ title: string }, NotFound>
		>();
	});

	it("runs with the registered services, the client and a scope", () => {
		Query.make({
			key: ["greeting"],
			run: Effect.gen(function* () {
				const { text } = yield* Greeting;
				yield* Effect.scope;
				return text;
			}),
		});
	});

	it("rejects a run that needs a service that isn't registered", () => {
		Query.make({
			key: ["unregistered"],
			// @ts-expect-error Unregistered isn't one of the client's services
			run: Unregistered.useSync(({ value }) => value),
		});
	});

	it("reads other queries through the run context", () => {
		const me = Query.make({ key: ["me"], run: Effect.succeed({ id: 1 }) });
		const mine = Query.make({
			key: ["todos", "mine"],
			run: (ctx) => Effect.map(ctx.result(me), (user) => [user.id]),
		});

		expectTypeOf(mine).toEqualTypeOf<Query.Query<Array<number>, never>>();
	});
});

describe("retry", () => {
	it("takes a schedule for the query's error", () => {
		const onNotFound = Schedule.recurs(2) as Schedule.Schedule<
			number,
			NotFound
		>;
		Query.make({
			key: ["retried"],
			run: Effect.fail(new NotFound()),
			retry: onNotFound,
		});
		Query.make({
			key: ["retried"],
			run: Effect.fail(new NotFound()),
			retry: Schedule.recurs(2),
		});
		Query.make({
			key: ["retried"],
			// @ts-expect-error the schedule takes NotFound, not "timeout"
			run: Effect.fail("timeout" as const),
			retry: onNotFound,
		});
	});
});

describe("Query.family", () => {
	it("infers the argument, the value and the error", () => {
		const todo = Query.family({
			key: ["todos", "detail"],
			run: (id: number) =>
				id > 0 ? Effect.succeed({ id }) : Effect.fail(new NotFound()),
		});

		expectTypeOf(todo).parameter(0).toEqualTypeOf<number>();
		expectTypeOf(todo(1)).toEqualTypeOf<
			Query.Query<{ id: number }, NotFound>
		>();
	});
});

describe("Query.isQuery", () => {
	it("narrows an unknown value to a query", () => {
		const value: unknown = null;
		if (Query.isQuery(value)) {
			expectTypeOf(value).toEqualTypeOf<Query.Query<unknown, unknown>>();
		}
	});
});

describe("a query is an atom", () => {
	const todos = Query.make({
		key: ["todos"],
		run: Effect.succeed<ReadonlyArray<string>>([]),
	});

	it("works with Atom.map", () => {
		const count = Atom.map(
			todos,
			AsyncResult.map((list) => list.length),
		);

		expectTypeOf(count).toEqualTypeOf<
			Atom.Writable<
				AsyncResult.AsyncResult<number, never>,
				ReadonlyArray<string>
			>
		>();
	});

	it("is written with a value", () => {
		expectTypeOf(todos).toExtend<
			Atom.Writable<
				AsyncResult.AsyncResult<ReadonlyArray<string>, never>,
				ReadonlyArray<string>
			>
		>();
	});
});

describe("the cache API", () => {
	const todo = Query.family({
		key: ["todos", "detail"],
		run: (id: number) =>
			id > 0 ? Effect.succeed({ id }) : Effect.fail(new NotFound()),
	});

	it("fetch has the query's value and error, and needs the client", () => {
		expectTypeOf(Query.fetch(todo(1))).toEqualTypeOf<
			Effect.Effect<{ id: number }, NotFound, QueryClient.QueryClient>
		>();
		expectTypeOf(Query.prefetch(todo(1))).toEqualTypeOf<
			Effect.Effect<void, never, QueryClient.QueryClient>
		>();
	});

	it("get, set and update are typed by the query's value", () => {
		expectTypeOf(Query.get(todo(1))).toEqualTypeOf<
			Effect.Effect<
				Option.Option<{ id: number }>,
				never,
				QueryClient.QueryClient
			>
		>();
		expectTypeOf([
			Query.set(todo(1), { id: 1 }),
			Query.update(todo(1), (value) => ({ id: value.id + 1 })),
		]).items.toEqualTypeOf<
			Effect.Effect<void, never, QueryClient.QueryClient>
		>();
		// @ts-expect-error the value must be the query's
		expectTypeOf(Query.set(todo(1), { title: "" }));
	});

	it("targets a query, a family or a key", () => {
		expectTypeOf([
			Query.invalidate(todo(1)),
			Query.invalidate(todo),
			Query.invalidate(["todos", "detail", 1]),
			Query.refetch(todo),
			Query.reset(["todos"]),
		]).items.toEqualTypeOf<
			Effect.Effect<void, never, QueryClient.QueryClient>
		>();
		// @ts-expect-error a key is an array
		expectTypeOf(Query.invalidate("todos"));
	});

	it("targets a query or a family that never succeeds", () => {
		const failing = Query.make({ key: ["failing"], run: Effect.fail("no") });
		const failingFamily = Query.family({
			key: ["failing"],
			run: (id: number) => Effect.fail(id),
		});

		expectTypeOf([
			Query.invalidate(failing),
			Query.refetch(failingFamily),
			Query.reset(failingFamily(1)),
		]).items.toEqualTypeOf<
			Effect.Effect<void, never, QueryClient.QueryClient>
		>();
	});
});
