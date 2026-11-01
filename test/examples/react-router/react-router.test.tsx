// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import * as Effect from "effect/Effect";

import type { QueryClient } from "@monarcode/effetch-query";
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { readBrowserToken } from "../../../examples/react-router/app/session.js";
import { fullAppSuite } from "../harness/app-suite.js";
import { serveBuiltApp } from "../harness/built-app.js";
import { makeFakeDummyJson, tokenOf } from "../harness/fake.js";

const root = path.join(import.meta.dirname, "../../../examples/react-router");

/** The route modules, by route id, as the built page would import them. */
const routeModules = {
	root: () => import("../../../examples/react-router/app/root.js"),
	"routes/login": () =>
		import("../../../examples/react-router/app/routes/login.js"),
	"routes/signed-in": () =>
		import("../../../examples/react-router/app/routes/signed-in.js"),
	"routes/my-todos": () =>
		import("../../../examples/react-router/app/routes/my-todos.js"),
	"routes/all-todos": () =>
		import("../../../examples/react-router/app/routes/all-todos.js"),
	"routes/todo": () =>
		import("../../../examples/react-router/app/routes/todo.js"),
};

const built = serveBuiltApp({
	build: [
		path.join(root, "../../node_modules/@react-router/dev/bin.cjs"),
		"build",
		root,
	],
	framework: "react-router",
	entry: path.join(root, "build/server/index.js"),
});

const roots: Array<Root> = [];
const clients: Array<QueryClient.QueryClient> = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	await Promise.all(clients.splice(0).map((client) => client.dispose()));
	for (const name of [
		"__reactRouterContext",
		"__reactRouterManifest",
		"__reactRouterRouteModules",
	]) {
		Reflect.deleteProperty(window, name);
	}
});

fullAppSuite({
	get: built.get,
	readBrowserToken,
	// Hydrates the page as app/entry.client.tsx does, with the routes from
	// source in place of the page's own imports.
	open: async (url, cookie) => {
		await built.load(url, cookie);
		const assets = path.join(root, "build/client/assets");
		const manifest = readdirSync(assets).find((name) =>
			name.startsWith("manifest-"),
		);
		// oxlint-disable-next-line no-eval -- the page's own manifest, run as the browser runs it
		(0, eval)(readFileSync(path.join(assets, String(manifest)), "utf8"));
		// `react-router/dom` keeps the page it hydrated; this one gets its own.
		vi.resetModules();
		Reflect.set(
			window,
			"__reactRouterRouteModules",
			Object.fromEntries(
				await Promise.all(
					Object.entries(routeModules).map(async ([id, load]) => [
						id,
						await load(),
					]),
				),
			),
		);
		const { BrowserApp } =
			await import("../../../examples/react-router/app/browser.js");
		const { makeQueryClient } =
			await import("../../../examples/react-router/app/query-client.js");
		const browser = makeFakeDummyJson();
		const client = makeQueryClient(
			Effect.sync(readBrowserToken),
			browser.layer,
		);
		clients.push(client);
		await act(async () => {
			roots.push(hydrateRoot(document, <BrowserApp client={client} />));
		});
		return browser;
	},
});

it("sends a page's state when navigating, as `.data`", async () => {
	const { status, html } = await built.get(
		"/todos/3.data",
		`session=${tokenOf("emilys")}`,
	);

	expect(status).toBe(200);
	expect(html).toContain("Read a chapter of a book");
});
