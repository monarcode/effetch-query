import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Schedule from "effect/Schedule";

import { afterEach, describe, expect, it } from "vitest";

import { InfiniteQuery, Mutation, Query } from "../src/index.js";
import { pageState, pagingAtom } from "../src/internal/infiniteQuery.js";
import { disposeClients, gate, makeClient, use, valueOf } from "./helpers.js";

afterEach(disposeClients);

class PageFailed {
	readonly _tag = "PageFailed";
}

interface Page {
	readonly items: ReadonlyArray<number>;
	readonly skip: number;
}

/**
 * A list served in pages of `size`, which a test can change, and the skip
 * of every page fetched. `fail` fails the next page, `hold` makes pages wait.
 */
const server = (count: number, size = 2) => {
	const state = {
		items: Array.from({ length: count }, (_, i) => i),
		fetched: [] as Array<number>,
		fail: false,
		hold: undefined as Effect.Effect<void> | undefined,
	};
	const page = (skip: number): Effect.Effect<Page, PageFailed> =>
		Effect.suspend(() => {
			state.fetched.push(skip);
			if (state.fail) {
				state.fail = false;
				return Effect.fail(new PageFailed());
			}
			const items = state.items.slice(skip, skip + size);
			return Effect.as(state.hold ?? Effect.void, { items, skip });
		});
	const pages = {
		initialPageParam: 0,
		nextPageParam: (last: Page) =>
			last.skip + size < state.items.length ? last.skip + size : undefined,
		previousPageParam: (first: Page) =>
			first.skip > 0 ? Math.max(0, first.skip - size) : null,
	};
	return { state, page, pages };
};

/** What a reader of the query shows besides its result. */
const paged = <A, E, P>(
	registry: AtomRegistry.AtomRegistry,
	query: InfiniteQuery.InfiniteQuery<A, E, P>,
) => pageState(query, registry.get(query), registry.get(pagingAtom(query)));

const items = (data: InfiniteQuery.InfiniteData<Page, number>) =>
	data.pages.flatMap((page) => page.items);

describe("InfiniteQuery", () => {
	it("fetches the first page from initialPageParam", async () => {
		const client = await makeClient();
		const { state, page, pages } = server(5);
		const list = InfiniteQuery.make({ key: ["list"], run: page, ...pages });

		const data = await valueOf(client.registry, list);

		expect(data).toEqual({
			pages: [{ items: [0, 1], skip: 0 }],
			pageParams: [0],
		});
		expect(state.fetched).toEqual([0]);
		expect(InfiniteQuery.isInfiniteQuery(list)).toBe(true);
		expect(Query.isQuery(list)).toBe(true);
	});

	it("appends the next page and prepends the previous one", async () => {
		const client = await makeClient();
		const { page, pages } = server(9);
		const list = InfiniteQuery.make({
			key: ["list"],
			run: page,
			...pages,
			initialPageParam: 4,
		});

		await client.runPromise(InfiniteQuery.fetchNextPage(list));
		const next = await client.runPromise(InfiniteQuery.fetchNextPage(list));
		expect(items(next)).toEqual([4, 5, 6, 7]);
		expect(next.pageParams).toEqual([4, 6]);

		const previous = await client.runPromise(
			InfiniteQuery.fetchPreviousPage(list),
		);
		expect(items(previous)).toEqual([2, 3, 4, 5, 6, 7]);
		expect(previous.pageParams).toEqual([2, 4, 6]);
		expect(items(await valueOf(client.registry, list))).toEqual([
			2, 3, 4, 5, 6, 7,
		]);
	});

	it("returns the data without fetching when there's no page there", async () => {
		const client = await makeClient();
		const { state, page, pages } = server(3);
		const list = InfiniteQuery.make({ key: ["list"], run: page, ...pages });
		await client.runPromise(InfiniteQuery.fetchNextPage(list));
		await client.runPromise(InfiniteQuery.fetchNextPage(list));
		expect(state.fetched).toEqual([0, 2]);

		const last = await client.runPromise(InfiniteQuery.fetchNextPage(list));
		const first = await client.runPromise(
			InfiniteQuery.fetchPreviousPage(list),
		);

		expect(items(last)).toEqual([0, 1, 2]);
		expect(first).toBe(last);
		expect(state.fetched).toEqual([0, 2]);
	});

	it("has no previous page without previousPageParam", async () => {
		const client = await makeClient();
		const { state, page, pages } = server(9);
		const list = InfiniteQuery.make({
			key: ["list"],
			run: page,
			initialPageParam: 4,
			nextPageParam: pages.nextPageParam,
		});
		await valueOf(client.registry, list);

		const data = await client.runPromise(
			InfiniteQuery.fetchPreviousPage(list),
		);

		expect(items(data)).toEqual([4, 5]);
		expect(state.fetched).toEqual([4]);
	});

	it("joins a page fetch in the same direction", async () => {
		const client = await makeClient();
		const { state, page, pages } = server(9);
		const list = InfiniteQuery.make({ key: ["list"], run: page, ...pages });
		await valueOf(client.registry, list);
		const { wait, open } = gate();
		state.hold = wait;

		const first = client.runPromise(InfiniteQuery.fetchNextPage(list));
		const second = client.runPromise(InfiniteQuery.fetchNextPage(list));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(paged(client.registry, list)).toMatchObject({
			isFetchingNextPage: true,
			isFetchingPreviousPage: false,
		});
		open();

		expect(items(await first)).toEqual([0, 1, 2, 3]);
		expect(await second).toBe(await first);
		expect(state.fetched).toEqual([0, 2]);
		expect(paged(client.registry, list)).toMatchObject({
			isFetchingNextPage: false,
			hasNextPage: true,
			hasPreviousPage: false,
		});
	});

	it("waits for a refetch before fetching its page", async () => {
		const client = await makeClient();
		const { state, page, pages } = server(9);
		const list = InfiniteQuery.make({ key: ["list"], run: page, ...pages });
		const unmount = use(client.registry, list);
		await valueOf(client.registry, list);
		const { wait, open } = gate();
		state.hold = wait;

		await client.runPromise(Query.invalidate(list));
		const more = client.runPromise(InfiniteQuery.fetchNextPage(list));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(state.fetched).toEqual([0, 0]);
		state.hold = undefined;
		open();

		expect(items(await more)).toEqual([0, 1, 2, 3]);
		expect(state.fetched).toEqual([0, 0, 2]);
		unmount();
	});

	it("on an uncached query, fetches its first page", async () => {
		const client = await makeClient();
		const { state, page, pages } = server(9);
		const list = InfiniteQuery.make({ key: ["list"], run: page, ...pages });

		const data = await client.runPromise(InfiniteQuery.fetchNextPage(list));

		expect(items(data)).toEqual([0, 1]);
		expect(state.fetched).toEqual([0]);
	});

	it("refetches every loaded page, each param from the page before", async () => {
		const client = await makeClient();
		const { state, page, pages } = server(6, 2);
		const list = InfiniteQuery.make({ key: ["list"], run: page, ...pages });
		await client.runPromise(InfiniteQuery.fetchNextPage(list));
		await client.runPromise(InfiniteQuery.fetchNextPage(list));
		await client.runPromise(InfiniteQuery.fetchNextPage(list));
		state.fetched.length = 0;
		// Two items were added at the front: the pages move along.
		state.items = [-2, -1, ...state.items];

		const unmount = client.registry.mount(list);
		await client.runPromise(Query.refetch(list));

		const data = await valueOf(client.registry, list);
		expect(items(data)).toEqual([-2, -1, 0, 1, 2, 3]);
		expect(data.pageParams).toEqual([0, 2, 4]);
		expect(state.fetched).toEqual([0, 2, 4]);
		unmount();
	});

	it("stops a refetch early when there's no next page", async () => {
		const client = await makeClient();
		const { state, page, pages } = server(6, 2);
		const list = InfiniteQuery.make({ key: ["list"], run: page, ...pages });
		await client.runPromise(InfiniteQuery.fetchNextPage(list));
		await client.runPromise(InfiniteQuery.fetchNextPage(list));
		await client.runPromise(InfiniteQuery.fetchNextPage(list));
		state.fetched.length = 0;
		state.items = [0, 1, 2];

		const data = await client.runPromise(
			Effect.andThen(Query.invalidate(list), Query.fetch(list)),
		);

		expect(items(data)).toEqual([0, 1, 2]);
		expect(state.fetched).toEqual([0, 2]);
	});

	it("is reached by invalidating a key prefix", async () => {
		const client = await makeClient();
		const { state, page, pages } = server(9);
		const todoPages = InfiniteQuery.family({
			key: ["todos", "pages"],
			run: (size: number, skip) =>
				Effect.map(page(skip), (p) => ({ ...p, size })),
			...pages,
		});
		const unmount = use(client.registry, todoPages(2));
		await valueOf(client.registry, todoPages(2));

		await client.runPromise(Query.refetch(["todos"]));

		expect(state.fetched).toEqual([0, 0]);
		expect(todoPages(2).key).toEqual(["todos", "pages", 2]);
		unmount();
	});

	it("keeps the loaded pages when a page fails, and fails fetchNextPage", async () => {
		const client = await makeClient();
		const { state, page, pages } = server(9);
		const list = InfiniteQuery.make({ key: ["list"], run: page, ...pages });
		await valueOf(client.registry, list);
		state.fail = true;

		const exit = await client.runPromiseExit(
			InfiniteQuery.fetchNextPage(list),
		);

		expect(exit).toEqual(Exit.fail(new PageFailed()));
		const result = client.registry.get(list);
		expect(AsyncResult.isFailure(result)).toBe(true);
		expect(Option.map(AsyncResult.value(result), items)).toEqual(
			Option.some([0, 1]),
		);
		const retried = await client.runPromise(
			InfiniteQuery.fetchNextPage(list),
		);
		expect(items(retried)).toEqual([0, 1, 2, 3]);
	});

	it("retries each page with the query's retry", async () => {
		const client = await makeClient();
		const { state, page, pages } = server(9);
		const list = InfiniteQuery.make({
			key: ["list"],
			run: page,
			...pages,
			retry: Schedule.recurs(1),
		});
		await valueOf(client.registry, list);
		state.fail = true;

		const data = await client.runPromise(InfiniteQuery.fetchNextPage(list));

		expect(items(data)).toEqual([0, 1, 2, 3]);
		expect(state.fetched).toEqual([0, 2, 2]);
	});

	it("drops pages from the far end past maxPages", async () => {
		const client = await makeClient();
		const { page, pages } = server(9);
		const list = InfiniteQuery.make({
			key: ["list"],
			run: page,
			...pages,
			maxPages: 2,
		});
		await client.runPromise(InfiniteQuery.fetchNextPage(list));
		await client.runPromise(InfiniteQuery.fetchNextPage(list));

		const next = await client.runPromise(InfiniteQuery.fetchNextPage(list));
		expect(items(next)).toEqual([2, 3, 4, 5]);
		expect(next.pageParams).toEqual([2, 4]);

		const previous = await client.runPromise(
			InfiniteQuery.fetchPreviousPage(list),
		);
		expect(items(previous)).toEqual([0, 1, 2, 3]);
		expect(previous.pageParams).toEqual([0, 2]);
	});

	it("starts again from the first page after a reset", async () => {
		const client = await makeClient();
		const { state, page, pages } = server(9);
		const list = InfiniteQuery.make({ key: ["list"], run: page, ...pages });
		await client.runPromise(InfiniteQuery.fetchNextPage(list));
		await client.runPromise(InfiniteQuery.fetchNextPage(list));

		await client.runPromise(Query.reset(list));

		expect(items(await valueOf(client.registry, list))).toEqual([0, 1]);
		expect(state.fetched).toEqual([0, 2, 0]);
	});

	it("runs the client's query hooks once per fetch, with every page", async () => {
		const seen: Array<unknown> = [];
		const client = await makeClient({
			queries: {
				onSuccess: ({ key, value }) =>
					Effect.sync(() => {
						if (key[0] === "list") {
							seen.push(value);
						}
					}),
			},
		});
		const { page, pages } = server(9);
		const list = InfiniteQuery.make({ key: ["list"], run: page, ...pages });
		await valueOf(client.registry, list);

		await client.runPromise(InfiniteQuery.fetchNextPage(list));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(
			seen.map((data) =>
				items(data as InfiniteQuery.InfiniteData<Page, number>),
			),
		).toEqual([
			[0, 1],
			[0, 1, 2, 3],
		]);
	});

	it("writes pages optimistically and puts them back on failure", async () => {
		const client = await makeClient();
		const { page, pages } = server(9);
		const list = InfiniteQuery.make({ key: ["list"], run: page, ...pages });
		await client.runPromise(InfiniteQuery.fetchNextPage(list));
		await client.runPromise(InfiniteQuery.fetchNextPage(list));
		const hide = Mutation.make({
			run: (item: number) => Effect.as(Effect.fail(new PageFailed()), item),
			optimistic: (hidden) =>
				Query.update(list, (data) => ({
					...data,
					pages: data.pages.map((p) => ({
						...p,
						items: p.items.filter((item) => item !== hidden),
					})),
				})),
		});
		const shown: Array<ReadonlyArray<number>> = [];
		client.registry.subscribe(list, (result) =>
			Option.map(AsyncResult.value(result), (data) =>
				shown.push(items(data)),
			),
		);

		await client.runPromiseExit(Mutation.run(hide, 2));

		expect(shown).toEqual([
			[0, 1, 3],
			[0, 1, 2, 3],
		]);
		const more = await client.runPromise(InfiniteQuery.fetchNextPage(list));
		expect(items(more)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it("fetches the next page from data written over the fetched one", async () => {
		const client = await makeClient();
		const { page, pages } = server(9);
		const list = InfiniteQuery.make({ key: ["list"], run: page, ...pages });
		await valueOf(client.registry, list);
		await client.runPromise(
			Query.set(list, {
				pages: [{ items: [4, 5], skip: 4 }],
				pageParams: [4],
			}),
		);

		const data = await client.runPromise(InfiniteQuery.fetchNextPage(list));

		expect(items(data)).toEqual([4, 5, 6, 7]);
		expect(data.pageParams).toEqual([4, 6]);
	});
});

describe("Query.update on a family", () => {
	const todoFamilies = () => {
		const lists = Query.family({
			key: ["todos", "list"],
			run: (filter: string) =>
				Effect.succeed([
					{ id: 1, done: false, filter },
					{ id: 2, done: false, filter },
				]),
		});
		const counts = Query.family({
			key: ["todos", "list", "count"],
			run: (filter: string) => Effect.succeed(filter.length),
		});
		return { lists, counts };
	};

	it("writes every cached member with its argument, and creates none", async () => {
		const client = await makeClient();
		const { lists, counts } = todoFamilies();
		await valueOf(client.registry, lists("all"));
		await valueOf(client.registry, lists("open"));
		await valueOf(client.registry, counts("all"));
		const seen: Array<string> = [];

		await client.runPromise(
			Query.update(lists, (list, filter) => {
				seen.push(filter);
				return list.map((todo) =>
					todo.id === 1 ? { ...todo, done: true } : todo,
				);
			}),
		);

		expect(seen.sort()).toEqual(["all", "open"]);
		for (const filter of ["all", "open"]) {
			const list = await client.runPromise(Query.get(lists(filter)));
			expect(
				Option.map(list, (todos) => todos.map((todo) => todo.done)),
			).toEqual(Option.some([true, false]));
		}
		expect(await client.runPromise(Query.get(counts("all")))).toEqual(
			Option.some(3),
		);
		expect(await client.runPromise(Query.get(lists("done")))).toEqual(
			Option.none(),
		);
		expect(client.registry.getNodes().has(lists("done"))).toBe(false);
	});

	it("puts every member back when the mutation fails, newest first", async () => {
		const client = await makeClient();
		const { lists } = todoFamilies();
		await valueOf(client.registry, lists("all"));
		await valueOf(client.registry, lists("open"));
		const complete = Mutation.make({
			run: (item: number) => Effect.as(Effect.fail(new PageFailed()), item),
			optimistic: (id) =>
				Query.update(lists, (list) =>
					list.map((todo) =>
						todo.id === id ? { ...todo, done: true } : todo,
					),
				),
		});
		const done = async (filter: string) =>
			Option.map(
				await client.runPromise(Query.get(lists(filter))),
				(todos) => todos.map((todo) => todo.done),
			);

		const exit = await client.runPromiseExit(Mutation.run(complete, 2));

		expect(Exit.isFailure(exit)).toBe(true);
		expect(await done("all")).toEqual(Option.some([false, false]));
		expect(await done("open")).toEqual(Option.some([false, false]));
	});

	it("writes every cached member of an infinite family", async () => {
		const client = await makeClient();
		const { page, pages } = server(9);
		const family = InfiniteQuery.family({
			key: ["pages"],
			run: (_: string, skip) => page(skip),
			...pages,
		});
		await valueOf(client.registry, family("a"));

		await client.runPromise(
			Query.update(family, (data, name) => ({
				...data,
				pages: data.pages.map((p) => ({ ...p, items: [name.length] })),
			})),
		);

		const data = await valueOf(client.registry, family("a"));
		expect(items(data)).toEqual([1]);
	});
});
