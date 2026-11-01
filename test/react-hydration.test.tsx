// @vitest-environment happy-dom
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Query, QueryClient } from "../src/index.js";
import {
	HydrationBoundary,
	QueryProvider,
	useQuery,
	useSuspenseQuery,
} from "../src/react/index.js";
import { dispose, disposeClients, gate, makeClient, show } from "./helpers.js";

afterEach(async () => {
	cleanup();
	await disposeClients();
});

const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });

/** A todo list whose fetches, on any client, are counted. */
const todoList = () => {
	const state = {
		runs: 0,
		hold: undefined as Effect.Effect<void> | undefined,
	};
	const todos = Query.make({
		key: ["todos"],
		staleTime: "1 minute",
		run: Effect.suspend(() => {
			state.runs += 1;
			const list = [{ id: state.runs, title: `Fetch ${state.runs}` }];
			return Effect.as(state.hold ?? Effect.void, list);
		}),
		schema: { success: Schema.Array(Todo) },
	});
	return { state, todos };
};

type Todos = ReturnType<typeof todoList>["todos"];

/** Shows a query's result, and records what each render showed. */
const Shows = ({
	query,
	seen,
}: {
	readonly query: Todos;
	readonly seen?: Array<string> | undefined;
}) => {
	const shown = show(useQuery(query));
	seen?.push(shown);
	return <p data-testid="result">{shown}</p>;
};

const Titles = ({ query }: { readonly query: Todos }) => {
	const { value } = useSuspenseQuery(query);
	return <p>{value.map((todo) => todo.title).join()}</p>;
};

const page = (
	client: QueryClient.QueryClient,
	state: QueryClient.DehydratedState | undefined,
	node: React.ReactNode,
) => (
	<QueryProvider client={client}>
		<HydrationBoundary state={state}>{node}</HydrationBoundary>
	</QueryProvider>
);

const overTheWire = (state: QueryClient.DehydratedState) =>
	JSON.parse(JSON.stringify(state)) as QueryClient.DehydratedState;

describe("HydrationBoundary", () => {
	it("hydrates server HTML with the server's data, without fetching", async () => {
		const { state, todos } = todoList();
		const server = await makeClient();
		await server.runPromise(Query.prefetch(todos));
		const sent = overTheWire(QueryClient.dehydrate(server));
		const html = renderToString(page(server, sent, <Shows query={todos} />));
		await dispose(server);
		expect(html).toContain("Fetch 1");

		const browser = await makeClient();
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const errors = vi.spyOn(console, "error");
		const seen: Array<string> = [];
		render(page(browser, sent, <Shows query={todos} seen={seen} />), {
			container,
			hydrate: true,
		});

		expect(seen[0]).toBe('Success [{"id":1,"title":"Fetch 1"}]');
		expect(screen.getByTestId("result").textContent).toBe(seen[0]);
		expect(errors).not.toHaveBeenCalled();
		expect(state.runs).toBe(1);
	});

	it("loads newer data for a cached query after commit", async () => {
		const { todos } = todoList();
		const browser = await makeClient();
		await browser.runPromise(Query.prefetch(todos));
		const seen: Array<string> = [];
		const { rerender } = render(
			page(browser, undefined, <Shows query={todos} seen={seen} />),
		);
		const server = await makeClient();
		vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
		await server.runPromise(Query.prefetch(todos));
		const sent = overTheWire(QueryClient.dehydrate(server));
		const before = seen.length;

		await act(async () =>
			rerender(page(browser, sent, <Shows query={todos} seen={seen} />)),
		);

		expect(seen.slice(before)).toEqual([
			'Success [{"id":1,"title":"Fetch 1"}]',
			'Success [{"id":2,"title":"Fetch 2"}]',
		]);
	});

	it("loads once under StrictMode's double render", async () => {
		const { state, todos } = todoList();
		const server = await makeClient();
		await server.runPromise(Query.prefetch(todos));
		const sent = overTheWire(QueryClient.dehydrate(server));
		const browser = await makeClient();
		const seen: Array<string> = [];

		render(
			<React.StrictMode>
				{page(browser, sent, <Shows query={todos} seen={seen} />)}
			</React.StrictMode>,
		);
		await act(() => Promise.resolve());

		expect(new Set(seen)).toEqual(
			new Set(['Success [{"id":1,"title":"Fetch 1"}]']),
		);
		expect(state.runs).toBe(1);
	});

	it("renders its children with no state", async () => {
		const { todos } = todoList();
		const browser = await makeClient();
		await browser.runPromise(Query.prefetch(todos));

		render(page(browser, undefined, <Shows query={todos} />));

		expect(screen.getByTestId("result").textContent).toContain("Fetch 1");
	});

	it("streams a query useSuspenseQuery started on the server", async () => {
		const { state, todos } = todoList();
		const server = await makeClient();
		const { wait, open } = gate();
		state.hold = wait;
		const stream = await renderToReadableStream(
			page(
				server,
				undefined,
				<React.Suspense fallback={<p>loading</p>}>
					<Titles query={todos} />
				</React.Suspense>,
			),
		);
		const sent = QueryClient.dehydrate(server, { pending: "promise" });
		state.hold = undefined;
		open();
		expect(await new Response(stream).text()).toContain("Fetch 1");

		const browser = await makeClient();
		render(
			page(
				browser,
				sent,
				<React.Suspense fallback={<p>loading</p>}>
					<Titles query={todos} />
				</React.Suspense>,
			),
		);

		expect(await screen.findByText("Fetch 1")).toBeDefined();
		expect(state.runs).toBe(1);
	});
});
