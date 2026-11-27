// @vitest-environment happy-dom
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	InfiniteQuery,
	Mutation,
	Query,
	type QueryClient,
} from "../src/index.js";
import {
	QueryBoundary,
	QueryProvider,
	useInfiniteQueryState,
	type UseInfiniteQueryStateResult,
	useMutation,
	useQueriesState,
	type UseQueryStateResult,
	useSuspenseInfiniteQueryState,
	useSuspenseQueryState,
	type UseSuspenseQueryStateResult,
} from "../src/react/index.js";
import { disposeClients, gate, makeClient, tracked } from "./helpers.js";

afterEach(async () => {
	cleanup();
	await disposeClients();
});

const withClient = (client: QueryClient.QueryClient, node: React.ReactNode) => (
	<QueryProvider client={client}>{node}</QueryProvider>
);

const text = (label = "result") => screen.getByTestId(label).textContent;

const describeState = (state: {
	readonly status: string;
	readonly isFetching?: boolean | undefined;
	readonly data: unknown;
	readonly error: unknown;
}) =>
	[
		state.status,
		state.isFetching ? "fetching" : "idle",
		JSON.stringify(state.data),
		state.error === undefined ? "-" : String(state.error),
	].join(" ");

const failure = ({ error }: { readonly error: unknown }) => (
	<p data-testid="result">failed: {String(error)}</p>
);

describe("useSuspenseQueryState", () => {
	it("suspends, then succeeds with select applied", async () => {
		const client = await makeClient();
		const slow = gate();
		const query = Query.make({
			key: ["suspense-state"],
			run: Effect.as(slow.wait, ["a", "b"]),
		});
		const Count = () => (
			<p data-testid="result">
				{describeState(
					useSuspenseQueryState(query, { select: (list) => list.length }),
				)}
			</p>
		);
		render(
			withClient(
				client,
				<React.Suspense fallback={<p data-testid="result">loading</p>}>
					<Count />
				</React.Suspense>,
			),
		);
		expect(text()).toBe("loading");

		await act(async () => slow.open());

		await vi.waitFor(() => expect(text()).toBe("success idle 2 -"));
	});

	it("shows a failed refetch as a failure with the earlier data", async () => {
		const client = await makeClient();
		const slow = gate();
		const { query } = tracked(["suspense-state-kept"], (fetch) =>
			fetch === 1
				? Effect.succeed("Ada")
				: Effect.andThen(slow.wait, Effect.fail("offline")),
		);
		let seen: UseSuspenseQueryStateResult<string, string> | undefined;
		const Reader = () => {
			seen = useSuspenseQueryState(query);
			return <p data-testid="result">{describeState(seen)}</p>;
		};
		render(
			withClient(
				client,
				<QueryBoundary pending={<p>loading</p>} failure={failure}>
					<Reader />
				</QueryBoundary>,
			),
		);
		await vi.waitFor(() => expect(text()).toBe('success idle "Ada" -'));

		act(() => void seen?.refetch());
		await vi.waitFor(() => expect(text()).toBe('success fetching "Ada" -'));
		await act(async () => slow.open());

		await vi.waitFor(() => expect(text()).toBe('failure idle "Ada" offline'));
		expect(seen?.isFailure).toBe(true);
	});

	it("throws a failure with no value before it to the error boundary", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		const query = Query.make({
			key: ["suspense-state-fails"],
			run: Effect.fail("offline"),
		});
		const Reader = () => <p>{describeState(useSuspenseQueryState(query))}</p>;
		render(
			withClient(
				client,
				<QueryBoundary pending={<p>loading</p>} failure={failure}>
					<Reader />
				</QueryBoundary>,
			),
		);

		await vi.waitFor(() => expect(text()).toBe("failed: offline"));
	});

	it("keeps its identity while nothing changes", async () => {
		const client = await makeClient();
		const query = Query.make({
			key: ["suspense-state-identity"],
			run: Effect.succeed(1),
		});
		const seen: Array<UseSuspenseQueryStateResult<number, never>> = [];
		const Reader = ({ tick }: { readonly tick: number }) => {
			seen.push(useSuspenseQueryState(query));
			return <p data-testid="result">{tick}</p>;
		};
		const tree = (tick: number) =>
			withClient(
				client,
				<React.Suspense fallback={null}>
					<Reader tick={tick} />
				</React.Suspense>,
			);
		const view = render(tree(1));
		await vi.waitFor(() => expect(text()).toBe("1"));

		view.rerender(tree(2));

		expect(text()).toBe("2");
		expect(seen.at(-1)).toBe(seen.at(-2));
	});

	it("shows a refetch after a failure as a failure that's fetching", async () => {
		const client = await makeClient();
		const slow = gate();
		const { query } = tracked(["suspense-state-retry"], (fetch) =>
			fetch === 1
				? Effect.succeed("Ada")
				: fetch === 2
					? Effect.fail("offline")
					: Effect.as(slow.wait, "Grace"),
		);
		const Reader = () => (
			<p data-testid="result">
				{describeState(useSuspenseQueryState(query))}
			</p>
		);
		render(
			withClient(
				client,
				<React.Suspense fallback={null}>
					<Reader />
				</React.Suspense>,
			),
		);
		await vi.waitFor(() => expect(text()).toBe('success idle "Ada" -'));
		await act(() => client.refetch(query));
		expect(text()).toBe('failure idle "Ada" offline');

		act(() => void client.refetch(query));
		await vi.waitFor(() =>
			expect(text()).toBe('failure fetching "Ada" offline'),
		);
		await act(async () => slow.open());

		await vi.waitFor(() => expect(text()).toBe('success idle "Grace" -'));
	});

	it("keeps its identity while a failed refetch's result stays", async () => {
		const client = await makeClient();
		const { query } = tracked(["suspense-state-failed-identity"], (fetch) =>
			fetch === 1 ? Effect.succeed(1) : Effect.fail("offline"),
		);
		const seen: Array<UseSuspenseQueryStateResult<number, string>> = [];
		const Reader = ({ tick }: { readonly tick: number }) => {
			seen.push(useSuspenseQueryState(query));
			return <p data-testid="result">{tick}</p>;
		};
		const tree = (tick: number) =>
			withClient(
				client,
				<React.Suspense fallback={null}>
					<Reader tick={tick} />
				</React.Suspense>,
			);
		const view = render(tree(1));
		await vi.waitFor(() => expect(text()).toBe("1"));
		await act(() => client.refetch(query));
		expect(seen.at(-1)?.status).toBe("failure");

		view.rerender(tree(2));

		expect(seen.at(-1)).toBe(seen.at(-2));
	});
});

class PageFailed {
	readonly _tag = "PageFailed";
}

/** Pages of two numbers, up to page 1; `fail` fails the next page fetched. */
const numbers = () => {
	const state = { fail: false };
	const query = InfiniteQuery.make({
		key: ["state-numbers"],
		initialPageParam: 0,
		run: (page: number) =>
			Effect.suspend(() => {
				if (state.fail) {
					state.fail = false;
					return Effect.fail(new PageFailed());
				}
				return Effect.succeed([page * 2, page * 2 + 1]);
			}),
		nextPageParam: (_, __, page) => (page < 1 ? page + 1 : undefined),
	});
	return { state, query };
};

const describePages = (
	state:
		| UseInfiniteQueryStateResult<Array<number>, PageFailed, number>
		| UseSuspenseQueryStateResult<unknown, unknown>,
) =>
	[
		state.status,
		JSON.stringify(state.data === undefined ? null : state.data),
		state.error === undefined ? "-" : (state.error as PageFailed)._tag,
	].join(" ");

describe("useInfiniteQueryState", () => {
	it("is pending, then shows the pages and loads more", async () => {
		const client = await makeClient();
		const { query } = numbers();
		let seen:
			| UseInfiniteQueryStateResult<Array<number>, PageFailed, number>
			| undefined;
		const List = () => {
			seen = useInfiniteQueryState(query);
			return (
				<p data-testid="result">
					{seen.status} {seen.data?.pages.flat().join(",")}
					{seen.hasNextPage ? " +more" : ""}
				</p>
			);
		};
		render(withClient(client, <List />));
		await vi.waitFor(() => expect(text()).toBe("success 0,1 +more"));

		await act(() => seen!.fetchNextPage());

		expect(text()).toBe("success 0,1,2,3");
	});

	it("shows a page that fails as a failure that keeps the loaded pages", async () => {
		const client = await makeClient();
		const { state, query } = numbers();
		let seen:
			| UseInfiniteQueryStateResult<Array<number>, PageFailed, number>
			| undefined;
		const List = () => {
			seen = useInfiniteQueryState(query);
			return <p data-testid="result">{describePages(seen)}</p>;
		};
		render(withClient(client, <List />));
		await vi.waitFor(() => expect(seen?.status).toBe("success"));

		state.fail = true;
		await act(() => seen!.fetchNextPage());

		expect(seen?.status).toBe("failure");
		expect(seen?.data?.pages).toEqual([[0, 1]]);
		expect(seen?.error).toBeInstanceOf(PageFailed);
	});

	it("shows a first page that fails as a failure with no data", async () => {
		const client = await makeClient();
		const { state, query } = numbers();
		state.fail = true;
		let seen:
			| UseInfiniteQueryStateResult<Array<number>, PageFailed, number>
			| undefined;
		const List = () => {
			seen = useInfiniteQueryState(query);
			return null;
		};
		render(withClient(client, <List />));

		await vi.waitFor(() => expect(seen?.status).toBe("failure"));
		expect(seen?.data).toBeUndefined();
		expect(seen?.error).toBeInstanceOf(PageFailed);
		expect(seen?.hasNextPage).toBe(false);
	});

	it("is pending and not fetching for a null query", async () => {
		const client = await makeClient();
		let seen:
			| UseInfiniteQueryStateResult<Array<number>, PageFailed, number>
			| undefined;
		const List = () => {
			seen = useInfiniteQueryState<Array<number>, PageFailed, number>(null);
			return null;
		};
		render(withClient(client, <List />));

		expect(seen?.status).toBe("pending");
		expect(seen?.isFetching).toBe(false);
		expect(seen?.hasNextPage).toBe(false);
		await expect(seen?.refetch()).resolves.toBeUndefined();
	});

	it("keeps its identity while nothing changes", async () => {
		const client = await makeClient();
		const { query } = numbers();
		const seen: Array<
			UseInfiniteQueryStateResult<Array<number>, PageFailed, number>
		> = [];
		const List = ({ tick }: { readonly tick: number }) => {
			seen.push(useInfiniteQueryState(query));
			return <p data-testid="result">{tick}</p>;
		};
		const view = render(withClient(client, <List tick={1} />));
		await vi.waitFor(() => expect(seen.at(-1)?.status).toBe("success"));

		view.rerender(withClient(client, <List tick={2} />));

		expect(seen.at(-1)).toBe(seen.at(-2));
	});
});

describe("useSuspenseInfiniteQueryState", () => {
	it("suspends, then shows the pages and loads more", async () => {
		const client = await makeClient();
		const { query } = numbers();
		let more: () => Promise<void> = () => Promise.resolve();
		const List = () => {
			const state = useSuspenseInfiniteQueryState(query);
			more = state.fetchNextPage;
			return (
				<p data-testid="result">
					{state.status} {state.data.pages.flat().join(",")}
				</p>
			);
		};
		render(
			withClient(
				client,
				<React.Suspense fallback={<p data-testid="result">loading</p>}>
					<List />
				</React.Suspense>,
			),
		);
		await vi.waitFor(() => expect(text()).toBe("success 0,1"));

		await act(() => more());

		expect(text()).toBe("success 0,1,2,3");
	});

	it("shows a page that fails as a failure that keeps the loaded pages", async () => {
		const client = await makeClient();
		const { state, query } = numbers();
		let more: () => Promise<void> = () => Promise.resolve();
		const List = () => {
			const pages = useSuspenseInfiniteQueryState(query);
			more = pages.fetchNextPage;
			return <p data-testid="result">{describePages(pages)}</p>;
		};
		render(
			withClient(
				client,
				<QueryBoundary pending={<p>loading</p>} failure={failure}>
					<List />
				</QueryBoundary>,
			),
		);
		await vi.waitFor(() =>
			expect(text()).toBe('success {"pages":[[0,1]],"pageParams":[0]} -'),
		);

		state.fail = true;
		await act(() => more());

		expect(text()).toBe(
			'failure {"pages":[[0,1]],"pageParams":[0]} PageFailed',
		);
	});
});

describe("useSuspenseInfiniteQueryState's first page", () => {
	it("throws a first page that fails to the error boundary", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		const { state, query } = numbers();
		state.fail = true;
		const List = () => (
			<p>{describePages(useSuspenseInfiniteQueryState(query))}</p>
		);
		render(
			withClient(
				client,
				<QueryBoundary
					pending={<p>loading</p>}
					failure={({ error }) => (
						<p data-testid="result">
							failed: {(error as PageFailed)._tag}
						</p>
					)}
				>
					<List />
				</QueryBoundary>,
			),
		);

		await vi.waitFor(() => expect(text()).toBe("failed: PageFailed"));
	});
});

describe("useQueriesState", () => {
	it("shows each query's state in order, and a null entry as pending", async () => {
		const client = await makeClient();
		const one = Query.make({
			key: ["states", 1],
			run: Effect.succeed("one"),
		});
		const two = Query.make({
			key: ["states", 2],
			run: Effect.fail("offline") as Effect.Effect<string, string>,
		});
		const Reader = () => (
			<p data-testid="result">
				{useQueriesState([one, null, two])
					.map((state) => describeState(state))
					.join(" | ")}
			</p>
		);
		render(withClient(client, <Reader />));

		await vi.waitFor(() =>
			expect(text()).toBe(
				'success idle "one" - | pending idle  - | failure idle  offline',
			),
		);
	});

	it("keeps each object, its refetch and the array while their results stay", async () => {
		const client = await makeClient();
		const one = Query.make({ key: ["kept", 1], run: Effect.succeed(1) });
		const two = Query.make({ key: ["kept", 2], run: Effect.succeed(2) });
		const seen: Array<ReadonlyArray<UseQueryStateResult<number, never>>> = [];
		const Reader = ({ tick }: { readonly tick: number }) => {
			seen.push(useQueriesState([one, two]));
			return <p data-testid="result">{tick}</p>;
		};
		const view = render(withClient(client, <Reader tick={1} />));
		await vi.waitFor(() =>
			expect(seen.at(-1)?.every((state) => state.isSuccess)).toBe(true),
		);
		const before = seen.at(-1)!;

		view.rerender(withClient(client, <Reader tick={2} />));
		expect(seen.at(-1)).toBe(before);

		await act(() => client.runPromise(Query.set(two, 20)));
		const after = seen.at(-1)!;

		expect(after).not.toBe(before);
		expect(after[0]).toBe(before[0]);
		expect(after[1]?.data).toBe(20);
		expect(after[1]?.refetch).toBe(before[1]?.refetch);
	});

	it("shows the same object for a query listed twice", async () => {
		const client = await makeClient();
		const one = Query.make({ key: ["twice"], run: Effect.succeed(1) });
		let seen: ReadonlyArray<UseQueryStateResult<number, never>> = [];
		const Reader = () => {
			seen = useQueriesState([one, one]);
			return null;
		};
		render(withClient(client, <Reader />));

		await vi.waitFor(() => expect(seen[0]?.isSuccess).toBe(true));
		expect(seen[1]).toBe(seen[0]);
	});

	it("refetches an entry", async () => {
		const client = await makeClient();
		const { query, fetches } = tracked(["states-refetch"], (fetch) =>
			Effect.succeed(fetch),
		);
		let seen: ReadonlyArray<UseQueryStateResult<number, never>> = [];
		const Reader = () => {
			seen = useQueriesState([query, null]);
			return null;
		};
		render(withClient(client, <Reader />));
		await vi.waitFor(() => expect(seen[0]?.data).toBe(1));

		await act(() => seen[0]!.refetch());
		await act(() => seen[1]!.refetch());

		expect(fetches.count).toBe(2);
		expect(seen[0]?.data).toBe(2);
	});

	it("keeps each object through a reorder", async () => {
		const client = await makeClient();
		const one = Query.make({ key: ["order", 1], run: Effect.succeed(1) });
		const two = Query.make({ key: ["order", 2], run: Effect.succeed(2) });
		let seen: ReadonlyArray<UseQueryStateResult<number, never>> = [];
		const Reader = ({
			queries,
		}: {
			readonly queries: ReadonlyArray<Query.Query<number, never>>;
		}) => {
			seen = useQueriesState(queries);
			return null;
		};
		const view = render(withClient(client, <Reader queries={[one, two]} />));
		await vi.waitFor(() =>
			expect(seen.every((state) => state.isSuccess)).toBe(true),
		);
		const [first, second] = seen;

		view.rerender(withClient(client, <Reader queries={[two, one]} />));

		expect(seen[0]).toBe(second);
		expect(seen[1]).toBe(first);
	});

	it("gives a new query its own refetch when it shows the same result as the last", async () => {
		const client = await makeClient();
		const one = Query.make({ key: ["paused", 1], run: Effect.succeed(1) });
		const two = Query.make({ key: ["paused", 2], run: Effect.succeed(2) });
		let seen: ReadonlyArray<UseQueryStateResult<number, never>> = [];
		const Reader = ({
			query,
		}: {
			readonly query: Query.Query<number, never>;
		}) => {
			seen = useQueriesState([query], { paused: true });
			return null;
		};
		const view = render(withClient(client, <Reader query={one} />));
		const first = seen[0];
		expect(first?.status).toBe("pending");

		view.rerender(withClient(client, <Reader query={two} />));

		expect(seen[0]?.status).toBe("pending");
		expect(seen[0]?.refetch).not.toBe(first?.refetch);
	});

	it("follows a list that grows and shrinks", async () => {
		const client = await makeClient();
		const one = Query.make({ key: ["list", 1], run: Effect.succeed(1) });
		const two = Query.make({ key: ["list", 2], run: Effect.succeed(2) });
		const Reader = ({
			queries,
		}: {
			readonly queries: ReadonlyArray<Query.Query<number, never>>;
		}) => (
			<p data-testid="result">
				{useQueriesState(queries)
					.map((state) => state.data ?? "-")
					.join(",")}
			</p>
		);
		const view = render(withClient(client, <Reader queries={[one]} />));
		await vi.waitFor(() => expect(text()).toBe("1"));

		view.rerender(withClient(client, <Reader queries={[two, one]} />));
		await vi.waitFor(() => expect(text()).toBe("2,1"));
		view.rerender(withClient(client, <Reader queries={[two]} />));

		expect(text()).toBe("2");
	});
});

describe("useMutation's fields", () => {
	type Fields = Pick<
		ReturnType<typeof useMutation<string, number, string>>,
		"status" | "data" | "error" | "isIdle" | "isPending"
	>;

	const describeRun = (fields: Fields) =>
		[
			fields.status,
			fields.data ?? "-",
			fields.error ?? "-",
			fields.isIdle ? "idle" : "",
			fields.isPending ? "pending" : "",
		]
			.filter(Boolean)
			.join(" ");

	it("is idle, pending, then success or failure, and idle again after reset", async () => {
		const client = await makeClient();
		const slow = gate();
		const save = Mutation.make({
			run: (title: string) =>
				title === ""
					? Effect.fail("empty")
					: Effect.as(slow.wait, title.length),
		});
		let controls: ReturnType<typeof useMutation<string, number, string>>;
		const Saver = () => {
			controls = useMutation(save);
			return <p data-testid="result">{describeRun(controls)}</p>;
		};
		render(withClient(client, <Saver />));
		expect(text()).toBe("idle - - idle");

		let running: Promise<unknown> = Promise.resolve();
		act(() => {
			running = controls.run("milk");
		});
		expect(text()).toBe("pending - - pending");
		await act(async () => {
			slow.open();
			await running;
		});
		expect(text()).toBe("success 4 -");

		await act(async () => {
			await controls.run("");
		});
		expect(text()).toBe("failure - empty");
		expect(controls!.isFailure).toBe(true);
		expect(controls!.cause && Cause.hasFails(controls!.cause)).toBe(true);

		act(() => controls.reset());
		expect(text()).toBe("idle - - idle");
	});

	it("is pending with no data or error while a run follows an earlier one", async () => {
		const client = await makeClient();
		const slow = gate();
		const save = Mutation.make({
			run: (title: string) =>
				title === ""
					? Effect.fail("empty")
					: Effect.as(slow.wait, title.length),
		});
		let controls: ReturnType<typeof useMutation<string, number, string>>;
		const Saver = () => {
			controls = useMutation(save);
			return <p data-testid="result">{describeRun(controls)}</p>;
		};
		render(withClient(client, <Saver />));
		await act(async () => {
			await controls.run("");
		});
		expect(text()).toBe("failure - empty");

		let running: Promise<unknown> = Promise.resolve();
		act(() => {
			running = controls.run("milk");
		});

		expect(text()).toBe("pending - - pending");
		expect(controls!.cause).toBeUndefined();
		await act(async () => {
			slow.open();
			await running;
		});
		expect(text()).toBe("success 4 -");
	});

	it("leaves error undefined for a defect, which cause holds", async () => {
		const client = await makeClient();
		const boom = new Error("boom");
		const save = Mutation.make({ run: () => Effect.die(boom) });
		let controls: ReturnType<typeof useMutation<void, never, never>>;
		const Saver = () => {
			controls = useMutation(save);
			return null;
		};
		render(withClient(client, <Saver />));

		await act(async () => {
			await controls.run();
		});

		expect(controls!.status).toBe("failure");
		expect(controls!.error).toBeUndefined();
		expect(controls!.cause && Cause.squash(controls!.cause)).toBe(boom);
	});
});
