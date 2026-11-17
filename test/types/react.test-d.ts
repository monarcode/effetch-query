import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { describe, expectTypeOf, it } from "vitest";

import {
	InfiniteQuery,
	Mutation,
	Query,
	type QueryClient,
} from "../../src/index.js";
import {
	type OwnedQueryProviderProps,
	QueryBoundary,
	type QueryBoundaryFailureProps,
	type QueryFailure,
	QueryProvider,
	type QueryProviderProps,
	useInfiniteQuery,
	type UseInfiniteQueryResult,
	useIsFetching,
	useIsMutating,
	useMutation,
	type UseMutationRunOptions,
	useMutationState,
	type UseMutationStateRun,
	useQueries,
	type UseQueriesResult,
	useQuery,
	useQueryClient,
	useQueryState,
	type UseQueryStateResult,
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

describe("QueryProvider", () => {
	type Props = Parameters<typeof QueryProvider>[0];
	const client = {} as QueryClient.QueryClient;

	it("takes a client you own, or a make it owns", () => {
		expectTypeOf({ client }).toExtend<Props>();
		expectTypeOf({ make: () => client }).toExtend<Props>();
		expectTypeOf({
			make: () => client,
			resetKey: "account",
		}).toExtend<Props>();
		expectTypeOf<Props>().toEqualTypeOf<
			QueryProviderProps | OwnedQueryProviderProps
		>();
	});

	it("rejects a client and a make together", () => {
		// @ts-expect-error: a provider either borrows a client or owns one
		const both: Props = { client, make: () => client };
		expectTypeOf(both).toExtend<Props>();
	});

	it("rejects a resetKey without make", () => {
		// @ts-expect-error: only an owned client is reset
		const keyed: Props = { client, resetKey: "account" };
		expectTypeOf(keyed).toExtend<Props>();
	});
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

	it("returns the selection's AsyncResult with select", () => {
		expectTypeOf(
			useQuery(todo(1), { select: (value) => String(value.id) }),
		).toEqualTypeOf<AsyncResult.AsyncResult<string, Missing>>();
		expectTypeOf(
			useQuery(
				null as typeof todo extends (id: number) => infer Q
					? Q | null
					: never,
				{
					keepPrevious: true,
					select: (value) => value.id > 0,
				},
			),
		).toEqualTypeOf<AsyncResult.AsyncResult<boolean, Missing>>();
	});

	it("checks select against the query's value", () => {
		// @ts-expect-error: the value has no title
		useQuery(todo(1), { select: (value) => value.title });
	});
});

describe("useQueryState", () => {
	it("narrows data, error and cause by status", () => {
		const state = useQueryState(todo(1));
		expectTypeOf(state).toEqualTypeOf<
			UseQueryStateResult<{ id: number }, Missing>
		>();
		expectTypeOf(state.data).toEqualTypeOf<{ id: number } | undefined>();
		expectTypeOf(state.refetch).toEqualTypeOf<() => Promise<void>>();
		if (state.status === "success") {
			expectTypeOf(state.data).toEqualTypeOf<{ id: number }>();
			expectTypeOf(state.error).toEqualTypeOf<undefined>();
			expectTypeOf(state.result).toEqualTypeOf<
				AsyncResult.Success<{ id: number }, Missing>
			>();
		}
		if (state.isFailure) {
			expectTypeOf(state.error).toEqualTypeOf<Missing | undefined>();
			expectTypeOf(state.cause).toEqualTypeOf<Cause.Cause<Missing>>();
		}
		if (state.isPending) {
			expectTypeOf(state.data).toEqualTypeOf<undefined>();
		}
	});

	it("has isPlaceholder only on a success", () => {
		const state = useQueryState(todo(1));
		expectTypeOf(state.isPlaceholder).toEqualTypeOf<boolean>();
		if (state.status === "success") {
			expectTypeOf(state.isPlaceholder).toEqualTypeOf<boolean>();
		} else {
			expectTypeOf(state.isPlaceholder).toEqualTypeOf<false>();
		}
	});

	it("takes select and null", () => {
		expectTypeOf(
			useQueryState(Math.random() > 0.5 ? todo(1) : null, {
				select: (value) => value.id,
			}),
		).toEqualTypeOf<UseQueryStateResult<number, Missing>>();
	});
});

describe("QueryBoundary", () => {
	type Props = Parameters<typeof QueryBoundary>[0];

	it("takes pending and a failure renderer", () => {
		expectTypeOf({
			pending: "Loading…",
			failure: ({ error, retry }: QueryBoundaryFailureProps) =>
				`${String(error)} ${typeof retry}`,
		}).toExtend<Props>();
		expectTypeOf<QueryBoundaryFailureProps["cause"]>().toEqualTypeOf<
			Cause.Cause<unknown>
		>();
	});

	it("needs failure", () => {
		// @ts-expect-error: a boundary must say what a failure shows
		const props: Props = { pending: "Loading…" };
		expectTypeOf(props).toExtend<Props>();
	});
});

describe("useSuspenseQuery", () => {
	it("returns the selection's Success with select", () => {
		expectTypeOf(
			useSuspenseQuery(todo(1), { select: (value) => value.id }),
		).toEqualTypeOf<AsyncResult.Success<number, Missing>>();
	});

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

	it("types variables by the mutation, undefined before a run", () => {
		const rename = Mutation.make({
			run: (title: string) => Effect.succeed(title.length),
		});

		expectTypeOf(useMutation(rename).variables).toEqualTypeOf<
			string | undefined
		>();
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

describe("useMutationState", () => {
	it("lists runs typed by the mutation", () => {
		const rename = Mutation.make({
			run: (title: string) =>
				title === "" ? Effect.fail(new Missing()) : Effect.succeed(1),
		});
		const runs = useMutationState(rename);

		expectTypeOf(runs).toEqualTypeOf<
			ReadonlyArray<UseMutationStateRun<string, number, Missing>>
		>();
		expectTypeOf(runs[0]!.variables).toEqualTypeOf<string>();
		expectTypeOf(runs[0]!.result).toEqualTypeOf<
			AsyncResult.AsyncResult<number, Missing>
		>();
	});
});

describe("useIsFetching and useIsMutating", () => {
	it("count, with or without a target", () => {
		const rename = Mutation.make({
			run: (title: string) => Effect.succeed(title),
		});
		const signOut = Mutation.make({ run: () => Effect.void });

		expectTypeOf(useIsFetching()).toEqualTypeOf<number>();
		expectTypeOf(useIsFetching(["todos"])).toEqualTypeOf<number>();
		expectTypeOf(useIsFetching(todo)).toEqualTypeOf<number>();
		expectTypeOf(useIsFetching(todo(1))).toEqualTypeOf<number>();
		expectTypeOf(useIsMutating()).toEqualTypeOf<number>();
		expectTypeOf(useIsMutating(rename)).toEqualTypeOf<number>();
		expectTypeOf(useIsMutating(signOut)).toEqualTypeOf<number>();
	});

	it("takes only a mutation", () => {
		// @ts-expect-error: a query isn't a mutation
		useIsMutating(todo(1));
	});
});

describe("useQueries", () => {
	const me = Query.make({ key: ["me"], run: Effect.succeed("Ada") });

	it("types a tuple of queries by position", () => {
		const results = useQueries([me, todo(1), null]);

		expectTypeOf(results).toEqualTypeOf<
			readonly [
				AsyncResult.AsyncResult<string, never>,
				AsyncResult.AsyncResult<{ id: number }, Missing>,
				AsyncResult.AsyncResult<never, never>,
			]
		>();
	});

	it("types an array of queries, of any length", () => {
		const ids: ReadonlyArray<number> = [1, 2];
		const results = useQueries(ids.map((id) => todo(id)));

		expectTypeOf(results).toEqualTypeOf<
			ReadonlyArray<AsyncResult.AsyncResult<{ id: number }, Missing>>
		>();
		expectTypeOf(AsyncResult.all(results)).toEqualTypeOf<
			AsyncResult.AsyncResult<Array<{ id: number }>, Missing>
		>();
	});

	it("types an entry that may be null by its query", () => {
		const maybe = Math.random() > 0.5 ? me : null;

		expectTypeOf(useQueries([maybe])).toEqualTypeOf<
			readonly [AsyncResult.AsyncResult<string, never>]
		>();
		expectTypeOf<UseQueriesResult<readonly []>>().toEqualTypeOf<
			readonly []
		>();
	});

	it("types an array of different queries by the union of their results", () => {
		const count = Query.make({ key: ["count"], run: Effect.succeed(1) });
		const both: ReadonlyArray<typeof me | typeof count> = [me, count];

		expectTypeOf(useQueries(both)).toEqualTypeOf<
			ReadonlyArray<
				| AsyncResult.AsyncResult<string, never>
				| AsyncResult.AsyncResult<number, never>
			>
		>();
		expectTypeOf(
			useQueries([Math.random() > 0.5 ? me : count]),
		).toEqualTypeOf<
			readonly [
				| AsyncResult.AsyncResult<string, never>
				| AsyncResult.AsyncResult<number, never>,
			]
		>();
	});

	it("takes only queries", () => {
		// @ts-expect-error a key isn't a query
		useQueries([["todos"]]);
	});
});

describe("paused", () => {
	it("is an option of the reading hooks", () => {
		expectTypeOf(useQuery(todo(1), { paused: true })).toEqualTypeOf<
			AsyncResult.AsyncResult<{ id: number }, Missing>
		>();
		useQueryState(todo(1), { paused: false });
		useQueries([todo(1)], { paused: true });
	});
});
