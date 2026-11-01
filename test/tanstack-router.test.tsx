// @vitest-environment happy-dom
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import * as Hydration from "effect/reactivity/Hydration";
import * as Schema from "effect/Schema";

import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	Outlet,
	redirect,
	RouterProvider,
	Scripts,
} from "@tanstack/react-router";
import { hydrate } from "@tanstack/react-router/ssr/client";
import {
	createRequestHandler,
	defaultStreamHandler,
} from "@tanstack/react-router/ssr/server";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Mutation, Query, QueryClient } from "../src/index.js";
import { useSuspenseQuery } from "../src/react/index.js";
import {
	type ConnectQueryClientOptions,
	connectQueryClient,
} from "../src/react/tanstack-router/index.js";
import { disposeClients, gate, makeClient, use } from "./helpers.js";

afterEach(async () => {
	cleanup();
	Reflect.deleteProperty(window, "$_TSR");
	Reflect.deleteProperty(window, "$R");
	await disposeClients();
});

const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });

class FinalizerFailed extends Data.TaggedError("FinalizerFailed")<{}> {}

interface RouterSetup {
	readonly connect?:
		| Omit<ConnectQueryClientOptions, "router" | "queryClient">
		| undefined;
	/** The router's own `dehydrate` and `hydrate`. */
	readonly dehydrate?: () => { readonly mine: string };
	readonly hydrate?: (dehydrated: { readonly mine?: string }) => void;
}

/**
 * A small app over counted queries: `todos`, which the index route's
 * loader loads, `later`, which a component starts, and `guarded`, which
 * dies with a redirect to `/login`.
 */
const app = () => {
	const runs = { todos: 0, later: 0 };
	const hold = { later: Effect.void as Effect.Effect<void> };
	const todos = Query.make({
		key: ["todos"],
		staleTime: "1 minute",
		run: Effect.sync(() => {
			runs.todos += 1;
			return [{ id: 1, title: `Todo ${runs.todos}` }];
		}),
		schema: { success: Schema.Array(Todo) },
	});
	const later = Query.make({
		key: ["later"],
		staleTime: "1 minute",
		run: Effect.suspend(() => {
			runs.later += 1;
			return Effect.as(hold.later, `Later ${runs.later}`);
		}),
		schema: { success: Schema.String },
	});
	const guarded = Query.make({
		key: ["guarded"],
		run: Effect.suspend(() => Effect.die(redirect({ to: "/login" }))),
		schema: { success: Schema.String },
	});

	function Later() {
		return <p>{useSuspenseQuery(later).value}</p>;
	}

	const rootRoute = createRootRouteWithContext<{
		readonly queryClient: QueryClient.QueryClient;
	}>()({
		component: () => (
			<>
				<Outlet />
				<Scripts />
			</>
		),
	});
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		loader: ({ context }) =>
			context.queryClient.runPromise(Query.fetch(todos)),
		component: function Index() {
			const { value } = useSuspenseQuery(todos);
			return (
				<main>
					<h1>{value[0]?.title}</h1>
					<React.Suspense fallback={<p>Loading later</p>}>
						<Later />
					</React.Suspense>
				</main>
			);
		},
	});
	const privateRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/private",
		loader: ({ context }) =>
			context.queryClient.runPromise(Query.fetch(guarded)),
	});
	const loginRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/login",
		component: () => <h1>Sign in</h1>,
	});
	const routeTree = rootRoute.addChildren([
		indexRoute,
		privateRoute,
		loginRoute,
	]);
	const makeRouter = (
		queryClient: QueryClient.QueryClient,
		isServer: boolean,
		setup: RouterSetup = {},
	) => {
		const router = createRouter({
			routeTree,
			context: { queryClient },
			isServer,
			defaultPreloadStaleTime: 0,
			...(setup.dehydrate && { dehydrate: setup.dehydrate }),
			...(setup.hydrate && { hydrate: setup.hydrate }),
			...(isServer
				? {}
				: { history: createMemoryHistory({ initialEntries: ["/"] }) }),
		});
		connectQueryClient({ router, queryClient, ...setup.connect });
		return router;
	};
	return { runs, hold, todos, later, guarded, makeRouter };
};

type App = ReturnType<typeof app>;

/** Renders a page on the server, as a request handler does. */
const serve = (
	makeRouter: App["makeRouter"],
	client: QueryClient.QueryClient,
	path = "/",
	setup?: RouterSetup,
) =>
	createRequestHandler({
		request: new Request(`http://localhost${path}`),
		createRouter: () => makeRouter(client, true, setup),
	})(defaultStreamHandler);

/**
 * Runs the page's scripts in order, as the browser does, which hands the
 * router its state. happy-dom doesn't run inline scripts, so each is
 * evaluated globally with itself as `document.currentScript`.
 */
const load = (html: string) => {
	const page = new DOMParser().parseFromString(html, "text/html");
	for (const script of Array.from(page.querySelectorAll("script"))) {
		const current = document.createElement("script");
		document.body.append(current);
		Object.defineProperty(document, "currentScript", {
			configurable: true,
			get: () => current,
		});
		// oxlint-disable-next-line no-eval -- the page's own scripts, run as the browser runs them
		(0, eval)(script.textContent ?? "");
	}
	Reflect.deleteProperty(document, "currentScript");
};

const isDisposed = (client: QueryClient.QueryClient) => {
	try {
		client.registry.get(Query.make({ key: ["probe"], run: Effect.void }));
		return false;
	} catch {
		return true;
	}
};

describe("server rendering", () => {
	it("sends the loader's queries with the page, and streams the ones it starts", async () => {
		const { runs, hold, todos, later, makeRouter } = app();
		const { wait, open } = gate();
		hold.later = wait;
		const server = await makeClient();
		setTimeout(open, 10);
		const html = await (await serve(makeRouter, server)).text();
		expect(html).toContain("Todo 1");
		expect(runs).toEqual({ todos: 1, later: 1 });

		load(html);
		const browser = await makeClient();
		await hydrate(makeRouter(browser, false));

		expect(await browser.runPromise(Query.fetch(todos))).toEqual([
			{ id: 1, title: "Todo 1" },
		]);
		expect(await browser.runPromise(Query.fetch(later))).toBe("Later 1");
		expect(runs).toEqual({ todos: 1, later: 1 });
	});

	it("renders the hydrated router with the server's values, under its own provider", async () => {
		const { runs, makeRouter } = app();
		const html = await (await serve(makeRouter, await makeClient())).text();
		load(html);
		const router = makeRouter(await makeClient(), false);
		await hydrate(router);

		render(<RouterProvider router={router} />);

		expect(await screen.findByText("Todo 1")).toBeDefined();
		expect(await screen.findByText("Later 1")).toBeDefined();
		expect(runs).toEqual({ todos: 1, later: 1 });
	});

	it("disposes the server's client when the request ends", async () => {
		const { makeRouter } = app();
		const server = await makeClient();

		await (await serve(makeRouter, server)).text();

		await vi.waitFor(() => expect(isDisposed(server)).toBe(true));
	});

	it("reports a failure to dispose the client rather than leaving it unhandled", async () => {
		const { makeRouter } = app();
		const server = await makeClient();
		server.registry.mount(
			Atom.readable((get) => {
				get.addFinalizer(() => {
					throw new FinalizerFailed();
				});
				return 1;
			}),
		);
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});

		await (await serve(makeRouter, server)).text();

		await vi.waitFor(() =>
			expect(errors).toHaveBeenCalledWith(
				"Disposing the request's query client failed:",
				new FinalizerFailed(),
			),
		);
	});

	it("follows a redirect a loader's query dies with, and disposes the client", async () => {
		const { makeRouter } = app();
		const server = await makeClient();

		const response = await serve(makeRouter, server, "/private");

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("/login");
		await vi.waitFor(() => expect(isDisposed(server)).toBe(true));
	});

	it("sends only the queries `dehydrate` matches", async () => {
		const { runs, todos, makeRouter } = app();
		const html = await (
			await serve(makeRouter, await makeClient(), "/", {
				connect: { dehydrate: { queries: ["later"] } },
			})
		).text();
		load(html);
		const browser = await makeClient();
		await hydrate(makeRouter(browser, false));

		expect(await browser.runPromise(Query.fetch(todos))).toEqual([
			{ id: 1, title: "Todo 2" },
		]);
		expect(runs.todos).toBe(2);
	});

	it("keeps the router's own dehydrate and hydrate", async () => {
		const { makeRouter } = app();
		const seen: Array<string | undefined> = [];
		const html = await (
			await serve(makeRouter, await makeClient(), "/", {
				dehydrate: () => ({ mine: "from the server" }),
			})
		).text();
		load(html);

		await hydrate(
			makeRouter(await makeClient(), false, {
				hydrate: (dehydrated) => {
					seen.push(dehydrated.mine);
				},
			}),
		);

		expect(seen).toEqual(["from the server"]);
	});
});

describe("hydrating", () => {
	it("fetches a query whose streamed result the page ended without", async () => {
		const { runs, hold, later, makeRouter } = app();
		const { wait, open } = gate();
		hold.later = wait;
		const server = await makeClient();
		void server.runPromise(Query.prefetch(later));
		const initial = Hydration.toValues(
			QueryClient.dehydrate(server, { pending: "promise" }),
		).map((entry) => ({ ...entry, resultPromise: new Promise(() => {}) }));
		const browser = await makeClient();
		const router = makeRouter(browser, false);
		hold.later = Effect.void;

		// What the server's router sends, as Router SSR hands it to `hydrate`.
		const hydrate = router.options.hydrate as (
			dehydrated: unknown,
		) => unknown;
		await hydrate({
			query: {
				initial,
				stream: new ReadableStream({ start: (c) => c.close() }),
			},
		});

		expect(await browser.runPromise(Query.fetch(later))).toBe("Later 2");
		expect(runs.later).toBe(2);
		open();
	});
});

describe("in the browser", () => {
	const start = async (connect?: RouterSetup["connect"]) => {
		const parts = app();
		const client = await makeClient();
		const router = parts.makeRouter(client, false, { connect });
		await router.load();
		return { ...parts, client, router };
	};

	it("navigates to a redirect a query a component reads dies with", async () => {
		const { client, router, guarded } = await start();

		use(client.registry, guarded);

		await vi.waitFor(() =>
			expect(router.state.location.pathname).toBe("/login"),
		);
	});

	it("leaves a loader's redirect to the router, so Back returns to the page before", async () => {
		const { router } = await start();

		await act(() => router.navigate({ to: "/private" }));
		await vi.waitFor(() =>
			expect(router.state.location.pathname).toBe("/login"),
		);
		// The router follows history only once it's rendered: the entry is enough.
		router.history.back();

		expect(router.history.location.pathname).toBe("/");
	});

	it("stays on the page when a route that redirects is preloaded", async () => {
		const { router } = await start();

		await router.preloadRoute({ to: "/private" });
		await act(async () => {});

		expect(router.state.location.pathname).toBe("/");
	});

	it("navigates to a redirect a mutation dies with", async () => {
		const { client, router } = await start();
		const signOut = Mutation.make({
			run: () => Effect.die(redirect({ to: "/login" })),
		});

		await client.runPromiseExit(Mutation.run(signOut, undefined));

		await vi.waitFor(() =>
			expect(router.state.location.pathname).toBe("/login"),
		);
	});

	it("leaves redirects alone with `handleRedirects: false`", async () => {
		const { client, router, guarded } = await start({
			handleRedirects: false,
		});

		use(client.registry, guarded);
		await act(async () => {});

		expect(router.state.location.pathname).toBe("/");
	});

	it("fetches once when a route is preloaded twice", async () => {
		const { runs, router } = await start();

		await router.preloadRoute({ to: "/" });
		await router.preloadRoute({ to: "/" });

		expect(runs.todos).toBe(1);
	});
});
