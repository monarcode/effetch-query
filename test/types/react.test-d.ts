import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import type * as AsyncResult from "effect/reactivity/AsyncResult";

import { describe, expectTypeOf, it } from "vitest";

import {
	InfiniteQuery,
	Mutation,
	Query,
	type QueryClient,
} from "../../src/index.js";
import {
	type QueryFailure,
	useInfiniteQuery,
	type UseInfiniteQueryResult,
	useMutation,
	type UseMutationRunOptions,
	useQuery,
	useQueryClient,
	useRefetch,
	useResetQueryFailure,
	useSuspenseInfiniteQuery,
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
			(
				variables: string,
				options?: UseMutationRunOptions<string, number, never> | undefined,
			) => Promise<Exit.Exit<number, never>>
		>();
		expectTypeOf(reset).toEqualTypeOf<() => void>();
		// @ts-expect-error: the variables are a string
		void run(1);
	});

	it("runs a mutation without variables with no argument", () => {
		const signOut = Mutation.make({ run: () => Effect.void });

		void useMutation(signOut).run();
		void useMutation(signOut).run(undefined, { onSuccess: () => {} });
	});

	it("types a run's callbacks by the mutation", () => {
		const save = Mutation.make({
			run: (title: string) =>
				title === ""
					? Effect.fail(new Missing())
					: Effect.succeed(title.length),
		});

		void useMutation(save).run("a", {
			onSuccess: (value, variables) => {
				expectTypeOf(value).toEqualTypeOf<number>();
				expectTypeOf(variables).toEqualTypeOf<string>();
			},
			onFailure: (cause) => {
				expectTypeOf(cause).toEqualTypeOf<Cause.Cause<Missing>>();
			},
			onSettled: (exit) => {
				expectTypeOf(exit).toEqualTypeOf<Exit.Exit<number, Missing>>();
			},
		});
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

describe("useInfiniteQuery and useSuspenseInfiniteQuery", () => {
	const pages = InfiniteQuery.make({
		key: ["pages"],
		initialPageParam: 0,
		run: (page: number) =>
			page < 0 ? Effect.fail(new Missing()) : Effect.succeed([page]),
		nextPageParam: (_, __, page) => page + 1,
	});

	it("returns the pages' AsyncResult with the page controls, also for null", () => {
		expectTypeOf(useInfiniteQuery(pages)).toEqualTypeOf<
			UseInfiniteQueryResult<Array<number>, Missing, number>
		>();
		expectTypeOf(useInfiniteQuery(pages).result).toEqualTypeOf<
			AsyncResult.AsyncResult<
				InfiniteQuery.InfiniteData<Array<number>, number>,
				Missing
			>
		>();
		expectTypeOf(
			useInfiniteQuery(Math.random() > 0.5 ? pages : null),
		).toEqualTypeOf<UseInfiniteQueryResult<Array<number>, Missing, number>>();
		expectTypeOf(useInfiniteQuery(pages).fetchNextPage).toEqualTypeOf<
			() => Promise<void>
		>();
	});

	it("useSuspenseInfiniteQuery returns a Success", () => {
		expectTypeOf(useSuspenseInfiniteQuery(pages).result).toEqualTypeOf<
			AsyncResult.Success<
				InfiniteQuery.InfiniteData<Array<number>, number>,
				Missing
			>
		>();
	});

	it("takes only infinite queries", () => {
		// @ts-expect-error a plain query has no pages
		useInfiniteQuery(todo(1));
	});
});
