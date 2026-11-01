import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { QueryClient } from "@monarcode/effetch-query";
import { connectQueryClient } from "@monarcode/effetch-query/react/tanstack-router";
import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen.js";
import { AppLayer } from "./services.js";

// The process's runtime. It builds the app's layer once, and every request's
// client shares it through the runtime's memo map, rather than building the
// layer (a database pool, say) per request.
const appRuntime = ManagedRuntime.make(AppLayer);

/**
 * Start calls this once per request on the server, and once in the browser,
 * so each request gets its own query client. Tests pass fakes.
 */
export function getRouter(layer: Layer.Layer<QueryClient.Services> = AppLayer) {
	// Built by the runtime first, so the layer outlives each request's client.
	void appRuntime.runPromiseExit(Effect.void);
	const queryClient = QueryClient.make({
		layer,
		memoMap: appRuntime.memoMap,
	});
	const router = createRouter({
		routeTree,
		context: { queryClient },
		// Loaders always run, and the queries' staleTime decides what's fetched.
		defaultPreloadStaleTime: 0,
	});
	connectQueryClient({ router, queryClient });
	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
