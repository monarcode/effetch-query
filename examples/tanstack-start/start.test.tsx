import { execFileSync } from "node:child_process";
import path from "node:path";

// @vitest-environment happy-dom
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";

import { RouterProvider } from "@tanstack/react-router";
import { hydrate } from "@tanstack/react-router/ssr/client";
import { act, cleanup, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

import { getRouter } from "./src/router.js";
import { Session, TodoApi, type Todo, TodoNotFound } from "./src/services.js";

interface Page {
	readonly status: number;
	readonly location: string | null;
	readonly html: string;
}

/** The built app's response to each page the tests visit. */
const pages = new Map<string, Page>();

beforeAll(() => {
	const root = import.meta.dirname;
	execFileSync(
		process.execPath,
		[
			path.join(root, "../../node_modules/vite/bin/vite.js"),
			"build",
			root,
			"--logLevel",
			"error",
		],
		{ stdio: "inherit" },
	);
	const rendered: ReadonlyArray<Page & { readonly url: string }> = JSON.parse(
		execFileSync(
			process.execPath,
			[
				path.join(root, "render.mjs"),
				"/",
				"/todos/2",
				"/todos/9",
				"/account",
			],
			// A missing todo fails while rendering, which React logs.
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		),
	);
	for (const page of rendered) {
		pages.set(page.url, page);
	}
	// The page's bundle and assets aren't loaded, as if they had been.
	Reflect.get(window, "happyDOM").settings.handleDisabledFileLoadingAsSuccess =
		true;
}, 60_000);

const get = (url: string): Page => {
	const page = pages.get(url);
	expect(page).toBeDefined();
	return page as Page;
};

const roots: Array<Root> = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	cleanup();
	Reflect.deleteProperty(window, "$_TSR");
	Reflect.deleteProperty(window, "$R");
	vi.restoreAllMocks();
});

/** The browser's services: the server's todos, with every read counted. */
const browserApi = () => {
	const reads = { count: 0 };
	const todos: ReadonlyArray<Todo> = [
		{ id: 1, title: "Write the integration", done: true },
		{ id: 2, title: "Ship the alpha", done: false },
	];
	const read = <A,>(value: A) =>
		Effect.sync(() => {
			reads.count += 1;
			return value;
		});
	const layer = Layer.merge(
		Layer.succeed(TodoApi, {
			list: read(todos),
			find: (id) =>
				read(todos.find((todo) => todo.id === id)).pipe(
					Effect.filterOrFail(
						Predicate.isNotUndefined,
						() => new TodoNotFound({ id }),
					),
				),
		}),
		Layer.succeed(Session, { viewer: read(null) }),
	);
	return { reads, layer };
};

/**
 * Loads the server's page and runs its inline scripts in order, as a browser
 * does, which hands the router its state. happy-dom runs no scripts itself,
 * so each is taken out of the page, as it takes itself out in a browser,
 * and evaluated globally with itself as `document.currentScript`.
 */
const load = async (url: string) => {
	Reflect.get(window, "happyDOM").setURL(`http://localhost${url}`);
	const html = get(url).html;
	const page = new DOMParser().parseFromString(html, "text/html");
	const inline = Array.from(page.querySelectorAll("script:not([src])"));
	for (const script of inline) {
		script.remove();
	}
	for (const { name, value } of Array.from(page.documentElement.attributes)) {
		document.documentElement.setAttribute(name, value);
	}
	document.documentElement.innerHTML = page.documentElement.innerHTML;
	for (const script of inline) {
		const current = document.createElement("script");
		document.body.append(current);
		Object.defineProperty(document, "currentScript", {
			configurable: true,
			get: () => current,
		});
		// oxlint-disable-next-line no-eval -- the page's own scripts, run as the browser runs them
		(0, eval)(script.textContent);
	}
	Reflect.deleteProperty(document, "currentScript");
	// React reveals streamed content on a later frame, as the browser would.
	await vi.waitFor(() =>
		expect(document.querySelector("[id^='S:']")).toBeNull(),
	);
};

/** Queries the page's body, which loading a page replaces. */
const body = () => within(document.body);

/** Hydrates the page as Start's browser entry does, with the app's own router. */
const hydratePage = async (api: Layer.Layer<TodoApi | Session>) => {
	const router = getRouter(api);
	await hydrate(router);
	await act(async () => {
		roots.push(hydrateRoot(document, <RouterProvider router={router} />));
	});
	return router;
};

it("renders the todos on the server, and hydrates them without a fetch", async () => {
	const { status, html } = get("/");
	expect(status).toBe(200);
	expect(html).toContain("Write the integration");
	expect(html).toContain("Ship the alpha");

	const errors = vi.spyOn(console, "error");
	const api = browserApi();
	await load("/");
	await hydratePage(api.layer);

	expect(
		body()
			.getAllByRole("link")
			.map((link) => link.textContent),
	).toEqual(["Write the integration", "Ship the alpha"]);
	expect(errors).not.toHaveBeenCalled();
	expect(api.reads.count).toBe(0);
});

it("streams a todo the loader started without waiting for it", async () => {
	const { html } = get("/todos/2");
	expect(html).toContain("Ship the alpha");
	expect(html).toContain("resultPromise");

	const errors = vi.spyOn(console, "error");
	const api = browserApi();
	await load("/todos/2");
	await hydratePage(api.layer);

	expect(
		await body().findByRole("heading", { name: "Ship the alpha" }),
	).toBeDefined();
	expect(errors).not.toHaveBeenCalled();
	expect(api.reads.count).toBe(0);
});

it("fetches in the browser on navigation, once per query", async () => {
	const api = browserApi();
	await load("/");
	const router = await hydratePage(api.layer);

	await act(() => router.navigate({ to: "/todos/$id", params: { id: "1" } }));

	expect(
		await body().findByRole("heading", {
			name: "Write the integration (done)",
		}),
	).toBeDefined();
	expect(api.reads.count).toBe(1);
});

it("redirects a signed-out viewer to sign in, on the server", async () => {
	const { status, location } = get("/account");

	expect(status).toBe(307);
	expect(location).toBe("/login");
});

it("shows a missing todo's error in the browser, which fetches it again", async () => {
	const api = browserApi();
	await load("/todos/9");
	await hydratePage(api.layer);

	expect(
		await body().findByRole("heading", { name: "No such todo" }),
	).toBeDefined();
	expect(api.reads.count).toBe(1);
});
