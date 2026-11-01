import path from "node:path";

import type * as HttpClient from "effect/http/HttpClient";
import type * as Layer from "effect/Layer";

import type { QueryClient } from "@monarcode/effetch-query";
import { type AnyRouter, RouterProvider } from "@tanstack/react-router";
import { hydrate } from "@tanstack/react-router/ssr/client";
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";

import type { FullApp } from "./app-suite.js";
import { serveBuiltApp } from "./built-app.js";
import { makeFakeDummyJson } from "./fake.js";

export interface StartAppOptions {
	/** The example's folder, with its `vite.config.ts`. */
	readonly root: string;
	readonly getRouter: (options: {
		readonly http: Layer.Layer<HttpClient.HttpClient>;
		readonly readToken: () => string | undefined;
	}) => AnyRouter;
	readonly readBrowserToken: () => string | undefined;
}

/**
 * A TanStack Start example for the shared tests: built and served, and its
 * pages hydrated as Start's browser entry does.
 */
export const startApp = (options: StartAppOptions): FullApp => {
	const built = serveBuiltApp({
		build: [
			path.join(options.root, "../../node_modules/vite/bin/vite.js"),
			"build",
			options.root,
			"--logLevel",
			"error",
		],
		framework: "tanstack-start",
		entry: path.join(options.root, "dist/server/server.js"),
	});
	const roots: Array<Root> = [];
	const clients: Array<QueryClient.QueryClient> = [];

	afterEach(async () => {
		for (const root of roots.splice(0)) {
			act(() => root.unmount());
		}
		await Promise.all(clients.splice(0).map((client) => client.dispose()));
		Reflect.deleteProperty(window, "$_TSR");
		Reflect.deleteProperty(window, "$R");
	});

	return {
		get: built.get,
		readBrowserToken: options.readBrowserToken,
		open: async (url, cookie) => {
			await built.load(url, cookie);
			const browser = makeFakeDummyJson();
			const router = options.getRouter({
				http: browser.layer,
				readToken: options.readBrowserToken,
			});
			clients.push(router.options.context.queryClient);
			await hydrate(router);
			await act(async () => {
				roots.push(
					hydrateRoot(document, <RouterProvider router={router} />),
				);
			});
			return browser;
		},
	};
};
