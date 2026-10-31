import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import { describe, expectTypeOf, it } from "vitest";

import { Mutation, Query, type QueryClient } from "../../src/index.js";
import { Greeting } from "../services.js";

class Unregistered extends Context.Service<
	Unregistered,
	{ readonly value: number }
>()("test/Unregistered") {}

class Rejected {
	readonly _tag = "Rejected";
}

interface Rename {
	readonly id: number;
	readonly title: string;
}

const todo = Query.family({
	key: ["todos", "detail"],
	run: (id: number) => Effect.succeed({ id, title: "" }),
});

describe("Mutation.make", () => {
	it("infers the variables, the value and the error from run", () => {
		const rename = Mutation.make({
			run: ({ id, title }: Rename) =>
				title === ""
					? Effect.fail(new Rejected())
					: Effect.succeed({ id, title }),
		});

		expectTypeOf(rename).toEqualTypeOf<
			Mutation.Mutation<Rename, { id: number; title: string }, Rejected>
		>();
	});

	it("types the other options from run", () => {
		Mutation.make({
			run: (input: Rename) => Effect.succeed(input.id),
			optimistic: (input) => {
				expectTypeOf(input).toEqualTypeOf<Rename>();
				return Query.update(todo(input.id), (t) => ({ ...t, ...input }));
			},
			onSuccess: (id, input) => {
				expectTypeOf(id).toEqualTypeOf<number>();
				expectTypeOf(input).toEqualTypeOf<Rename>();
				return Effect.void;
			},
			invalidates: (id) => [todo(id), todo, ["todos"]],
			retry: Schedule.recurs(1),
			concurrent: false,
		});
	});

	it("runs with the registered services and the client", () => {
		Mutation.make({
			run: () => Greeting.useSync(({ text }) => text),
			onSettled: () => Query.invalidate(["todos"]),
		});
	});

	it("rejects a run that needs a service that isn't registered", () => {
		Mutation.make({
			// @effect-diagnostics-next-line missingEffectContext:off
			// @ts-expect-error Unregistered isn't one of the client's services
			run: () => Unregistered.useSync(({ value }) => value),
		});
	});

	it("gives optimistic only the client", () => {
		Mutation.make({
			run: () => Effect.void,
			// @effect-diagnostics-next-line missingEffectContext:off
			// @ts-expect-error optimistic runs without your services
			optimistic: () => Greeting.useSync(() => undefined),
		});
	});
});

describe("Mutation.run", () => {
	it("requires the client and the services, with run's types", () => {
		const rename = Mutation.make({
			run: (input: Rename) =>
				Effect.andThen(
					Greeting.useSync(({ text }) => text + input.title),
					Effect.fail(new Rejected()),
				),
		});

		expectTypeOf(
			Mutation.run(rename, { id: 1, title: "Buy milk" }),
		).toEqualTypeOf<
			Effect.Effect<never, Rejected, QueryClient.Requirements>
		>();
	});

	it("takes no variables for a mutation of void", () => {
		const ping = Mutation.make({ run: () => Effect.succeed(1) });

		expectTypeOf(Mutation.run(ping)).toEqualTypeOf<
			Effect.Effect<number, never, QueryClient.Requirements>
		>();
	});

	it("rejects variables of the wrong type", () => {
		const double = Mutation.make({
			run: (n: number) => Effect.succeed(n * 2),
		});

		// @effect-diagnostics-next-line floatingEffect:off
		// @ts-expect-error a string isn't a number
		Mutation.run(double, "2");
	});
});

describe("client hooks", () => {
	it("receive any mutation's definition", () => {
		const double = Mutation.make({
			run: (n: number) => Effect.succeed(n * 2),
		});
		const hooks: QueryClient.MutationsOptions = {
			onSuccess: ({ mutation }) =>
				mutation === double ? Effect.log("doubled") : Effect.void,
		};

		expectTypeOf(double).toExtend<
			Mutation.Mutation<never, unknown, unknown>
		>();
		expectTypeOf(hooks).not.toBeAny();
	});
});
