// @vitest-environment happy-dom
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as AsyncResult from "effect/reactivity/AsyncResult";

import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InfiniteQuery, Query, QueryClient } from "../src/index.js";
import { isInUse } from "../src/internal/usage.js";
import {
	QueryProvider,
	useInfiniteQuery,
	useQueries,
	useQuery,
	useQueryState,
	type UseQueryStateResult,
	useSuspenseQuery,
} from "../src/react/index.js";
import {
	disposeClients,
	gate,
	makeClient,
	manualSignals,
	show,
	tracked,
} from "./helpers.js";

afterEach(async () => {
	cleanup();
	vi.useRealTimers();
	await disposeClients();
});

const withClient = (client: QueryClient.QueryClient, node: React.ReactNode) => (
	<QueryProvider client={client}>{node}</QueryProvider>
);

const text = (label = "result") => screen.getByTestId(label).textContent;

const showAll = (results: ReadonlyArray<AsyncResult.AsyncResult<any, any>>) =>
	results.map(show).join(" | ");

/** A family whose members count their fetches. */
const counted = (options?: Query.Options<never>) => {
	const fetches = new Map<number, number>();
	const todo = Query.family({
		...options,
		key: ["todo"],
		run: (id: number) =>
			Effect.sync(() => {
				fetches.set(id, (fetches.get(id) ?? 0) + 1);
				return id * 10;
			}),
	});
	return { todo, fetches: (id: number) => fetches.get(id) ?? 0 };
};

describe("useQueries", () => {
	it("reads a list that grows and shrinks, in order", async () => {
		const client = await makeClient();
		const { todo, fetches } = counted();
		let setIds: (ids: ReadonlyArray<number>) => void = () => {};
		const List = () => {
			const [ids, set] = React.useState<ReadonlyArray<number>>([1, 2]);
			setIds = set;
			const results = useQueries(ids.map((id) => todo(id)));
			return <p data-testid="result">{showAll(results)}</p>;
		};
		render(withClient(client, <List />));
		await act(async () => {});
		expect(text()).toBe("Success 10 | Success 20");

		await act(async () => setIds([1, 2, 3]));
		expect(text()).toBe("Success 10 | Success 20 | Success 30");
		await act(async () => setIds([3]));

		expect(text()).toBe("Success 30");
		expect([fetches(1), fetches(2), fetches(3)]).toEqual([1, 1, 1]);
	});

	it("reads a query listed twice once, and shows Initial for null", async () => {
		const client = await makeClient();
		const { todo, fetches } = counted();
		const List = () => (
			<p data-testid="result">
				{showAll(useQueries([todo(1), null, todo(1)]))}
			</p>
		);
		render(withClient(client, <List />));
		await act(async () => {});

		expect(text()).toBe("Success 10 | Initial | Success 10");
		expect(fetches(1)).toBe(1);
	});

	it("keeps the array while every result stays the same", async () => {
		const client = await makeClient();
		const { todo } = counted();
		const seen: Array<ReadonlyArray<unknown>> = [];
		let rerender: () => void = () => {};
		const List = () => {
			const [, set] = React.useState(0);
			rerender = () => set((n) => n + 1);
			seen.push(useQueries([todo(1), todo(2)]));
			return null;
		};
		render(withClient(client, <List />));
		await act(async () => {});
		const settled = seen.length;

		await act(async () => rerender());

		expect(seen.length).toBe(settled + 1);
		expect(seen.at(-1)).toBe(seen.at(-2));
	});

	it("re-renders once when one query changes", async () => {
		const client = await makeClient();
		const { todo } = counted({ staleTime: "1 minute" });
		let renders = 0;
		const List = () => {
			renders++;
			return (
				<p data-testid="result">
					{showAll(useQueries([todo(1), todo(2)]))}
				</p>
			);
		};
		render(withClient(client, <List />));
		await act(async () => {});
		const before = renders;

		await act(() => client.runPromise(Query.set(todo(2), 99)));

		expect(text()).toBe("Success 10 | Success 99");
		expect(renders).toBe(before + 1);
	});

	it("runs the mount policy for a query as it joins", async () => {
		const client = await makeClient();
		const { todo: stale, fetches: staleFetches } = counted();
		const fresh = counted({ staleTime: "1 minute" });
		await client.fetch(stale(1));
		await client.fetch(fresh.todo(2));
		let join: () => void = () => {};
		const List = () => {
			const [joined, set] = React.useState(false);
			join = () => set(true);
			useQueries(joined ? [stale(1), fresh.todo(2)] : []);
			return null;
		};
		render(withClient(client, <List />));

		await act(async () => join());

		expect(staleFetches(1)).toBe(2);
		expect(fresh.fetches(2)).toBe(1);
	});

	it("keeps its results while paused, without using the queries", async () => {
		const client = await makeClient();
		const { todo, fetches } = counted();
		const List = ({ paused }: { readonly paused: boolean }) => (
			<p data-testid="result">
				{showAll(useQueries([todo(1), todo(2)], { paused }))}
			</p>
		);
		const view = render(withClient(client, <List paused={false} />));
		await act(async () => {});
		view.rerender(withClient(client, <List paused />));
		await act(async () => {});
		const before = fetches(1);

		await act(() => client.invalidate(todo(1)));

		expect(isInUse(client.registry, todo(1))).toBe(false);
		expect(fetches(1)).toBe(before);
		expect(text()).toBe("Success 10 | Success 20");
		view.rerender(withClient(client, <List paused={false} />));
		await act(async () => {});
		expect(fetches(1)).toBe(before + 1);
	});

	it("reads only the cache in a server render", async () => {
		const client = await makeClient();
		const { todo, fetches } = counted();
		await client.fetch(todo(1));
		const List = () => <p>{showAll(useQueries([todo(1), todo(2)]))}</p>;

		const html = renderToString(withClient(client, <List />));

		expect(html).toContain("Success 10 | Initial(waiting)");
		expect(fetches(2)).toBe(0);
	});
});

describe("paused", () => {
	const Reader = ({
		query,
		paused,
		label,
	}: {
		readonly query: Query.Query<number, never>;
		readonly paused: boolean;
		readonly label: string;
	}) => <p data-testid={label}>{show(useQuery(query, { paused }))}</p>;

	it("keeps showing its last result while an active reader refetches", async () => {
		const client = await makeClient();
		const { query, fetches } = tracked(["n"], (n) => Effect.succeed(n));
		const view = render(
			withClient(
				client,
				<>
					<Reader query={query} paused={false} label="paused" />
					<Reader query={query} paused={false} label="active" />
				</>,
			),
		);
		await act(async () => {});
		view.rerender(
			withClient(
				client,
				<>
					<Reader query={query} paused label="paused" />
					<Reader query={query} paused={false} label="active" />
				</>,
			),
		);

		const before = fetches.count;
		const shown = text("paused");
		await act(() => client.invalidate(query));

		expect(fetches.count).toBe(before + 1);
		expect(text("active")).toBe(`Success ${before + 1}`);
		expect(text("paused")).toBe(shown);
	});

	it("leaves a query no reader uses alone: no refetch on invalidate or focus", async () => {
		const { focus, signals } = manualSignals();
		const client = await makeClient({ signals });
		const { query, fetches } = tracked(["n"], (n) => Effect.succeed(n));
		const view = render(
			withClient(client, <Reader query={query} paused={false} label="r" />),
		);
		await act(async () => {});
		view.rerender(
			withClient(client, <Reader query={query} paused label="r" />),
		);
		await act(async () => {});

		expect(isInUse(client.registry, query)).toBe(false);
		await act(() => client.invalidate(query));
		act(() => client.registry.update(focus, (n) => n + 1));
		await act(async () => {});

		expect(fetches.count).toBe(1);
		expect(text("r")).toBe("Success 1");
	});

	it("refetches a stale query as it resumes, and leaves a fresh one", async () => {
		const client = await makeClient();
		const stale = tracked(["stale"], (n) => Effect.succeed(n));
		const fresh = tracked(["fresh"], (n) => Effect.succeed(n), {
			staleTime: "1 minute",
		});
		const Both = ({ paused }: { readonly paused: boolean }) => (
			<>
				<Reader query={stale.query} paused={paused} label="stale" />
				<Reader query={fresh.query} paused={paused} label="fresh" />
			</>
		);
		const view = render(withClient(client, <Both paused={false} />));
		await act(async () => {});
		view.rerender(withClient(client, <Both paused />));
		await act(async () => {});

		view.rerender(withClient(client, <Both paused={false} />));
		await act(async () => {});

		expect(stale.fetches.count).toBe(2);
		expect(fresh.fetches.count).toBe(1);
		expect(text("stale")).toBe("Success 2");
	});

	it("refetches as it resumes once a value another reader fetched has gone stale", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const client = await makeClient();
		const { query, fetches } = tracked(["n"], (n) => Effect.succeed(n), {
			staleTime: "1 minute",
		});
		const view = render(
			withClient(client, <Reader query={query} paused={false} label="r" />),
		);
		await act(async () => {});
		view.rerender(
			withClient(client, <Reader query={query} paused label="r" />),
		);
		await act(async () => {});
		// Fetched for another reader while this one is paused.
		await client.invalidate(query);
		await client.fetch(query);
		expect(fetches.count).toBe(2);
		vi.setSystemTime(Date.now() + 120_000);

		view.rerender(
			withClient(client, <Reader query={query} paused={false} label="r" />),
		);
		await act(async () => {});

		expect(fetches.count).toBe(3);
	});

	it("shows what it had, settled, when paused during a refetch", async () => {
		const client = await makeClient();
		const slow = gate();
		const { query } = tracked(["n"], (n) =>
			n === 1 ? Effect.succeed(n) : Effect.as(slow.wait, n),
		);
		const view = render(
			withClient(client, <Reader query={query} paused={false} label="r" />),
		);
		await act(async () => {});
		await act(() => client.invalidate(query));
		expect(text("r")).toBe("Success(waiting) 1");

		view.rerender(
			withClient(client, <Reader query={query} paused label="r" />),
		);

		expect(text("r")).toBe("Success 1");
		slow.open();
	});

	it("shows what the cache has once clear drops the query", async () => {
		const client = await makeClient();
		const { query } = tracked(["n"], (n) => Effect.succeed(n));
		const List = ({ paused }: { readonly paused: boolean }) => (
			<p data-testid="list">{showAll(useQueries([query], { paused }))}</p>
		);
		const Both = ({ paused }: { readonly paused: boolean }) => (
			<>
				<Reader query={query} paused={paused} label="r" />
				<List paused={paused} />
			</>
		);
		const view = render(withClient(client, <Both paused={false} />));
		await act(async () => {});
		view.rerender(withClient(client, <Both paused />));

		await act(() => client.clear());
		view.rerender(withClient(client, <Both paused />));

		expect(text("r")).toBe("Initial");
		expect(text("list")).toBe("Initial");
	});

	it("doesn't show what it showed before reading nothing", async () => {
		const client = await makeClient();
		const { query } = tracked(["n"], (n) => Effect.succeed(n));
		const Maybe = ({
			read,
			paused,
		}: {
			readonly read: boolean;
			readonly paused: boolean;
		}) => (
			<p data-testid="r">
				{show(useQuery(read ? query : null, { paused }))}
			</p>
		);
		const view = render(withClient(client, <Maybe read paused={false} />));
		await act(async () => {});
		view.rerender(withClient(client, <Maybe read={false} paused={false} />));
		await act(async () => {});
		await client.fetch(query);

		view.rerender(withClient(client, <Maybe read paused />));

		expect(text("r")).toBe("Success 2");
	});

	it("keeps a paused infinite query's controls still while another reader loads a page", async () => {
		const client = await makeClient();
		const numbers = InfiniteQuery.make({
			key: ["numbers"],
			initialPageParam: 0,
			run: (page: number) => Effect.succeed([page]),
			nextPageParam: (_last, pages) =>
				pages.length < 3 ? pages.length : undefined,
		});
		let renders = 0;
		let loadMore: () => Promise<void> = () => Promise.resolve();
		const Paused = () => {
			renders++;
			const { result } = useInfiniteQuery(numbers, { paused: true });
			return <p data-testid="paused">{show(result)}</p>;
		};
		const Active = () => {
			const { result, fetchNextPage } = useInfiniteQuery(numbers);
			loadMore = fetchNextPage;
			return <p data-testid="active">{show(result)}</p>;
		};
		await client.fetch(numbers);
		render(
			withClient(
				client,
				<>
					<Paused />
					<Active />
				</>,
			),
		);
		await act(async () => {});
		const before = renders;

		await act(() => loadMore());

		expect(renders).toBe(before);
		expect(text("paused")).toBe('Success {"pages":[[0]],"pageParams":[0]}');
	});

	it("shows the cache without fetching when paused from its first render", async () => {
		const client = await makeClient();
		const cached = tracked(["cached"], (n) => Effect.succeed(n));
		const empty = tracked(["empty"], (n) => Effect.succeed(n));
		await client.fetch(cached.query);
		render(
			withClient(
				client,
				<>
					<Reader query={cached.query} paused label="cached" />
					<Reader query={empty.query} paused label="empty" />
				</>,
			),
		);
		await act(async () => {});

		expect(text("cached")).toBe("Success 1");
		expect(text("empty")).toBe("Initial");
		expect([cached.fetches.count, empty.fetches.count]).toEqual([1, 0]);
	});
});

describe("switching useQuery to a query another reader fetched", () => {
	it("revalidates it when it's stale", async () => {
		const client = await makeClient();
		const first = tracked(["first"], (n) => Effect.succeed(n));
		const second = tracked(["second"], (n) => Effect.succeed(n));
		const Read = ({
			query,
		}: {
			readonly query: Query.Query<number, never>;
		}) => <p data-testid="result">{show(useQuery(query))}</p>;
		const view = render(withClient(client, <Read query={first.query} />));
		await act(async () => {});
		await client.fetch(second.query);

		view.rerender(withClient(client, <Read query={second.query} />));
		await act(async () => {});

		expect(second.fetches.count).toBe(2);
		expect(text()).toBe("Success 2");
	});
});

describe("a placeholder in React", () => {
	interface Todo {
		readonly id: number;
		readonly title: string;
	}
	const setup = async () => {
		const client = await makeClient();
		const detail = gate();
		let placeholders = 0;
		const list = Query.make({
			key: ["todos"],
			run: Effect.succeed<ReadonlyArray<Todo>>([{ id: 1, title: "Listed" }]),
		});
		const todo = Query.family({
			key: ["todo"],
			run: (id: number) =>
				Effect.as(detail.wait, { id, title: "Fetched" } as Todo),
			placeholder: (id) =>
				Effect.map(Query.get(list), (cached) => {
					placeholders++;
					return Option.flatMap(cached, (items) =>
						Option.fromUndefinedOr(items.find((item) => item.id === id)),
					);
				}),
		});
		await client.fetch(list);
		return { client, todo, detail, placeholders: () => placeholders };
	};

	it("shows to a suspense reader without suspending", async () => {
		const { client, todo, detail } = await setup();
		const Title = () => (
			<p data-testid="result">{useSuspenseQuery(todo(1)).value.title}</p>
		);
		render(
			withClient(
				client,
				<React.Suspense fallback={<p data-testid="result">loading</p>}>
					<Title />
				</React.Suspense>,
			),
		);

		expect(text()).toBe("Listed");
		await act(async () => detail.open());
		expect(text()).toBe("Fetched");
	});

	it("isn't kept by keepPrevious for the next query, selected", async () => {
		const { client, todo } = await setup();
		const Title = ({ id }: { readonly id: number }) => (
			<p data-testid="result">
				{show(
					useQuery(todo(id), {
						keepPrevious: true,
						select: (found) => found.title,
					}),
				)}
			</p>
		);
		const view = render(withClient(client, <Title id={1} />));
		expect(text()).toBe('Success(waiting) "Listed"');

		view.rerender(withClient(client, <Title id={2} />));
		await act(async () => {});

		expect(text()).toBe("Initial(waiting)");
	});

	it("isn't kept by keepPrevious for the next query", async () => {
		const { client, todo } = await setup();
		const Title = ({ id }: { readonly id: number }) => (
			<p data-testid="result">
				{show(useQuery(todo(id), { keepPrevious: true }))}
			</p>
		);
		const view = render(withClient(client, <Title id={1} />));
		expect(text()).toBe('Success(waiting) {"id":1,"title":"Listed"}');

		view.rerender(withClient(client, <Title id={2} />));
		await act(async () => {});

		expect(text()).toBe("Initial(waiting)");
	});

	it("isn't shown or run in a server render", async () => {
		const { client, todo, placeholders } = await setup();
		const Title = () => <p>{show(useQuery(todo(1)))}</p>;

		const html = renderToString(withClient(client, <Title />));

		expect(html).toContain("Initial(waiting)");
		expect(placeholders()).toBe(0);
	});
});

describe("isPlaceholder", () => {
	const describeState = (state: UseQueryStateResult<unknown, unknown>) =>
		[
			state.status,
			state.isPlaceholder ? "placeholder" : "own",
			state.isFetching ? "fetching" : "idle",
			JSON.stringify(state.data),
		].join(" ");

	/** A family whose fetches each wait on a gate of their own. */
	const gated = () => {
		const gates: Array<ReturnType<typeof gate>> = [];
		const todo = Query.family({
			key: ["gated"],
			run: (id: number) =>
				Effect.suspend(() => {
					const each = gate();
					gates.push(each);
					return Effect.as(each.wait, id * 10);
				}),
			placeholder: (id: number) =>
				Effect.succeed(id === 1 ? Option.some(-1) : Option.none()),
		});
		const openAll = () => {
			for (const each of gates.splice(0)) {
				each.open();
			}
		};
		return { todo, openAll };
	};

	it("is true for a query's placeholder until its fetch settles", async () => {
		const client = await makeClient();
		const { todo, openAll } = gated();
		const State = () => (
			<p data-testid="result">{describeState(useQueryState(todo(1)))}</p>
		);
		render(withClient(client, <State />));
		expect(text()).toBe("success placeholder fetching -1");

		await act(async () => openAll());

		expect(text()).toBe("success own idle 10");
	});

	it("is true for a selection of a placeholder", async () => {
		const client = await makeClient();
		const { todo } = gated();
		const State = () => (
			<p data-testid="result">
				{describeState(useQueryState(todo(1), { select: (n) => n * 2 }))}
			</p>
		);
		render(withClient(client, <State />));

		expect(text()).toBe("success placeholder fetching -2");
	});

	it("is true for the value keepPrevious keeps, and false once the next settles", async () => {
		const client = await makeClient();
		const { todo, openAll } = gated();
		const State = ({ id }: { readonly id: number }) => (
			<p data-testid="result">
				{describeState(useQueryState(todo(id), { keepPrevious: true }))}
			</p>
		);
		const view = render(withClient(client, <State id={1} />));
		await act(async () => openAll());
		expect(text()).toBe("success own idle 10");

		view.rerender(withClient(client, <State id={2} />));
		expect(text()).toBe("success placeholder fetching 10");
		await act(async () => openAll());

		expect(text()).toBe("success own idle 20");
	});

	it("is false while the query's own value refetches", async () => {
		const client = await makeClient();
		const { todo, openAll } = gated();
		const State = () => (
			<p data-testid="result">{describeState(useQueryState(todo(2)))}</p>
		);
		render(withClient(client, <State />));
		await act(async () => openAll());

		act(() => void client.refetch(todo(2)));

		expect(text()).toBe("success own fetching 20");
	});

	it("stays true for a placeholder a paused reader keeps", async () => {
		const client = await makeClient();
		const { todo } = gated();
		const State = ({ paused }: { readonly paused: boolean }) => (
			<p data-testid="result">
				{describeState(useQueryState(todo(1), { paused }))}
			</p>
		);
		const view = render(withClient(client, <State paused={false} />));
		await act(async () => {});

		view.rerender(withClient(client, <State paused />));

		expect(text()).toBe("success placeholder idle -1");
	});

	it("keeps a paused keepPrevious reader's value, not fetching, until it resumes", async () => {
		const client = await makeClient();
		const { todo, openAll } = gated();
		const State = ({
			id,
			paused,
		}: {
			readonly id: number;
			readonly paused: boolean;
		}) => (
			<p data-testid="result">
				{describeState(
					useQueryState(todo(id), { keepPrevious: true, paused }),
				)}
			</p>
		);
		const view = render(withClient(client, <State id={2} paused={false} />));
		await act(async () => openAll());

		view.rerender(withClient(client, <State id={3} paused />));
		await act(async () => {});
		expect(text()).toBe("success placeholder idle 20");

		view.rerender(withClient(client, <State id={3} paused={false} />));
		expect(text()).toBe("success placeholder fetching 20");
		await act(async () => openAll());

		expect(text()).toBe("success own idle 30");
	});

	it("is false when the fetch fails after a placeholder", async () => {
		const client = await makeClient();
		const failing = Query.make({
			key: ["failing"],
			run: Effect.fail("offline"),
			placeholder: Effect.succeed(Option.some("Listed")),
		});
		let seen: UseQueryStateResult<string, string> | undefined;
		const Reader = () => {
			seen = useQueryState(failing);
			return null;
		};
		render(withClient(client, <Reader />));

		await vi.waitFor(() => expect(seen?.status).toBe("failure"));
		expect(seen?.isPlaceholder).toBe(false);
		expect(seen?.data).toBeUndefined();
	});
});
