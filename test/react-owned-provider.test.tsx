// @vitest-environment happy-dom
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Query, QueryClient } from "../src/index.js";
import {
	HydrationBoundary,
	MissingQueryProviderError,
	QueryProvider,
	useQuery,
	useQueryClient,
} from "../src/react/index.js";
import {
	disposeClients,
	gate,
	makeClient,
	show,
	tracked,
	useFakeTimers,
} from "./helpers.js";
import { servicesLayer } from "./services.js";

/** A `make` that records the clients it makes and the ones disposed. */
const owner = (dispose?: () => Promise<void>) => {
	const made: Array<QueryClient.QueryClient> = [];
	const disposed: Array<QueryClient.QueryClient> = [];
	const make = (): QueryClient.QueryClient => {
		const inner = QueryClient.make({ layer: servicesLayer("hello") });
		const client: QueryClient.QueryClient = {
			...inner,
			dispose: () => {
				disposed.push(client);
				return dispose === undefined
					? inner.dispose()
					: inner.dispose().then(dispose);
			},
		};
		made.push(client);
		return client;
	};
	return { make, made, disposed };
};

let owners: Array<ReturnType<typeof owner>> = [];

const track = (dispose?: () => Promise<void>) => {
	const record = owner(dispose);
	owners.push(record);
	return record;
};

afterEach(async () => {
	cleanup();
	vi.useRealTimers();
	// Unmounting disposes a tick later.
	await new Promise((resolve) => setTimeout(resolve, 0));
	await Promise.all(
		owners.flatMap(({ made, disposed }) =>
			made
				.filter((client) => !disposed.includes(client))
				.map((client) => client.dispose()),
		),
	);
	owners = [];
	await disposeClients();
});

/** Records the client each render sees, with the key it rendered for. */
const SeesClient = ({
	resetKey,
	seen,
}: {
	readonly resetKey: string;
	readonly seen: Array<readonly [string, QueryClient.QueryClient]>;
}) => {
	seen.push([resetKey, useQueryClient()]);
	return null;
};

const Shows = <A, E>({ query }: { readonly query: Query.Query<A, E> }) => (
	<p data-testid="result">{show(useQuery(query))}</p>
);

const text = () => screen.getByTestId("result").textContent;

describe("QueryProvider with make", () => {
	it("makes one client across renders with a new make each time", async () => {
		const { make, made, disposed } = track();
		const seen: Array<readonly [string, QueryClient.QueryClient]> = [];
		const app = () => (
			<QueryProvider make={() => make()} resetKey="a">
				<SeesClient resetKey="a" seen={seen} />
			</QueryProvider>
		);

		const { rerender } = render(app());
		rerender(app());
		rerender(app());

		expect(made).toHaveLength(1);
		expect(seen.every(([, client]) => client === made[0])).toBe(true);
		expect(disposed).toEqual([]);
	});

	it("makes a client without a resetKey", async () => {
		const { make, made } = track();
		const { query } = tracked(["keyless"], () => Effect.succeed(1));

		render(
			<QueryProvider make={make}>
				<Shows query={query} />
			</QueryProvider>,
		);

		await vi.waitFor(() => expect(text()).toBe("Success 1"));
		expect(made).toHaveLength(1);
	});

	describe("when resetKey changes", () => {
		it("renders the children with the new client from the first render, and disposes the old", async () => {
			const { make, made, disposed } = track();
			const seen: Array<readonly [string, QueryClient.QueryClient]> = [];
			const app = (key: string) => (
				<QueryProvider make={make} resetKey={key}>
					<SeesClient resetKey={key} seen={seen} />
				</QueryProvider>
			);
			const { rerender } = render(app("a"));

			await act(async () => rerender(app("b")));

			expect(made).toHaveLength(2);
			expect(
				seen.map(([key, client]) => [key, made.indexOf(client)]),
			).toEqual(seen.map(([key]) => [key, key === "a" ? 0 : 1]));
			expect(seen.some(([key]) => key === "b")).toBe(true);
			expect(disposed).toEqual([made[0]]);
		});

		it("interrupts the old client's fetches, and the new client fetches afresh", async () => {
			const { make, made } = track();
			const held = gate();
			const interrupted = { count: 0 };
			const { query, fetches } = tracked(["account"], (fetch) =>
				fetch === 1
					? held.wait.pipe(
							Effect.as(fetch),
							Effect.onInterrupt(() =>
								Effect.sync(() => {
									interrupted.count += 1;
								}),
							),
						)
					: Effect.succeed(fetch),
			);
			const app = (key: string) => (
				<QueryProvider make={make} resetKey={key}>
					<Shows query={query} />
				</QueryProvider>
			);
			const { rerender } = render(app("a"));
			await vi.waitFor(() => expect(fetches.count).toBe(1));

			await act(async () => rerender(app("b")));

			await vi.waitFor(() => expect(text()).toBe("Success 2"));
			await vi.waitFor(() => expect(interrupted.count).toBe(1));
			expect(made[0]?.registry.getNodes().size).toBe(0);
		});

		/** A sendable todo list, and the server that dehydrates it. */
		const serverTodos = () => {
			const { query: todos, fetches } = tracked(
				["todos"],
				(fetch) => Effect.succeed([`Fetch ${fetch}`]),
				{ staleTime: "1 minute" },
			);
			const sendable = Query.make({
				key: ["todos"],
				run: Query.fetch(todos),
				staleTime: "1 minute",
				schema: { success: Schema.Array(Schema.String) },
			});
			const dehydrate = async () => {
				const server = await makeClient();
				await server.runPromise(Query.prefetch(sendable));
				return JSON.parse(
					JSON.stringify(QueryClient.dehydrate(server)),
				) as QueryClient.DehydratedState;
			};
			return { sendable, fetches, dehydrate };
		};

		it("doesn't load the previous key's server state into the new client", async () => {
			const { sendable, fetches, dehydrate } = serverTodos();
			const sent = await dehydrate();
			const { make } = track();
			const app = (key: string) => (
				<QueryProvider make={make} resetKey={key}>
					<HydrationBoundary state={sent}>
						<Shows query={sendable} />
					</HydrationBoundary>
				</QueryProvider>
			);
			const { rerender } = render(app("a"));
			expect(text()).toBe('Success ["Fetch 1"]');

			await act(async () => rerender(app("b")));

			await vi.waitFor(() => expect(text()).toBe('Success ["Fetch 2"]'));
			expect(fetches.count).toBe(2);
		});

		it("loads server state dehydrated after the change", async () => {
			const { sendable, fetches, dehydrate } = serverTodos();
			const first = await dehydrate();
			const { make } = track();
			const app = (key: string, state: QueryClient.DehydratedState) => (
				<QueryProvider make={make} resetKey={key}>
					<HydrationBoundary state={state}>
						<Shows query={sendable} />
					</HydrationBoundary>
				</QueryProvider>
			);
			const { rerender } = render(app("a", first));
			await act(async () => rerender(app("b", first)));
			await vi.waitFor(() => expect(text()).toBe('Success ["Fetch 2"]'));
			vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
			const next = await dehydrate();

			await act(async () => rerender(app("b", next)));

			expect(text()).toBe('Success ["Fetch 3"]');
			expect(fetches.count).toBe(3);
		});

		it("disposes a client made for a render that never committed, once it unmounts", async () => {
			const { make, made, disposed } = track();
			const never = new Promise<never>(() => {});
			const SuspendsOn = ({ resetKey }: { readonly resetKey: string }) => {
				if (resetKey === "b") {
					React.use(never);
				}
				return null;
			};
			let setKey: (key: string) => void = () => {};
			const App = () => {
				const [key, set] = React.useState("a");
				setKey = set;
				return (
					<React.Suspense fallback={null}>
						<QueryProvider make={make} resetKey={key}>
							<SuspendsOn resetKey={key} />
						</QueryProvider>
					</React.Suspense>
				);
			};
			const { unmount } = render(<App />);

			await act(async () => React.startTransition(() => setKey("b")));
			expect(made).toHaveLength(2);
			expect(disposed).toEqual([]);
			unmount();

			await vi.waitFor(() => expect(disposed).toHaveLength(2));
			expect(new Set(disposed)).toEqual(new Set(made));
		});
	});

	it("disposes its client once, a tick after it unmounts", async () => {
		useFakeTimers();
		const { make, made, disposed } = track();
		const { unmount } = render(<QueryProvider make={make} resetKey="a" />);

		unmount();
		expect(disposed).toEqual([]);
		await vi.advanceTimersByTimeAsync(0);

		expect(disposed).toEqual([made[0]]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(disposed).toHaveLength(1);
	});

	it("keeps one working client under StrictMode", async () => {
		useFakeTimers();
		const { make, made, disposed } = track();
		const { query } = tracked(["strict"], () => Effect.succeed(1));

		render(
			<React.StrictMode>
				<QueryProvider make={make} resetKey="a">
					<Shows query={query} />
				</QueryProvider>
			</React.StrictMode>,
		);
		await vi.advanceTimersByTimeAsync(10);

		expect(text()).toBe("Success 1");
		expect(made).toHaveLength(1);
		expect(disposed).toEqual([]);
	});

	it("logs a dispose that fails, rather than leaving it unhandled", async () => {
		const failure = new Error("finalizer failed");
		const { make } = track(() => Promise.reject(failure));
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const app = (key: string) => <QueryProvider make={make} resetKey={key} />;
		const { rerender } = render(app("a"));

		await act(async () => rerender(app("b")));

		await vi.waitFor(() =>
			expect(errors).toHaveBeenCalledWith(
				"Disposing the QueryProvider's query client failed:",
				failure,
			),
		);
	});

	it("switches to a client you own, and back", async () => {
		const { make, made, disposed } = track();
		const yours = await makeClient();
		const seen: Array<readonly [string, QueryClient.QueryClient]> = [];
		const { rerender } = render(
			<QueryProvider make={make} resetKey="a">
				<SeesClient resetKey="owned" seen={seen} />
			</QueryProvider>,
		);

		await act(async () =>
			rerender(
				<QueryProvider client={yours}>
					<SeesClient resetKey="yours" seen={seen} />
				</QueryProvider>,
			),
		);
		expect(disposed).toEqual([made[0]]);
		await act(async () =>
			rerender(
				<QueryProvider make={make} resetKey="a">
					<SeesClient resetKey="owned again" seen={seen} />
				</QueryProvider>,
			),
		);

		expect(made).toHaveLength(2);
		expect(seen.map(([key, client]) => [key, client])).toEqual(
			seen.map(([key]) => [
				key,
				key === "owned" ? made[0] : key === "yours" ? yours : made[1],
			]),
		);
		expect(disposed).toEqual([made[0]]);
	});
});

describe("QueryProvider with client", () => {
	it("doesn't fall through to an outer provider when its client is missing", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const outer = await makeClient();
		const Reads = () => {
			useQueryClient();
			return null;
		};

		expect(() =>
			render(
				<QueryProvider client={outer}>
					<QueryProvider client={undefined as never}>
						<Reads />
					</QueryProvider>
				</QueryProvider>,
			),
		).toThrow(MissingQueryProviderError);
	});

	it("never disposes it", async () => {
		useFakeTimers();
		const client = await makeClient();
		const dispose = vi.spyOn(client, "dispose");
		const { unmount } = render(<QueryProvider client={client} />);

		unmount();
		await vi.advanceTimersByTimeAsync(10);

		expect(dispose).not.toHaveBeenCalled();
	});
});
