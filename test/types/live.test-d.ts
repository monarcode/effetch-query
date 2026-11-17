import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import { describe, expectTypeOf, it } from "vitest";

import { Query } from "../../src/index.js";
import type { Greeting } from "../services.js";

interface Tick {
	readonly price: number;
}

class FeedError {
	readonly _tag = "FeedError";
}

declare const ticks: Stream.Stream<Tick, FeedError>;
declare const greeted: Stream.Stream<string, never, Greeting>;

describe("Query.stream", () => {
	it("takes A and E from the stream", () => {
		expectTypeOf(Query.stream({ key: ["price"], run: ticks })).toEqualTypeOf<
			Query.Query<Tick, FeedError>
		>();
		const latest = Query.make({
			key: ["latest"],
			run: null as unknown as Effect.Effect<Tick>,
		});
		expectTypeOf(
			Query.stream({
				key: ["price"],
				run: (ctx: Query.RunContext) =>
					Stream.fromEffect(ctx.result(latest)),
			}),
		).toEqualTypeOf<Query.Query<Tick, never>>();
	});

	it("runs with the registered services", () => {
		expectTypeOf(
			Query.stream({ key: ["greeting"], run: greeted }),
		).toEqualTypeOf<Query.Query<string, never>>();
	});

	it("takes a retry on its error, and no staleTime", () => {
		Query.stream({
			key: ["price"],
			run: ticks,
			retry: Schedule.spaced("1 second"),
		});
		// @ts-expect-error: a stream keeps its query current
		Query.stream({ key: ["price"], run: ticks, staleTime: "1 minute" });
	});
});

describe("Query.streamFamily", () => {
	it("takes the argument from run", () => {
		const prices = Query.streamFamily({
			key: ["price"],
			run: (symbol: string) =>
				Stream.map(ticks, (tick) => `${symbol}: ${tick.price}`),
		});
		expectTypeOf(prices).toEqualTypeOf<
			Query.Family<string, string, FeedError>
		>();
	});
});

describe("live", () => {
	it("updates the query's value", () => {
		const todos = Query.make({
			key: ["todos"],
			run: null as unknown as Effect.Effect<ReadonlyArray<string>>,
			live: Stream.make((list: ReadonlyArray<string>) => [
				...list,
				"pushed",
			]),
		});
		expectTypeOf(todos).toEqualTypeOf<
			Query.Query<ReadonlyArray<string>, never>
		>();
		Query.make({
			key: ["todos"],
			run: null as unknown as Effect.Effect<ReadonlyArray<string>>,
			// @ts-expect-error: an update returns the value's type
			live: Stream.make((list: ReadonlyArray<string>) => list.length),
		});
	});

	it("doesn't stop run's value being inferred", () => {
		const updates = Stream.make((list: ReadonlyArray<string>) => list);
		const todos = Query.make({
			key: ["todos"],
			run: Effect.as(Effect.void, ["a"] as ReadonlyArray<string>),
			live: updates,
		});
		expectTypeOf(todos).toEqualTypeOf<
			Query.Query<ReadonlyArray<string>, never>
		>();
	});

	it("takes a family member's argument", () => {
		const todo = Query.family({
			key: ["todo"],
			run: (id: number) => Effect.succeed(`todo ${id}`),
			live: (id) => Stream.make((title: string) => `${title} ${id}`),
		});
		expectTypeOf(todo).toEqualTypeOf<Query.Family<number, string, never>>();
	});
});
