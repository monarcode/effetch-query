import * as ManagedRuntime from "effect/ManagedRuntime";

import { QueryClient } from "@monarcode/effetch-query";
import { connectQueryClient } from "@monarcode/effetch-query/react/tanstack-router";
import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen.js";
import { AppLayer } from "./services.js";

// The process's runtime. It builds the app's layer once, for every request's
// client, rather than building it (a database pool, say) per request.
const appRuntime = ManagedRuntime.make(AppLayer);

/**
 * Start calls this once per request on the server, and once in the browser,
 * so each request gets its own query client. Tests pass a runtime of fakes.
 */
export function getRouter(
	runtime: ManagedRuntime.ManagedRuntime<
		QueryClient.Services,
		unknown
	> = appRuntime,
) {
	const queryClient = QueryClient.make({ runtime });
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
