import { type AnyRouter, isRedirect } from "@tanstack/react-router";
import * as React from "react";

import { connect, type SsrRouter } from "../../internal/routerSsr.js";
import type * as Query from "../../Query.js";
import type * as QueryClient from "../../QueryClient.js";
import { QueryProvider } from "../QueryProvider.js";

/**
 * Which queries {@link connectQueryClient} sends from the server, as
 * `QueryClient.DehydrateOptions` chooses them. Queries still loading are
 * always sent, as promises the browser waits for: the router's serializer
 * carries them.
 *
 * @example
 * ```ts
 * import type { ConnectDehydrateOptions } from "@monarcode/effetch-query/react/tanstack-router";
 *
 * export const options: ConnectDehydrateOptions = {
 *   queries: ["todos"],
 *   failures: "include",
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface ConnectDehydrateOptions {
	/** Only the queries this matches, as `Query.invalidate` matches them. Default: every query. */
	readonly queries?: Query.QueryTarget | undefined;
	/**
	 * A failed query: `"include"` sends it with its error, encoded with the
	 * query's `schema.error`; `"omit"` leaves it out, so the browser fetches
	 * it again. Default: `"omit"`.
	 */
	readonly failures?: "omit" | "include" | undefined;
}

/**
 * Options for {@link connectQueryClient}.
 *
 * @example
 * ```ts
 * import { QueryClient } from "@monarcode/effetch-query";
 * import type { ConnectQueryClientOptions } from "@monarcode/effetch-query/react/tanstack-router";
 * import { createRootRoute, createRouter } from "@tanstack/react-router";
 *
 * declare const queryClient: QueryClient.QueryClient;
 *
 * export const options: ConnectQueryClientOptions = {
 *   router: createRouter({ routeTree: createRootRoute() }),
 *   queryClient,
 *   handleRedirects: false,
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface ConnectQueryClientOptions {
	/** The router, made for this request on the server. */
	readonly router: AnyRouter;
	/**
	 * The query client, made with the router. On the server it must be this
	 * request's own: it's disposed when the request ends.
	 */
	readonly queryClient: QueryClient.QueryClient;
	/** Which queries the server sends. */
	readonly dehydrate?: ConnectDehydrateOptions | undefined;
	/**
	 * Whether a query or mutation that fails or dies with a `redirect()`
	 * navigates there, in the browser. Default: `true`.
	 */
	readonly handleRedirects?: boolean | undefined;
	/**
	 * Whether to wrap the router's `Wrap` in a `QueryProvider` for the client.
	 * Default: `true`.
	 */
	readonly wrapQueryClient?: boolean | undefined;
}

/**
 * Connects a query client to a TanStack Router (and so TanStack Start), as
 * TanStack's `setupRouterSsrQueryIntegration` does for TanStack Query. Call
 * it where the router is made: Start's `getRouter`, or your server and
 * browser entries.
 *
 * - **On the server**, the queries your loaders loaded go with the page,
 *   and queries started while rendering follow as they start, those still
 *   loading as promises the browser waits for, so nothing is fetched twice.
 *   The client is disposed when the request ends: make one per request,
 *   sharing a process-wide `ManagedRuntime`'s `memoMap`, so your app's
 *   layer is built once rather than per request (see the example).
 * - **In the browser**, they load into the client before React hydrates,
 *   with no `HydrationBoundary`.
 * - **Redirects:** a query or mutation that fails or dies with a router
 *   `redirect()` navigates there, in the browser. Write it as
 *   `Effect.die(redirect({ to: "/login" }))`, to keep it out of the error
 *   type. In a loader, `runPromise` rejects with the redirect, and the
 *   router follows it.
 *
 * Load data in loaders with `context.queryClient.runPromise(Query.fetch(…))`,
 * which returns a fresh value without fetching, and set the router's
 * `defaultPreloadStaleTime` to `0`, so the queries' `staleTime` decides
 * what's refetched rather than the router's own loader cache. Only queries
 * with a `schema` cross to the browser.
 *
 * @example
 * ```tsx
 * import * as Effect from "effect/Effect";
 * import type * as Layer from "effect/Layer";
 * import * as ManagedRuntime from "effect/ManagedRuntime";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 * import { connectQueryClient } from "@monarcode/effetch-query/react/tanstack-router";
 * import { createRootRouteWithContext, createRouter } from "@tanstack/react-router";
 *
 * // Every service your queries use, merged.
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 *
 * // Builds AppLayer once per process, for every request's client.
 * const appRuntime = ManagedRuntime.make(AppLayer);
 *
 * const rootRoute = createRootRouteWithContext<{
 *   readonly queryClient: QueryClient.QueryClient;
 * }>()();
 *
 * export function getRouter() {
 *   void appRuntime.runPromiseExit(Effect.void);
 *   const queryClient = QueryClient.make({
 *     layer: AppLayer,
 *     memoMap: appRuntime.memoMap,
 *   });
 *   const router = createRouter({
 *     routeTree: rootRoute,
 *     context: { queryClient },
 *     defaultPreloadStaleTime: 0,
 *   });
 *   connectQueryClient({ router, queryClient });
 *   return router;
 * }
 * ```
 *
 * @since 0.1.0
 */
export const connectQueryClient = ({
	router,
	queryClient,
	dehydrate = {},
	handleRedirects = true,
	wrapQueryClient = true,
}: ConnectQueryClientOptions): void => {
	connect({
		router: router as unknown as SsrRouter,
		client: queryClient,
		dehydrate,
		handleRedirects,
		isRedirect,
	});
	if (wrapQueryClient) {
		const Inner = router.options.Wrap;
		router.options.Wrap = function QueryClientWrap({ children }) {
			return React.createElement(
				QueryProvider,
				{ client: queryClient },
				Inner === undefined
					? children
					: React.createElement(Inner, { children }),
			);
		};
	}
};
