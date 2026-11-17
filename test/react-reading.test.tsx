// @vitest-environment happy-dom
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Query, QueryClient } from "../src/index.js";
import {
	QueryBoundary,
	QueryProvider,
	useQuery,
	useQueryState,
	type UseQueryStateResult,
	useSuspenseQuery,
} from "../src/react/index.js";
import { disposeClients, gate, makeClient, show, tracked } from "./helpers.js";

afterEach(async () => {
	cleanup();
	await disposeClients();
});

const withClient = (client: QueryClient.QueryClient, node: React.ReactNode) => (
	<QueryProvider client={client}>{node}</QueryProvider>
);

const text = (label = "result") => screen.getByTestId(label).textContent;

const setValue = <A,>(
	client: QueryClient.QueryClient,
	query: Query.Query<A, any>,
	value: A,
) => act(() => client.runPromise(Query.set(query, value)));

interface Todo {
	readonly id: number;
	readonly title: string;
	readonly done: boolean;
}

const todos = (list: ReadonlyArray<Todo>) =>
	Query.make({
		key: ["todos", list.length],
		run: Effect.succeed(list),
	});

const buy = { id: 1, title: "Buy milk", done: false };
const walk = { id: 2, title: "Walk the dog", done: true };

describe("useQuery with select", () => {
	it("re-renders only when the selection changes", async () => {
		const client = await makeClient();
		const query = todos([buy, walk]);
		const renders = { count: 0 };
		const Count = () => {
			renders.count++;
			const result = useQuery(query, {
				select: (list) => list.filter((todo) => todo.done),
			});
			return <p data-testid="result">{show(result)}</p>;
		};
		render(withClient(client, <Count />));
		await vi.waitFor(() => expect(text()).toContain("Walk the dog"));
		const settled = renders.count;

		await setValue(client, query, [{ ...buy, title: "Buy oat milk" }, walk]);
		expect(renders.count).toBe(settled);

		await setValue(client, query, [{ ...buy, done: true }, walk]);
		expect(renders.count).toBe(settled + 1);
		expect(text()).toContain("Buy milk");
	});

	it("keeps the cached value whole for other readers", async () => {
		const client = await makeClient();
		const query = todos([buy, walk]);
		const Both = () => (
			<>
				<p data-testid="count">
					{show(useQuery(query, { select: (list) => list.length }))}
				</p>
				<p data-testid="first">
					{show(useQuery(query, { select: (list) => list[0]?.title }))}
				</p>
			</>
		);
		render(withClient(client, <Both />));

		await vi.waitFor(() => expect(text("count")).toBe("Success 2"));
		expect(text("first")).toBe('Success "Buy milk"');
		expect(QueryClient.get(client, query)).toEqual(Option.some([buy, walk]));
	});

	it("selects with the latest function", async () => {
		const client = await makeClient();
		const query = todos([buy, walk]);
		const Field = ({ field }: { readonly field: "title" | "id" }) => (
			<p data-testid="result">
				{show(useQuery(query, { select: (list) => list[1]?.[field] }))}
			</p>
		);
		const view = render(withClient(client, <Field field="title" />));
		await vi.waitFor(() => expect(text()).toBe('Success "Walk the dog"'));

		view.rerender(withClient(client, <Field field="id" />));

		expect(text()).toBe("Success 2");
	});

	it("selects a failure's previous success", async () => {
		const client = await makeClient();
		const { query } = tracked(["flaky-list"], (fetch) =>
			fetch === 1 ? Effect.succeed([buy, walk]) : Effect.fail("offline"),
		);
		let seen: AsyncResult.AsyncResult<number, string> | undefined;
		const Count = () => {
			seen = useQuery(query, { select: (list) => list.length });
			return null;
		};
		render(withClient(client, <Count />));
		await vi.waitFor(() => expect(seen?._tag).toBe("Success"));

		await act(() => client.runPromise(Query.refetch(query)));

		expect(seen?._tag).toBe("Failure");
		expect(
			seen !== undefined && AsyncResult.isFailure(seen)
				? seen.previousSuccess.pipe((previous) =>
						previous._tag === "Some" ? previous.value.value : undefined,
					)
				: undefined,
		).toBe(2);
	});

	it("shows a select that throws as a failure with the defect", async () => {
		const client = await makeClient();
		const query = todos([buy]);
		const boom = new Error("bad select");
		let seen: AsyncResult.AsyncResult<never, never> | undefined;
		const Throws = () => {
			seen = useQuery(query, {
				select: (): never => {
					throw boom;
				},
			});
			return null;
		};
		render(withClient(client, <Throws />));

		await vi.waitFor(() => expect(seen?._tag).toBe("Failure"));
		const cause = (seen as AsyncResult.Failure<never, never>).cause;
		expect(Cause.squash(cause)).toBe(boom);
	});

	it("keeps the last selection with keepPrevious", async () => {
		const client = await makeClient();
		const slow = gate();
		const page = Query.family({
			key: ["select-page"],
			run: (n: number) =>
				n === 1
					? Effect.succeed({ n, items: [n] })
					: Effect.as(slow.wait, { n, items: [n, n] }),
		});
		const Page = ({ n }: { readonly n: number }) => (
			<p data-testid="result">
				{show(
					useQuery(page(n), {
						keepPrevious: true,
						select: (data) => data.items.length,
					}),
				)}
			</p>
		);
		const view = render(withClient(client, <Page n={1} />));
		await vi.waitFor(() => expect(text()).toBe("Success 1"));

		view.rerender(withClient(client, <Page n={2} />));
		expect(text()).toBe("Success(waiting) 1");

		await act(async () => slow.open());
		await vi.waitFor(() => expect(text()).toBe("Success 2"));
	});

	it("runs the mount policy as without select", async () => {
		const client = await makeClient();
		const { query, fetches } = tracked(["select-mount"], (fetch) =>
			Effect.succeed(fetch),
		);
		const Doubled = () => (
			<p data-testid="result">
				{show(useQuery(query, { select: (n) => n * 2 }))}
			</p>
		);
		const view = render(withClient(client, <Doubled />));
		await vi.waitFor(() => expect(text()).toBe("Success 2"));

		view.unmount();
		render(withClient(client, <Doubled />));

		await vi.waitFor(() => expect(text()).toBe("Success 4"));
		expect(fetches.count).toBe(2);
	});

	it("selects in a server render", async () => {
		const client = await makeClient();
		const query = todos([buy, walk]);
		await client.fetch(query);

		const Count = () => (
			<p>{show(useQuery(query, { select: (list) => list.length }))}</p>
		);

		const html = renderToString(withClient(client, <Count />));

		expect(html).toContain("Success 2");
	});
});

describe("select's regressions", () => {
	it("doesn't carry one query's selection to the next when select throws", async () => {
		const client = await makeClient();
		const owner = Query.family({
			key: ["owner"],
			run: (id: number) =>
				Effect.succeed(
					id === 1 ? { owner: { name: "Ada" } } : { owner: null },
				),
		});
		await client.fetch(owner(2));
		let seen: UseQueryStateResult<string, never> | undefined;
		const Owner = ({ id }: { readonly id: number }) => {
			seen = useQueryState(owner(id), {
				select: (todo) => todo.owner!.name,
			});
			return null;
		};
		const view = render(withClient(client, <Owner id={1} />));
		await vi.waitFor(() => expect(seen?.data).toBe("Ada"));

		view.rerender(withClient(client, <Owner id={2} />));

		expect(seen?.status).toBe("failure");
		expect(seen?.data).toBeUndefined();
	});

	it("keeps a failure's own error when select throws on its previous value", async () => {
		const client = await makeClient();
		const { query } = tracked(["select-typed"], (fetch) =>
			fetch === 1
				? Effect.succeed({
						profile: null as { readonly name: string } | null,
					})
				: Effect.fail("offline"),
		);
		let seen: UseQueryStateResult<string, string> | undefined;
		const Reader = () => {
			seen = useQueryState(query, {
				select: (user) => user.profile?.name ?? "anonymous",
			});
			return null;
		};
		render(withClient(client, <Reader />));
		await vi.waitFor(() => expect(seen?.data).toBe("anonymous"));
		const throwing = (user: {
			readonly profile: { readonly name: string } | null;
		}) => user.profile!.name;
		const Throwing = () => {
			seen = useQueryState(query, { select: throwing });
			return null;
		};
		cleanup();
		render(withClient(client, <Throwing />));
		await act(() => client.runPromise(Query.refetch(query)));

		expect(seen?.status).toBe("failure");
		expect(seen?.error).toBe("offline");
		expect(seen?.data).toBeUndefined();
	});
});

describe("useSuspenseQuery with select", () => {
	it("suspends, then shows the selection", async () => {
		const client = await makeClient();
		const slow = gate();
		const query = Query.make({
			key: ["suspense-select"],
			run: Effect.as(slow.wait, { name: "Ada Lovelace" }),
		});
		const renders = { count: 0 };
		const First = () => {
			renders.count++;
			const { value } = useSuspenseQuery(query, {
				select: (user) => user.name.split(" ")[0],
			});
			return <p data-testid="result">{value}</p>;
		};
		render(
			withClient(
				client,
				<React.Suspense fallback={<p>loading</p>}>
					<First />
				</React.Suspense>,
			),
		);
		expect(await screen.findByText("loading")).toBeDefined();
		await act(async () => slow.open());
		expect(await screen.findByText("Ada")).toBeDefined();
		const settled = renders.count;

		await setValue(client, query, { name: "Ada Byron" });

		expect(renders.count).toBe(settled);
		expect(text()).toBe("Ada");
	});

	it("throws a select that throws to the error boundary", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		const query = Query.make({
			key: ["suspense-throws"],
			run: Effect.succeed(1),
		});
		await client.fetch(query);
		const Throws = () => {
			useSuspenseQuery(query, {
				select: (): number => {
					throw new Error("bad select");
				},
			});
			return null;
		};
		render(
			withClient(
				client,
				<QueryBoundary
					failure={({ error }) => (
						<p data-testid="result">{(error as Error).message}</p>
					)}
				>
					<Throws />
				</QueryBoundary>,
			),
		);

		await vi.waitFor(() => expect(text()).toBe("bad select"));
	});
});

describe("useSuspenseQuery with a select that throws", () => {
	it("throws to the boundary after an earlier selection was shown", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		const query = Query.make({
			key: ["suspense-later-throw"],
			run: Effect.succeed({
				profile: { name: "Ada" } as { readonly name: string } | null,
			}),
		});
		const Name = () => (
			<p data-testid="result">
				{
					useSuspenseQuery(query, {
						select: (user) => user.profile!.name,
					}).value
				}
			</p>
		);
		render(
			withClient(
				client,
				<QueryBoundary
					failure={() => <p data-testid="result">select failed</p>}
				>
					<Name />
				</QueryBoundary>,
			),
		);
		await vi.waitFor(() => expect(text()).toBe("Ada"));

		await setValue(client, query, { profile: null });

		await vi.waitFor(() => expect(text()).toBe("select failed"));
	});

	it("shows the failure again after retry instead of suspending in a loop", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		const slow = gate();
		const { query, fetches } = tracked(["suspense-retry-throw"], (fetch) =>
			fetch === 1 ? Effect.succeed(1) : Effect.as(slow.wait, fetch),
		);
		const renders = { count: 0 };
		const Bad = () => {
			renders.count++;
			useSuspenseQuery(query, {
				select: (): number => {
					throw new Error("bad select");
				},
			});
			return null;
		};
		render(
			withClient(
				client,
				<QueryBoundary
					pending={<p>loading</p>}
					failure={({ retry }) => (
						<button type="button" onClick={retry}>
							retry
						</button>
					)}
				>
					<Bad />
				</QueryBoundary>,
			),
		);
		const button = await screen.findByText("retry");

		await act(async () => button.click());

		expect(await screen.findByText("retry")).toBeDefined();
		expect(renders.count).toBeLessThan(20);
		await act(async () => slow.open());
		expect(fetches.count).toBe(2);
	});
});

describe("useQueryState", () => {
	const describeState = (state: UseQueryStateResult<unknown, unknown>) =>
		[
			state.status,
			state.isFetching ? "fetching" : "idle",
			JSON.stringify(state.data),
			state.error === undefined ? "-" : String(state.error),
		].join(" ");

	const State = <A, E>({
		query,
	}: {
		readonly query: Query.Query<A, E> | null;
	}) => <p data-testid="result">{describeState(useQueryState(query))}</p>;

	it("is pending, then succeeds", async () => {
		const client = await makeClient();
		const slow = gate();
		const query = Query.make({
			key: ["state"],
			run: Effect.as(slow.wait, "Ada"),
		});
		render(withClient(client, <State query={query} />));
		expect(text()).toBe("pending fetching  -");

		await act(async () => slow.open());

		await vi.waitFor(() => expect(text()).toBe('success idle "Ada" -'));
	});

	it("keeps data through a refetch, and after it fails", async () => {
		const client = await makeClient();
		const slow = gate();
		const { query } = tracked(["state-kept"], (fetch) =>
			fetch === 1
				? Effect.succeed("Ada")
				: Effect.andThen(slow.wait, Effect.fail("offline")),
		);
		render(withClient(client, <State query={query} />));
		await vi.waitFor(() => expect(text()).toBe('success idle "Ada" -'));

		act(() => void client.refetch(query));
		await vi.waitFor(() => expect(text()).toBe('success fetching "Ada" -'));
		await act(async () => slow.open());

		await vi.waitFor(() => expect(text()).toBe('failure idle "Ada" offline'));
	});

	it("leaves error undefined for a defect, which cause holds", async () => {
		const client = await makeClient();
		const boom = new Error("boom");
		const query = Query.make({
			key: ["state-defect"],
			run: Effect.die(boom),
		});
		let seen: UseQueryStateResult<never, never> | undefined;
		const Reader = () => {
			seen = useQueryState(query);
			return null;
		};
		render(withClient(client, <Reader />));

		await vi.waitFor(() => expect(seen?.status).toBe("failure"));
		expect(seen?.error).toBeUndefined();
		expect(seen?.cause && Cause.squash(seen.cause)).toBe(boom);
		expect(seen?.isFailure).toBe(true);
	});

	it("is pending and not fetching for a null query", async () => {
		const client = await makeClient();
		let seen: UseQueryStateResult<unknown, unknown> | undefined;
		const Reader = () => {
			seen = useQueryState(null);
			return null;
		};
		render(withClient(client, <Reader />));

		expect(seen?.status).toBe("pending");
		expect(seen?.isPending).toBe(true);
		expect(seen?.isFetching).toBe(false);
		await expect(seen?.refetch()).resolves.toBeUndefined();
	});

	it("refetches, resolves when settled, and never rejects", async () => {
		const client = await makeClient();
		const { query, fetches } = tracked(["state-refetch"], (fetch) =>
			fetch === 1 ? Effect.succeed(1) : Effect.fail("offline"),
		);
		let seen: UseQueryStateResult<number, string> | undefined;
		const Reader = () => {
			seen = useQueryState(query);
			return null;
		};
		render(withClient(client, <Reader />));
		await vi.waitFor(() => expect(seen?.status).toBe("success"));

		await act(() => seen!.refetch());

		expect(fetches.count).toBe(2);
		expect(seen?.status).toBe("failure");
	});

	it("keeps its identity while nothing changes, and applies select", async () => {
		const client = await makeClient();
		const query = todos([buy, walk]);
		const seen: Array<UseQueryStateResult<number, never>> = [];
		const Reader = ({ tick }: { readonly tick: number }) => {
			seen.push(useQueryState(query, { select: (list) => list.length }));
			return <p data-testid="result">{tick}</p>;
		};
		const view = render(withClient(client, <Reader tick={1} />));
		await vi.waitFor(() => expect(seen.at(-1)?.status).toBe("success"));

		view.rerender(withClient(client, <Reader tick={2} />));

		expect(seen.at(-1)).toBe(seen.at(-2));
		expect(seen.at(-1)?.data).toBe(2);
	});
});

describe("QueryBoundary", () => {
	const Name = ({
		query,
	}: {
		readonly query: Query.Query<string, unknown>;
	}) => <p data-testid="result">{useSuspenseQuery(query).value}</p>;

	const failure = ({
		error,
		retry,
	}: {
		readonly error: unknown;
		readonly retry: () => void;
	}) => (
		<button type="button" onClick={retry}>
			failed: {String(error)}
		</button>
	);

	it("shows pending, then the children", async () => {
		const client = await makeClient();
		const slow = gate();
		const query = Query.make({
			key: ["boundary"],
			run: Effect.as(slow.wait, "Ada"),
		});
		render(
			withClient(
				client,
				<QueryBoundary pending={<p>loading</p>} failure={failure}>
					<Name query={query} />
				</QueryBoundary>,
			),
		);
		expect(await screen.findByText("loading")).toBeDefined();

		await act(async () => slow.open());

		expect(await screen.findByText("Ada")).toBeDefined();
	});

	it("shows failure, and retry refetches and shows the children", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		const { query, fetches } = tracked(["boundary-retry"], (fetch) =>
			fetch === 1 ? Effect.fail("offline") : Effect.succeed("Ada"),
		);
		render(
			withClient(
				client,
				<QueryBoundary pending={<p>loading</p>} failure={failure}>
					<Name query={query} />
				</QueryBoundary>,
			),
		);
		const button = await screen.findByText("failed: offline");

		await act(async () => button.click());

		expect(await screen.findByText("Ada")).toBeDefined();
		expect(fetches.count).toBe(2);
	});

	it("shows the children again when the failed query succeeds elsewhere", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		const { query } = tracked(["boundary-recovers"], (fetch) =>
			fetch === 1 ? Effect.fail("offline") : Effect.succeed("Ada"),
		);
		render(
			withClient(
				client,
				<QueryBoundary pending={<p>loading</p>} failure={failure}>
					<Name query={query} />
				</QueryBoundary>,
			),
		);
		await screen.findByText("failed: offline");

		await act(() => client.refetch(query));

		expect(await screen.findByText("Ada")).toBeDefined();
	});

	it("passes the error and its cause", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		const query = Query.make({
			key: ["boundary-cause"],
			run: Effect.fail("offline") as Effect.Effect<string, string>,
		});
		const seen: Array<Cause.Cause<unknown>> = [];
		render(
			withClient(
				client,
				<QueryBoundary
					failure={({ cause }) => {
						seen.push(cause);
						return <p data-testid="result">caught</p>;
					}}
				>
					<Name query={query} />
				</QueryBoundary>,
			),
		);

		await vi.waitFor(() => expect(text()).toBe("caught"));
		expect(seen[0] && Cause.squash(seen[0])).toBe("offline");
	});

	it("passes other errors to the next boundary up", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		const Crash = (): React.ReactNode => {
			throw new Error("not a query");
		};
		render(
			withClient(
				client,
				<Outer>
					<QueryBoundary failure={() => <p>inner</p>}>
						<Crash />
					</QueryBoundary>
				</Outer>,
			),
		);

		expect(await screen.findByText("outer: not a query")).toBeDefined();
	});

	it("catches in the nearest of nested boundaries", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		const failing = Query.make({
			key: ["inner"],
			run: Effect.fail("no") as Effect.Effect<string, string>,
		});
		const fine = Query.make({ key: ["outer"], run: Effect.succeed("fine") });
		render(
			withClient(
				client,
				<QueryBoundary failure={() => <p>outer failed</p>}>
					<Name query={fine} />
					<QueryBoundary failure={() => <p>inner failed</p>}>
						<Name query={failing} />
					</QueryBoundary>
				</QueryBoundary>,
			),
		);

		expect(await screen.findByText("inner failed")).toBeDefined();
		expect(screen.getByText("fine")).toBeDefined();
	});

	it("shows pending in a server render", async () => {
		const client = await makeClient();
		const query = Query.make({
			key: ["boundary-ssr"],
			run: Effect.never as Effect.Effect<string>,
		});

		const html = renderToString(
			withClient(
				client,
				<QueryBoundary pending={<p>loading</p>} failure={failure}>
					<Name query={query} />
				</QueryBoundary>,
			),
		);

		expect(html).toContain("loading");
	});
});

class Outer extends React.Component<
	{ readonly children: React.ReactNode },
	{ readonly error: unknown }
> {
	override state = { error: undefined as unknown };
	static getDerivedStateFromError(error: unknown) {
		return { error };
	}
	override render() {
		return this.state.error === undefined ? (
			this.props.children
		) : (
			<p>outer: {(this.state.error as Error).message}</p>
		);
	}
}
