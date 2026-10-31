import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import type * as AsyncResult from "effect/reactivity/AsyncResult";

import { describe, expectTypeOf, it } from "vitest";

import { Mutation, Query, type QueryClient } from "../../src/index.js";
import {
	type QueryFailure,
	useMutation,
	useQuery,
	useQueryClient,
	useRefetch,
	useResetQueryFailure,
	useSuspenseQuery,
} from "../../src/react/index.js";

class Missing {
	readonly _tag = "Missing";
}

const todo = Query.family({
	key: ["todos", "detail"],
	run: (id: number) =>
		id === 0 ? Effect.fail(new Missing()) : Effect.succeed({ id }),
});

describe("useQuery", () => {
	it("returns the query's AsyncResult, also for null", () => {
		expectTypeOf(useQuery(todo(1))).toEqualTypeOf<
			AsyncResult.AsyncResult<{ id: number }, Missing>
		>();
		expectTypeOf(
			useQuery(Math.random() > 0.5 ? todo(1) : null, { keepPrevious: true }),
		).toEqualTypeOf<AsyncResult.AsyncResult<{ id: number }, Missing>>();
	});
});

describe("useSuspenseQuery", () => {
	it("returns a Success", () => {
		expectTypeOf(useSuspenseQuery(todo(1))).toEqualTypeOf<
			AsyncResult.Success<{ id: number }, Missing>
		>();
	});

	it("doesn't take null", () => {
		// @ts-expect-error: suspense always reads a query
		useSuspenseQuery(null);
	});
});

describe("useMutation", () => {
	it("types run by the mutation's variables", () => {
		const rename = Mutation.make({
			run: (title: string) => Effect.succeed(title.length),
		});
		const { result, run, reset } = useMutation(rename);

		expectTypeOf(result).toEqualTypeOf<
			AsyncResult.AsyncResult<number, never>
		>();
		expectTypeOf(run).toEqualTypeOf<
			(variables: string) => Promise<Exit.Exit<number, never>>
		>();
		expectTypeOf(reset).toEqualTypeOf<() => void>();
		// @ts-expect-error: the variables are a string
		void run(1);
	});

	it("runs a mutation without variables with no argument", () => {
		const signOut = Mutation.make({ run: () => Effect.void });

		void useMutation(signOut).run();
	});
});

describe("other hooks", () => {
	it("return what they say", () => {
		expectTypeOf(useQueryClient()).toEqualTypeOf<QueryClient.QueryClient>();
		expectTypeOf(useRefetch(["todos"]).refetch).toEqualTypeOf<
			() => Promise<void>
		>();
		expectTypeOf(useResetQueryFailure()).toEqualTypeOf<
			(error: unknown) => void
		>();
		expectTypeOf<QueryFailure["query"]>().toEqualTypeOf<
			Query.Query<any, any>
		>();
	});
});
