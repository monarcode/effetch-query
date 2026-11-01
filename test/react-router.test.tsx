import { readFileSync } from "node:fs";
import path from "node:path";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { renderToReadableStream } from "react-dom/server";
import {
	createRequestHandler,
	type EntryContext,
	type LoaderFunctionArgs,
	Outlet,
	redirect,
	type RouterContextProvider,
	Scripts,
	type ServerBuild,
	ServerRouter,
	useLoaderData,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Query, QueryClient } from "../src/index.js";
import {
	HydrationBoundary,
	QueryProvider,
	useSuspenseQuery,
} from "../src/react/index.js";
import { gate } from "./helpers.js";
import {
	getQueryClient,
	queryClientContext,
	queryClientMiddleware,
} from "./react-router-recipe.js";

/** The clients the loaders were given, one per request. */
const clients: Array<QueryClient.QueryClient> = [];

afterEach(async () => {
	await Promise.all(clients.splice(0).map((client) => client.dispose()));
});

const isDisposed = (client: QueryClient.QueryClient) => {
	try {
		client.registry.get(Query.make({ key: ["probe"], run: Effect.void }));
		return false;
	} catch {
		return true;
	}
};

const requestClient = (context: Readonly<RouterContextProvider>) => {
	const client = getQueryClient(context);
	clients.push(client);
	return client;
};

const todos = Query.make({
	key: ["todos"],
	run: Effect.succeed(["Write the recipe", "Test it"]),
	schema: { success: Schema.Array(Schema.String) },
	staleTime: "1 minute",
});

/** What the streamed query waits for, a new one per test. */
let slow = gate();
beforeEach(() => {
	slow = gate();
});
const comments = Query.make({
	key: ["comments"],
	run: Effect.as(
		Effect.suspend(() => slow.wait),
		["Streamed"],
	),
	schema: { success: Schema.Array(Schema.String) },
});

const viewer = Query.make({
	key: ["viewer"],
	run: Effect.suspend(() => Effect.die(redirect("/login"))),
	schema: { success: Schema.String },
});

function Root() {
	return (
		<html lang="en">
			<body>
				<Outlet />
				<Scripts />
			</body>
		</html>
	);
}

function TodoList() {
	const { value } = useSuspenseQuery(todos);
	return (
		<ul>
			{value.map((todo) => (
				<li key={todo}>{todo}</li>
			))}
		</ul>
	);
}

async function todosLoader({ context }: LoaderFunctionArgs) {
	const client = requestClient(context);
	await client.runPromise(Query.prefetch(todos));
	void client.runPromiseExit(Query.prefetch(comments));
	return { state: QueryClient.dehydrate(client, { pending: "promise" }) };
}

function TodosRoute() {
	const { state } = useLoaderData<typeof todosLoader>();
	return (
		<HydrationBoundary state={state}>
			<TodoList />
		</HydrationBoundary>
	);
}

async function accountLoader({ context }: LoaderFunctionArgs) {
	return requestClient(context).runPromise(Query.fetch(viewer));
}

/** The README's `entry.server.tsx` change, around a web-streams render. */
const handleRequest = async (
	request: Request,
	status: number,
	headers: Headers,
	routerContext: EntryContext,
	loadContext: RouterContextProvider,
) => {
	const client = loadContext.get(queryClientContext);
	const router = <ServerRouter context={routerContext} url={request.url} />;
	const body = await renderToReadableStream(
		client === null ? (
			router
		) : (
			<QueryProvider client={client}>{router}</QueryProvider>
		),
	);
	headers.set("Content-Type", "text/html");
	return new Response(body, { status, headers });
};

const entryRoute = (
	id: string,
	options: { readonly parentId?: string; readonly path: string },
	hasLoader: boolean,
) => ({
	id,
	...options,
	module: `/${id}.js`,
	hasLoader,
	hasAction: false,
	hasClientAction: false,
	hasClientLoader: false,
	hasClientMiddleware: false,
	hasErrorBoundary: false,
	clientActionModule: undefined,
	clientLoaderModule: undefined,
	clientMiddlewareModule: undefined,
	hydrateFallbackModule: undefined,
});

/** What the Vite plugin builds for an app with these route modules. */
const build: ServerBuild = {
	entry: { module: { default: handleRequest } },
	routes: {
		root: {
			id: "root",
			path: "",
			module: { default: Root, middleware: [queryClientMiddleware] },
		},
		todos: {
			id: "todos",
			parentId: "root",
			path: "todos",
			module: { default: TodosRoute, loader: todosLoader },
		},
		account: {
			id: "account",
			parentId: "root",
			path: "account",
			module: { default: () => null, loader: accountLoader },
		},
	},
	assets: {
		entry: { imports: [], module: "/entry.client.js" },
		routes: {
			root: entryRoute("root", { path: "" }, false),
			todos: entryRoute("todos", { parentId: "root", path: "todos" }, true),
			account: entryRoute(
				"account",
				{ parentId: "root", path: "account" },
				true,
			),
		},
		url: "/manifest.js",
		version: "test",
	},
	publicPath: "/",
	assetsBuildDirectory: "build/client",
	future: {},
	ssr: true,
	isSpaMode: false,
	prerender: [],
	routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
};

const handler = createRequestHandler(build, "production");

const get = (url: string) => handler(new Request(`http://localhost${url}`));

describe("the README's React Router recipe", () => {
	it("renders a loader's queries with the request's client, and disposes it once the body is sent", async () => {
		const response = await get("/todos");
		const [client] = clients;

		expect(response.status).toBe(200);
		expect(client).toBeDefined();
		expect(isDisposed(client as QueryClient.QueryClient)).toBe(false);

		slow.open();
		const html = await response.text();

		expect(html).toContain("<li>Write the recipe</li>");
		expect(html).toContain('effetch-query:[\\\\\\"todos\\\\\\"]');
		expect(html).toContain("Streamed");
		await expect
			.poll(() => isDisposed(client as QueryClient.QueryClient))
			.toBe(true);
	});

	it("sends a navigation's state in its .data response, and disposes the client once it's sent", async () => {
		const response = await get("/todos.data");
		const [client] = clients;
		expect(isDisposed(client as QueryClient.QueryClient)).toBe(false);

		slow.open();
		const payload = await response.text();

		expect(payload).toContain('effetch-query:[\\"todos\\"]');
		expect(payload).toContain('effetch-query:[\\"comments\\"]');
		await expect
			.poll(() => isDisposed(client as QueryClient.QueryClient))
			.toBe(true);
	});

	it("disposes the client when the response is cancelled", async () => {
		const response = await get("/todos");

		await response.body?.cancel();

		await expect
			.poll(() => isDisposed(clients[0] as QueryClient.QueryClient))
			.toBe(true);
	});

	it("follows a redirect a loader's query dies with", async () => {
		const response = await get("/account");

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/login");
		await expect
			.poll(() => isDisposed(clients[0] as QueryClient.QueryClient))
			.toBe(true);
	});

	it("renders a URL no route matches, where no middleware runs", async () => {
		const response = await get("/nowhere");

		expect(response.status).toBe(404);
		expect(clients).toHaveLength(0);
	});

	it("is the README's code", () => {
		const readme = readFileSync(
			path.join(import.meta.dirname, "../README.md"),
			"utf8",
		);
		const block = /```ts query-context\.ts\n([\s\S]*?)```/.exec(readme)?.[1];
		const recipe = readFileSync(
			path.join(import.meta.dirname, "react-router-recipe.ts"),
			"utf8",
		);
		const normalize = (code: string) =>
			code
				.slice(code.indexOf("import"))
				.replace('import { ApiClientLive } from "./api.js";', "")
				.replace('import { servicesLayer } from "./services.js";', "")
				.replace("ApiClientLive", 'servicesLayer("hello")')
				.replace(/\s+/g, " ")
				.trim();

		expect(block).toBeDefined();
		expect(normalize(recipe)).toBe(normalize(block ?? ""));
	});
});
