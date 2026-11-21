// @vitest-environment happy-dom
import { useAtomValue } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	InfiniteQuery,
	Mutation,
	Query,
	type QueryClient,
} from "../src/index.js";
import {
	type InfinitePageControls,
	MissingQueryProviderError,
	QueryFailure,
	QueryProvider,
	useIsFetching,
	useIsMutating,
	useMutation,
	useMutationState,
	useQuery,
	useQueryClient,
	useRefetch,
	useInfiniteQuery,
	useResetQueryFailure,
	useSuspenseInfiniteQuery,
	useSuspenseQuery,
} from "../src/react/index.js";
import {
	dispose,
	disposeClients,
	gate,
	makeClient,
	manualSignals,
	show,
	tracked,
	useFakeTimers,
} from "./helpers.js";

afterEach(async () => {
	cleanup();
	await disposeClients();
});

const withClient = (client: QueryClient.QueryClient, node: React.ReactNode) => (
	<QueryProvider client={client}>{node}</QueryProvider>
);

const Shows = <A, E>({
	query,
	label = "result",
}: {
	readonly query: Query.Query<A, E> | null;
	readonly label?: string;
}) => <p data-testid={label}>{show(useQuery(query))}</p>;

const text = (label = "result") => screen.getByTestId(label).textContent;

class Boundary extends React.Component<
	{
		readonly children: React.ReactNode;
		readonly fallback: (error: unknown, retry: () => void) => React.ReactNode;
	},
	{ readonly error: unknown; readonly failed: boolean }
> {
	override state = { error: undefined as unknown, failed: false };
	static getDerivedStateFromError(error: unknown) {
		return { error, failed: true };
	}
	override render() {
		return this.state.failed
			? this.props.fallback(this.state.error, () =>
					this.setState({ error: undefined, failed: false }),
				)
			: this.props.children;
	}
}

describe("QueryProvider and useQueryClient", () => {
	it("provide the client, and atom-react's hooks share its cache", async () => {
		const client = await makeClient();
		const { query, fetches } = tracked(["shared"], () => Effect.succeed(1));
		let seen: QueryClient.QueryClient | undefined;
		const Raw = () => {
			seen = useQueryClient();
			return <p data-testid="raw">{show(useAtomValue(query))}</p>;
		};

		render(
			withClient(
				client,
				<>
					<Shows query={query} />
					<Raw />
				</>,
			),
		);

		await vi.waitFor(() => expect(text()).toBe("Success 1"));
		expect(text("raw")).toBe("Success 1");
		expect(seen).toBe(client);
		expect(fetches.count).toBe(1);
	});

	it("useQueryClient throws outside a provider", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const Lost = () => {
			useQueryClient();
			return null;
		};

		expect(() => render(<Lost />)).toThrow(MissingQueryProviderError);
	});

	it("the other hooks throw outside a provider too", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const query = Query.make({ key: ["lost"], run: Effect.succeed(1) });

		expect(() => render(<Shows query={query} />)).toThrow(
			MissingQueryProviderError,
		);
	});
});

describe("useQuery", () => {
	it("fetches once, under StrictMode's double render and effects", async () => {
		const client = await makeClient();
		const { query, fetches } = tracked(["strict"], () => Effect.succeed("a"));

		render(
			<React.StrictMode>
				{withClient(client, <Shows query={query} />)}
			</React.StrictMode>,
		);

		expect(await screen.findByText('Success "a"')).toBeDefined();
		expect(fetches.count).toBe(1);
	});

	it("gives Initial for null and fetches nothing", async () => {
		const client = await makeClient();
		const { query, fetches } = tracked(["unused"], () => Effect.succeed(1));

		render(withClient(client, <Shows query={null} />));
		await act(() => Promise.resolve());

		expect(text()).toBe("Initial");
		expect(fetches.count).toBe(0);
		expect(client.registry.getNodes().has(query)).toBe(false);
	});

	it("revalidates a query read again after null", async () => {
		const client = await makeClient();
		const { query, fetches } = tracked(["toggled"], (fetch) =>
			Effect.succeed(fetch),
		);
		const view = render(withClient(client, <Shows query={query} />));
		expect(text()).toBe("Success 1");

		view.rerender(withClient(client, <Shows query={null} />));
		expect(text()).toBe("Initial");
		view.rerender(withClient(client, <Shows query={query} />));

		await vi.waitFor(() => expect(text()).toBe("Success 2"));
		expect(fetches.count).toBe(2);
	});

	it("refetches a failure on remount and shows the success (G2)", async () => {
		const client = await makeClient();
		const { query, fetches } = tracked(["flaky"], (fetch) =>
			fetch === 1 ? Effect.fail("boom") : Effect.succeed("ok"),
		);
		const view = render(withClient(client, <Shows query={query} />));
		expect(await screen.findByText("Failure")).toBeDefined();

		view.unmount();
		render(withClient(client, <Shows query={query} />));

		expect(await screen.findByText('Success "ok"')).toBeDefined();
		expect(fetches.count).toBe(2);
	});

	it("keeps the previous success across family arguments with keepPrevious", async () => {
		const client = await makeClient();
		const slow = gate();
		const page = Query.family({
			key: ["page"],
			run: (n: number) =>
				n === 1 ? Effect.succeed(n) : Effect.as(slow.wait, n),
		});
		const Page = ({
			n,
			keep,
		}: {
			readonly n: number;
			readonly keep: boolean;
		}) => (
			<p data-testid="result">
				{show(useQuery(page(n), { keepPrevious: keep }))}
			</p>
		);
		const view = render(withClient(client, <Page n={1} keep />));
		expect(await screen.findByText("Success 1")).toBeDefined();

		view.rerender(withClient(client, <Page n={2} keep />));
		expect(text()).toBe("Success(waiting) 1");
		view.rerender(withClient(client, <Page n={2} keep={false} />));
		expect(text()).toBe("Initial(waiting)");

		await act(async () => slow.open());
		expect(await screen.findByText("Success 2")).toBeDefined();
	});

	it("reads only the cache in a server render", async () => {
		const client = await makeClient();
		const { query, fetches } = tracked(["ssr"], () => Effect.succeed(1));

		const html = renderToString(withClient(client, <Shows query={query} />));

		expect(html).toContain("Initial(waiting)");
		expect(fetches.count).toBe(0);

		await client.runPromise(Query.fetch(query));
		expect(
			renderToString(withClient(client, <Shows query={query} />)),
		).toContain("Success 1");
	});

	it("an unmount mid-fetch interrupts the fetch, which reaches no hook", async () => {
		const keys: Array<Query.Key> = [];
		const settled = ({ key }: { readonly key: Query.Key }) =>
			Effect.sync(() => keys.push(key));
		const client = await makeClient({ queries: { onSettled: settled } });
		const query = Query.make({ key: ["left"], run: Effect.never, gcTime: 0 });
		const view = render(withClient(client, <Shows query={query} />));
		expect(text()).toBe("Initial(waiting)");

		view.unmount();
		await vi.waitFor(() =>
			expect(client.registry.getNodes().has(query)).toBe(false),
		);

		expect(keys).toEqual([["warm-up"]]);
	});
});

describe("useSuspenseQuery", () => {
	const Name = ({
		query,
	}: {
		readonly query: Query.Query<string, string>;
	}) => <p data-testid="result">{useSuspenseQuery(query).value}</p>;

	it("suspends until the first value", async () => {
		const client = await makeClient();
		const slow = gate();
		const query = Query.make({
			key: ["name"],
			run: Effect.as(slow.wait, "Ada"),
		});

		render(
			withClient(
				client,
				<React.Suspense fallback={<p>loading</p>}>
					<Name query={query} />
				</React.Suspense>,
			),
		);
		expect(await screen.findByText("loading")).toBeDefined();
		await act(async () => slow.open());

		expect(await screen.findByText("Ada")).toBeDefined();
	});

	it("throws a QueryFailure, and useResetQueryFailure refetches it (G2)", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		const { query, fetches } = tracked(["user"], (fetch) =>
			fetch === 1 ? Effect.fail("offline") : Effect.succeed("Ada"),
		);
		const Fallback = ({
			error,
			retry,
		}: {
			readonly error: unknown;
			readonly retry: () => void;
		}) => {
			const resetFailure = useResetQueryFailure();
			return (
				<button
					type="button"
					onClick={() => {
						resetFailure(error);
						retry();
					}}
				>
					{QueryFailure.is(error)
						? `failed: ${String(error.error)}`
						: "other"}
				</button>
			);
		};
		render(
			withClient(
				client,
				<Boundary
					fallback={(error, retry) => (
						<Fallback error={error} retry={retry} />
					)}
				>
					<React.Suspense fallback={<p>loading</p>}>
						<Name query={query} />
					</React.Suspense>
				</Boundary>,
			),
		);
		const button = await screen.findByText("failed: offline");

		await act(async () => button.click());

		expect(await screen.findByText("Ada")).toBeDefined();
		expect(fetches.count).toBe(2);
	});

	it("shows a stale value and refetches it in the background", async () => {
		useFakeTimers();
		const client = await makeClient();
		const slow = gate();
		const { query, fetches } = tracked(["stale"], (fetch) =>
			fetch === 1 ? Effect.succeed("Ada") : Effect.as(slow.wait, "Grace"),
		);
		await client.runPromise(Query.fetch(query));
		await vi.advanceTimersByTimeAsync(2_000);

		render(
			withClient(
				client,
				<React.Suspense fallback={<p>loading</p>}>
					<Name query={query} />
				</React.Suspense>,
			),
		);

		expect(text()).toBe("Ada");
		expect(fetches.count).toBe(2);
		await act(async () => slow.open());
		await vi.waitFor(() => expect(text()).toBe("Grace"));
	});

	it("doesn't refetch a value it just suspended on as it mounts", async () => {
		const client = await makeClient();
		const slow = gate();
		const { query, fetches } = tracked(["fresh"], () =>
			Effect.as(slow.wait, "Ada"),
		);
		render(
			withClient(
				client,
				<React.Suspense fallback={<p>loading</p>}>
					<Name query={query} />
				</React.Suspense>,
			),
		);
		await act(async () => slow.open());

		expect(await screen.findByText("Ada")).toBeDefined();
		expect(fetches.count).toBe(1);
	});

	it("shows the success before a failure as waiting while it refetches", async () => {
		const client = await makeClient();
		const slow = gate();
		const { query } = tracked(["again"], (fetch) =>
			fetch === 1
				? Effect.succeed("Ada")
				: fetch === 2
					? Effect.fail("offline")
					: Effect.as(slow.wait, "Grace"),
		);
		let seen: AsyncResult.Success<string, string> | undefined;
		const Reader = () => {
			seen = useSuspenseQuery(query);
			return <p data-testid="result">{seen.value}</p>;
		};
		render(
			withClient(
				client,
				<React.Suspense fallback={<p>loading</p>}>
					<Reader />
				</React.Suspense>,
			),
		);
		expect(await screen.findByText("Ada")).toBeDefined();
		await act(() => client.runPromise(Query.refetch(query)));
		expect(seen?.waiting).toBe(false);

		act(() => client.registry.refresh(query));

		expect(text()).toBe("Ada");
		expect(seen?.waiting).toBe(true);
		await act(async () => slow.open());
		await vi.waitFor(() => expect(text()).toBe("Grace"));
	});

	it("throws a QueryFailure for a key JSON can't hold", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		const query = Query.make({ key: ["big", 1n], run: Effect.fail("nope") });
		const Fails = () => {
			useSuspenseQuery(query);
			return null;
		};
		const caught = vi.fn();
		render(
			withClient(
				client,
				<Boundary fallback={(error) => (caught(error), null)}>
					<React.Suspense fallback={<p>loading</p>}>
						<Fails />
					</React.Suspense>
				</Boundary>,
			),
		);

		await vi.waitFor(() => expect(caught).toHaveBeenCalled());
		const [error] = caught.mock.calls[0] ?? [];
		expect(QueryFailure.is(error)).toBe(true);
		expect((error as QueryFailure).message).toBe(
			'Query ["big",1n] failed: "nope"',
		);
	});

	it("starts its fetch in a server render", async () => {
		const client = await makeClient();
		const { query, fetches } = tracked(["streamed"], () =>
			Effect.succeed("Ada"),
		);

		const html = renderToString(
			withClient(
				client,
				<React.Suspense fallback={<p>loading</p>}>
					<Name query={query} />
				</React.Suspense>,
			),
		);

		expect(html).toContain("loading");
		expect(fetches.count).toBe(1);
	});

	it("keeps showing a success when a refetch fails", async () => {
		const client = await makeClient();
		const { query } = tracked(["kept"], (fetch) =>
			fetch === 1 ? Effect.succeed("Ada") : Effect.fail("offline"),
		);
		render(
			withClient(
				client,
				<React.Suspense fallback={<p>loading</p>}>
					<Name query={query} />
				</React.Suspense>,
			),
		);
		expect(await screen.findByText("Ada")).toBeDefined();

		await act(() => client.runPromise(Query.refetch(query)));

		expect(AsyncResult.isFailure(client.registry.get(query))).toBe(true);
		expect(text()).toBe("Ada");
	});
});

describe("useResetQueryFailure", () => {
	it("ignores errors that only look like a QueryFailure", async () => {
		const client = await makeClient();
		let reset: (error: unknown) => void = () => {};
		const Resetter = () => {
			reset = useResetQueryFailure();
			return null;
		};
		render(withClient(client, <Resetter />));

		expect(QueryFailure.is({ _tag: "QueryFailure" })).toBe(false);
		expect(() => reset({ _tag: "QueryFailure" })).not.toThrow();
	});
});

describe("useMutation", () => {
	it("keeps separate state per component (G7)", async () => {
		const client = await makeClient();
		const save = Mutation.make({ run: (n: number) => Effect.succeed(n * 2) });
		const Saver = ({ label }: { readonly label: string }) => {
			const { result, run } = useMutation(save);
			return (
				<button type="button" data-testid={label} onClick={() => run(2)}>
					{show(result)}
				</button>
			);
		};
		render(
			withClient(
				client,
				<>
					<Saver label="a" />
					<Saver label="b" />
				</>,
			),
		);

		await act(async () => screen.getByTestId("a").click());

		expect(await screen.findByText("Success 4")).toBeDefined();
		expect(text("b")).toBe("Initial");
	});

	it("resets to Initial", async () => {
		const client = await makeClient();
		const save = Mutation.make({ run: () => Effect.succeed(1) });
		let controls:
			| ReturnType<typeof useMutation<void, number, never>>
			| undefined;
		const Saver = () => {
			controls = useMutation(save);
			return <p data-testid="result">{show(controls.result)}</p>;
		};
		render(withClient(client, <Saver />));

		await act(async () => {
			await controls?.run();
		});
		expect(text()).toBe("Success 1");
		act(() => controls?.reset());

		expect(text()).toBe("Initial");
	});

	it("drops a run's callbacks after reset", async () => {
		const client = await makeClient();
		const slow = gate();
		const found: Array<string> = [];
		const lookUp = Mutation.make({
			run: (meter: string) => Effect.as(slow.wait, `name of ${meter}`),
		});
		let controls:
			| ReturnType<typeof useMutation<string, string, never>>
			| undefined;
		const Lookup = () => {
			controls = useMutation(lookUp);
			return <p data-testid="result">{show(controls.result)}</p>;
		};
		render(withClient(client, <Lookup />));

		const pending = controls?.run("123", {
			onSuccess: (name) => found.push(name),
		});
		act(() => controls?.reset());
		slow.open();
		await act(async () => {
			await pending;
		});

		expect(found).toEqual([]);
		expect(text()).toBe("Initial");
	});

	it("calls a run's callbacks while mounted, and drops them after unmount", async () => {
		const client = await makeClient();
		const slow = gate();
		const saved: Array<number> = [];
		const save = Mutation.make({
			run: (n: number) =>
				n === 1 ? Effect.succeed(n) : Effect.as(slow.wait, n),
		});
		let run: ((n: number) => Promise<unknown>) | undefined;
		const Saver = () => {
			const controls = useMutation(save);
			run = (n) =>
				controls.run(n, { onSuccess: (value) => saved.push(value) });
			return null;
		};
		const view = render(withClient(client, <Saver />));

		await act(async () => {
			await run?.(1);
		});
		const pending = run?.(2);
		view.unmount();
		slow.open();
		await pending;

		expect(saved).toEqual([1]);
	});
});

describe("useMutation's variables", () => {
	it("shows the change a run is making until it settles", async () => {
		const client = await makeClient();
		const slow = gate();
		const add = Mutation.make({
			run: (title: string) => Effect.as(slow.wait, title),
		});
		let run: ((title: string) => Promise<unknown>) | undefined;
		const Form = () => {
			const controls = useMutation(add);
			run = controls.run;
			return (
				<p data-testid="result">
					{controls.result.waiting ? controls.variables : "idle"}
				</p>
			);
		};
		render(withClient(client, <Form />));

		let pending: Promise<unknown> | undefined;
		act(() => {
			pending = run?.("Buy milk");
		});
		expect(text()).toBe("Buy milk");
		slow.open();
		await act(async () => {
			await pending;
		});

		expect(text()).toBe("idle");
	});
});

describe("useMutationState, useIsMutating and useIsFetching", () => {
	it("list the runs every component started, oldest first", async () => {
		const client = await makeClient();
		const gates = { a: gate(), b: gate() };
		const add = Mutation.make({
			run: (label: "a" | "b") => Effect.as(gates[label].wait, label),
		});
		const Saver = ({ label }: { readonly label: "a" | "b" }) => {
			const { run } = useMutation(add);
			return (
				<button
					type="button"
					data-testid={label}
					onClick={() => run(label)}
				>
					{label}
				</button>
			);
		};
		const Saving = () => {
			const runs = useMutationState(add);
			return (
				<p data-testid="result">
					{runs.map((run) => run.variables).join(",")}:{useIsMutating(add)}
				</p>
			);
		};
		render(
			withClient(
				client,
				<>
					<Saver label="b" />
					<Saver label="a" />
					<Saving />
				</>,
			),
		);

		await act(async () => screen.getByTestId("a").click());
		await act(async () => screen.getByTestId("b").click());
		expect(text()).toBe("a,b:2");
		await act(async () => gates.a.open());
		expect(text()).toBe("b:1");
		await act(async () => gates.b.open());

		expect(text()).toBe(":0");
	});

	it("count the queries fetching, by target", async () => {
		const client = await makeClient();
		const slow = gate();
		const todos = Query.make({ key: ["todos"], run: slow.wait });
		const Counts = () => (
			<p data-testid="result">
				{useIsFetching()}/{useIsFetching(["todos"])}/
				{useIsFetching(["profile"])}
			</p>
		);
		render(withClient(client, <Counts />));
		expect(text()).toBe("0/0/0");

		let fetching: Promise<unknown> | undefined;
		await act(async () => {
			fetching = client.runPromise(Query.fetch(todos));
		});
		expect(text()).toBe("1/1/0");
		slow.open();
		await act(async () => {
			await fetching;
		});

		expect(text()).toBe("0/0/0");
	});

	it("count a fetch that a component starts while rendering, in StrictMode", async () => {
		const client = await makeClient();
		const slow = gate();
		const todos = Query.make({ key: ["todos"], run: slow.wait });
		const errors = vi.spyOn(console, "error");
		const Page = () => (
			<>
				<p data-testid="count">{useIsFetching()}</p>
				<Shows query={todos} />
			</>
		);
		render(
			<React.StrictMode>{withClient(client, <Page />)}</React.StrictMode>,
		);

		await act(async () => {});
		expect(text("count")).toBe("1");
		await act(async () => slow.open());

		expect(text("count")).toBe("0");
		expect(errors).not.toHaveBeenCalled();
		errors.mockRestore();
	});

	it("count a run in progress that started before they mounted", async () => {
		const client = await makeClient();
		const slow = gate();
		const waiting = Mutation.make({ run: () => slow.wait });
		const run = client.runPromise(Mutation.run(waiting));
		await act(async () => {});
		const Count = () => <p data-testid="result">{useIsMutating()}</p>;

		render(withClient(client, <Count />));

		expect(text()).toBe("1");
		slow.open();
		await act(async () => {
			await run;
		});
		expect(text()).toBe("0");
	});

	it("show nothing in progress in a server render", async () => {
		const client = await makeClient();
		const slow = gate();
		const waiting = Mutation.make({
			run: (n: number) => Effect.as(slow.wait, n),
		});
		const query = Query.make({ key: ["slow"], run: slow.wait });
		const runs = [
			client.runPromise(Mutation.run(waiting, 1)),
			client.runPromise(Query.fetch(query)),
		];
		await act(async () => {});
		const Activity = () => (
			<p>
				{useMutationState(waiting).length}/{useIsMutating()}/
				{useIsFetching()}
			</p>
		);

		const html = renderToString(withClient(client, <Activity />));

		expect(html.replaceAll("<!-- -->", "")).toContain("0/0/0");
		slow.open();
		await Promise.all(runs);
	});

	it("drop the runs a disposed client interrupted", async () => {
		const client = await makeClient();
		const waiting = Mutation.make({ run: () => Effect.never });
		const Count = () => <p data-testid="result">{useIsMutating()}</p>;
		render(withClient(client, <Count />));

		await act(async () => {
			void client.runPromiseExit(Mutation.run(waiting));
		});
		expect(text()).toBe("1");
		await act(async () => {
			await dispose(client);
		});

		expect(text()).toBe("0");
	});
});

describe("useRefetch", () => {
	it("is refetching only for its own refetch, not a focus revalidation (G8)", async () => {
		const { focus, signals } = manualSignals();
		const client = await makeClient({ signals });
		const slow = gate();
		const { query, fetches } = tracked(["list"], (fetch) =>
			fetch === 1 ? Effect.succeed(fetch) : Effect.as(slow.wait, fetch),
		);
		let refetch: () => Promise<void> = () => Promise.resolve();
		const seen: Array<boolean> = [];
		const List = () => {
			const result = useQuery(query);
			const controls = useRefetch(["list"]);
			refetch = controls.refetch;
			seen.push(controls.isRefetching);
			return <p data-testid="result">{show(result)}</p>;
		};
		render(withClient(client, <List />));
		expect(await screen.findByText("Success 1")).toBeDefined();

		act(() => client.registry.update(focus, (n) => n + 1));
		expect(text()).toBe("Success(waiting) 1");
		expect(seen.at(-1)).toBe(false);
		await act(async () => slow.open());
		expect(await screen.findByText("Success 2")).toBeDefined();

		let done: Promise<void> = Promise.resolve();
		act(() => {
			done = refetch();
		});
		expect(seen.at(-1)).toBe(true);
		await act(() => done);

		expect(seen.at(-1)).toBe(false);
		expect(fetches.count).toBe(3);
	});

	it("refetches a group made on each render, refetching until every member settles", async () => {
		const client = await makeClient();
		const walletGate = gate();
		const transactionsGate = gate();
		const wallet = tracked(["wallet"], (fetch) =>
			fetch === 1
				? Effect.succeed(fetch)
				: Effect.as(walletGate.wait, fetch),
		);
		const transactions = tracked(["transactions"], (fetch) =>
			fetch === 1
				? Effect.succeed(fetch)
				: Effect.as(transactionsGate.wait, fetch),
		);
		const refetches = new Set<() => Promise<void>>();
		let controls: ReturnType<typeof useRefetch> | undefined;
		const Home = () => {
			useQuery(wallet.query);
			useQuery(transactions.query);
			controls = useRefetch(Query.group(wallet.query, transactions.query));
			refetches.add(controls.refetch);
			return null;
		};
		const view = render(withClient(client, <Home />));
		view.rerender(withClient(client, <Home />));

		let done: Promise<void> = Promise.resolve();
		act(() => {
			done = controls?.refetch() ?? done;
		});
		expect(controls?.isRefetching).toBe(true);
		await act(async () => walletGate.open());
		expect(controls?.isRefetching).toBe(true);
		await act(async () => transactionsGate.open());
		await act(() => done);

		expect(controls?.isRefetching).toBe(false);
		expect([wallet.fetches.count, transactions.fetches.count]).toEqual([
			2, 2,
		]);
		expect(refetches.size).toBe(1);
	});

	it("throws a KeyHoldsTargetError as it renders for a key that holds queries", async () => {
		const client = await makeClient();
		const wallet = tracked(["wallet"], (fetch) => Effect.succeed(fetch));
		const Home = () => {
			useRefetch([wallet.query]);
			return null;
		};

		expect(() => render(withClient(client, <Home />))).toThrow(
			Query.KeyHoldsTargetError,
		);
	});

	it("resolves at once, and isn't refetching, once its client is disposed", async () => {
		const client = await makeClient();
		let controls: ReturnType<typeof useRefetch> | undefined;
		const List = () => {
			controls = useRefetch(["list"]);
			return null;
		};
		render(withClient(client, <List />));
		await dispose(client);

		await expect(controls?.refetch()).resolves.toBeUndefined();
		expect(controls?.isRefetching).toBe(false);
	});
});

describe("useInfiniteQuery and useSuspenseInfiniteQuery", () => {
	class PageFailed {
		readonly _tag = "PageFailed";
	}

	/** Pages of two numbers, up to `last`; `hold` makes the next page wait, `fail` fails it. */
	const numbers = (last = 3) => {
		const state = {
			fetched: [] as Array<number>,
			hold: undefined as Effect.Effect<void> | undefined,
			fail: false,
		};
		const query = InfiniteQuery.make({
			key: ["numbers"],
			initialPageParam: 0,
			run: (page: number) =>
				Effect.suspend(() => {
					state.fetched.push(page);
					const hold = state.hold ?? Effect.void;
					state.hold = undefined;
					if (state.fail) {
						state.fail = false;
						return Effect.andThen(hold, Effect.fail(new PageFailed()));
					}
					return Effect.as(hold, [page * 2, page * 2 + 1]);
				}),
			nextPageParam: (_, __, page) => (page < last ? page + 1 : undefined),
		});
		return { state, query };
	};

	type Numbers = ReturnType<typeof numbers>["query"];

	let more: () => Promise<void> = () => Promise.resolve();

	const describeControls = (
		items: ReadonlyArray<number>,
		controls: InfinitePageControls,
	) =>
		`${items.join(",")}${controls.hasNextPage ? " +more" : ""}${
			controls.isFetchingNextPage ? " loading-next" : ""
		}`;

	const List = ({ query }: { readonly query: Numbers | null }) => {
		const { result, ...controls } = useInfiniteQuery(query);
		more = controls.fetchNextPage;
		const items = AsyncResult.getOrElse(result, () => ({
			pages: [] as ReadonlyArray<ReadonlyArray<number>>,
		})).pages.flat();
		return (
			<p data-testid="result">
				{result._tag} {describeControls(items, controls)}
			</p>
		);
	};

	const SuspenseList = ({ query }: { readonly query: Numbers }) => {
		const { result, ...controls } = useSuspenseInfiniteQuery(query);
		more = controls.fetchNextPage;
		return (
			<p data-testid="result">
				{describeControls(result.value.pages.flat(), controls)}
			</p>
		);
	};

	it("loads more pages, showing the loaded ones meanwhile", async () => {
		const client = await makeClient();
		const { state, query } = numbers(1);
		render(withClient(client, <List query={query} />));
		expect(await screen.findByText("Success 0,1 +more")).toBeDefined();

		const slow = gate();
		state.hold = slow.wait;
		let done: Promise<void> = Promise.resolve();
		act(() => {
			done = more();
		});
		expect(
			await screen.findByText("Success 0,1 +more loading-next"),
		).toBeDefined();
		await act(async () => {
			slow.open();
			await done;
		});

		expect(text()).toBe("Success 0,1,2,3");
		expect(state.fetched).toEqual([0, 1]);
	});

	it("fetches once, under StrictMode's double render and effects", async () => {
		const client = await makeClient();
		const { state, query } = numbers();

		render(
			<React.StrictMode>
				{withClient(client, <List query={query} />)}
			</React.StrictMode>,
		);

		expect(await screen.findByText("Success 0,1 +more")).toBeDefined();
		expect(state.fetched).toEqual([0]);
	});

	it("gives Initial and inert controls for null", async () => {
		const client = await makeClient();
		render(withClient(client, <List query={null} />));

		expect(text()).toBe("Initial ");
		await expect(more()).resolves.toBeUndefined();
	});

	it("suspends only until the first page", async () => {
		const client = await makeClient();
		const { state, query } = numbers();
		const slow = gate();
		state.hold = slow.wait;
		render(
			withClient(
				client,
				<React.Suspense fallback={<p>loading</p>}>
					<SuspenseList query={query} />
				</React.Suspense>,
			),
		);
		expect(await screen.findByText("loading")).toBeDefined();
		await act(async () => slow.open());
		expect(await screen.findByText("0,1 +more")).toBeDefined();

		const next = gate();
		state.hold = next.wait;
		let done: Promise<void> = Promise.resolve();
		act(() => {
			done = more();
		});
		expect(await screen.findByText("0,1 +more loading-next")).toBeDefined();
		expect(screen.queryByText("loading")).toBeNull();
		await act(async () => {
			next.open();
			await done;
		});

		expect(text()).toBe("0,1,2,3 +more");
	});

	it("keeps showing the pages when a page fails, without throwing", async () => {
		const client = await makeClient();
		const { state, query } = numbers();
		render(
			withClient(
				client,
				<Boundary fallback={() => <p>failed</p>}>
					<React.Suspense fallback={<p>loading</p>}>
						<SuspenseList query={query} />
					</React.Suspense>
				</Boundary>,
			),
		);
		expect(await screen.findByText("0,1 +more")).toBeDefined();

		state.fail = true;
		await act(() => more());

		expect(text()).toBe("0,1 +more");
		expect(screen.queryByText("failed")).toBeNull();
		await act(() => more());
		expect(text()).toBe("0,1,2,3 +more");
	});
});

describe("clear", () => {
	const Name = ({ query }: { readonly query: Query.Query<string, never> }) => (
		<p data-testid="result">{useSuspenseQuery(query).value}</p>
	);

	it("leaves a mounted useQuery showing Initial, and a newly mounted one fetches", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(
			["account"],
			(n) => Effect.succeed(n),
			{
				staleTime: "1 hour",
			},
		);
		const { rerender } = render(withClient(client, <Shows query={query} />));
		await act(async () => {});
		expect(text()).toBe("Success 1");

		await act(() => client.clear());
		expect(text()).toBe("Initial");
		expect(fetches.count).toBe(1);

		rerender(
			withClient(
				client,
				<>
					<Shows query={query} />
					<Shows query={query} label="second" />
				</>,
			),
		);
		await act(async () => {});
		expect(fetches.count).toBe(2);
		expect(text("second")).toBe("Success 2");
		expect(text()).toBe("Success 2");
	});

	it("shows a mounted useSuspenseQuery's fallback without fetching", async () => {
		const client = await makeClient();
		const { fetches, query } = tracked(["me"], () => Effect.succeed("Ada"), {
			staleTime: "1 hour",
		});
		render(
			withClient(
				client,
				<React.Suspense fallback={<p>loading</p>}>
					<Name query={query} />
				</React.Suspense>,
			),
		);
		expect(await screen.findByText("Ada")).toBeDefined();

		await act(() => client.clear());

		expect(await screen.findByText("loading")).toBeDefined();
		await act(async () => {});
		expect(fetches.count).toBe(1);

		await act(() => client.invalidate(query));
		expect(await screen.findByText("Ada")).toBeDefined();
		expect(fetches.count).toBe(2);
	});

	it("wakes a query for a new Suspense reader without updating another during render", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		const { fetches, query } = tracked(["shared"], (n) => Effect.succeed(n), {
			staleTime: "1 hour",
		});
		const Reads = ({
			query,
		}: {
			readonly query: Query.Query<number, never>;
		}) => <p data-testid="suspended">{useSuspenseQuery(query).value}</p>;
		const tree = (both: boolean) =>
			withClient(
				client,
				<React.StrictMode>
					<Shows query={query} />
					{both ? (
						<React.Suspense fallback={<p>loading</p>}>
							<Reads query={query} />
						</React.Suspense>
					) : null}
				</React.StrictMode>,
			);
		const { rerender } = render(tree(false));
		await act(async () => {});
		await act(() => client.clear());

		rerender(tree(true));
		await act(async () => {});

		expect(text("suspended")).toBe("2");
		expect(text()).toBe("Success 2");
		expect(fetches.count).toBe(2);
		expect(errors).not.toHaveBeenCalled();
		errors.mockRestore();
	});

	it("doesn't keep showing a cleared value with keepPrevious", async () => {
		const client = await makeClient();
		const { query } = tracked(["previous"], (n) => Effect.succeed(n), {
			staleTime: "1 hour",
		});
		const Keeps = () => (
			<p data-testid="result">
				{show(useQuery(query, { keepPrevious: true }))}
			</p>
		);
		render(withClient(client, <Keeps />));
		await act(async () => {});
		expect(text()).toBe("Success 1");

		await act(() => client.clear());

		expect(text()).toBe("Initial");
	});
});
