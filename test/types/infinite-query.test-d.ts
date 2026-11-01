import * as Effect from "effect/Effect";

import { describe, expectTypeOf, it } from "vitest";

import { InfiniteQuery, Query, type QueryClient } from "../../src/index.js";

class NotFound {
	readonly _tag = "NotFound";
}

interface Page {
	readonly items: ReadonlyArray<string>;
	readonly nextCursor: string | null;
}

declare const loadPage: (
	cursor: string | null,
) => Effect.Effect<Page, NotFound>;

describe("InfiniteQuery.make", () => {
	it("infers the page, the error and the page param", () => {
		const feed = InfiniteQuery.make({
			key: ["feed"],
			initialPageParam: null as string | null,
			run: (cursor) => loadPage(cursor),
			nextPageParam: (last) => last.nextCursor,
		});

		expectTypeOf(feed).toEqualTypeOf<
			InfiniteQuery.InfiniteQuery<Page, NotFound, string | null>
		>();
		expectTypeOf(feed).toExtend<
			Query.Query<InfiniteQuery.InfiniteData<Page, string | null>, NotFound>
		>();
	});

	it("takes the page param's type from initialPageParam alone", () => {
		const numbers = InfiniteQuery.make({
			key: ["numbers"],
			initialPageParam: 0,
			run: (page) => Effect.succeed([page]),
			nextPageParam: (_, __, page) => (page < 9 ? page + 1 : undefined),
			previousPageParam: (_, __, page) => (page > 0 ? page - 1 : null),
		});

		expectTypeOf(numbers).toEqualTypeOf<
			InfiniteQuery.InfiniteQuery<Array<number>, never, number>
		>();
	});

	it("rejects a page param of another type", () => {
		InfiniteQuery.make({
			key: ["numbers"],
			initialPageParam: 0,
			run: (page) => Effect.succeed([page]),
			// @ts-expect-error a string isn't the page param
			nextPageParam: () => "next",
		});
	});
});

describe("InfiniteQuery.family", () => {
	it("infers the argument from run, and is a query family", () => {
		const pages = InfiniteQuery.family({
			key: ["todos", "pages"],
			initialPageParam: 0,
			run: (params: { readonly limit: number }, skip) =>
				Effect.succeed({ skip, limit: params.limit }),
			nextPageParam: (last) => last.skip + last.limit,
		});

		expectTypeOf(pages({ limit: 20 })).toEqualTypeOf<
			InfiniteQuery.InfiniteQuery<
				{ skip: number; limit: number },
				never,
				number
			>
		>();
		expectTypeOf(pages).toExtend<Query.Target>();
	});
});

describe("fetchNextPage and fetchPreviousPage", () => {
	it("return the data and fail with the query's error", () => {
		const feed = InfiniteQuery.make({
			key: ["feed"],
			initialPageParam: null as string | null,
			run: (cursor) => loadPage(cursor),
			nextPageParam: (last) => last.nextCursor,
		});

		expectTypeOf(InfiniteQuery.fetchNextPage(feed)).toEqualTypeOf<
			Effect.Effect<
				InfiniteQuery.InfiniteData<Page, string | null>,
				NotFound,
				QueryClient.QueryClient
			>
		>();
		expectTypeOf(InfiniteQuery.fetchPreviousPage(feed)).toEqualTypeOf<
			Effect.Effect<
				InfiniteQuery.InfiniteData<Page, string | null>,
				NotFound,
				QueryClient.QueryClient
			>
		>();
	});
});

describe("Query.update on a family", () => {
	it("gives the updater each member's value and argument", () => {
		const todos = Query.family({
			key: ["todos", "list"],
			run: (
				filter: "all" | "open",
			): Effect.Effect<ReadonlyArray<{ readonly id: number }>> =>
				Effect.succeed([{ id: filter.length }]),
		});

		const update = Query.update(todos, (list, filter) => {
			expectTypeOf(list).toEqualTypeOf<
				ReadonlyArray<{ readonly id: number }>
			>();
			expectTypeOf(filter).toEqualTypeOf<"all" | "open">();
			return list;
		});
		expectTypeOf(update).toEqualTypeOf<
			Effect.Effect<void, never, QueryClient.QueryClient>
		>();
		// @effect-diagnostics-next-line floatingEffect:off
		// @ts-expect-error the updater returns the member's value
		Query.update(todos, () => 1);
	});

	it("gives an infinite family's updater its InfiniteData", () => {
		const pages = InfiniteQuery.family({
			key: ["pages"],
			initialPageParam: 0,
			run: (size: number, page) => Effect.succeed({ page, size }),
			nextPageParam: (last) => last.page + 1,
		});

		const update = Query.update(pages, (data, size) => {
			expectTypeOf(data).toEqualTypeOf<
				InfiniteQuery.InfiniteData<{ page: number; size: number }, number>
			>();
			expectTypeOf(size).toEqualTypeOf<number>();
			return data;
		});
		expectTypeOf(update).toEqualTypeOf<
			Effect.Effect<void, never, QueryClient.QueryClient>
		>();
	});
});
