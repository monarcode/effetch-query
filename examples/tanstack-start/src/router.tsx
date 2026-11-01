import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";

import { QueryClient } from "@monarcode/effetch-query";
import { connectQueryClient } from "@monarcode/effetch-query/react/tanstack-router";
import { createRouter } from "@tanstack/react-router";

import { DummyJsonLive, Session } from "./dummyjson.js";
import { PageError } from "./page-error.js";
import { routeTree } from "./routeTree.gen.js";
import { readSessionToken } from "./session.js";

/** What tests change: the `HttpClient`, and where the token is read. */
export interface RouterOptions {
	readonly http?: Layer.Layer<HttpClient.HttpClient> | undefined;
	readonly readToken?: (() => string | undefined) | undefined;
}

/**
 * Start calls this once per request on the server, and once in the browser,
 * so each request gets its own query client, with that request's token.
 * Nothing here is costly to build; an app with a database pool would share
 * it through a `ManagedRuntime` (the README's "Sharing your runtime").
 */
export function getRouter({
	http = FetchHttpClient.layer,
	readToken = readSessionToken,
}: RouterOptions = {}) {
	// The browser reads its cookie for every request, so signing in or out
	// takes effect at once. The server reads this request's, once.
	const token =
		typeof document === "undefined"
			? Effect.succeed(readToken())
			: Effect.sync(readToken);
	const queryClient = QueryClient.make({
		layer: DummyJsonLive.pipe(
			Layer.provide(Layer.merge(Layer.succeed(Session, { token }), http)),
		),
		queries: { defaults: { staleTime: "1 minute" } },
	});
	const router = createRouter({
		routeTree,
		context: { queryClient, readToken },
		// Loaders always run, and the queries' staleTime decides what's fetched.
		defaultPreloadStaleTime: 0,
		defaultErrorComponent: PageError,
	});
	connectQueryClient({ router, queryClient });
	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
