import type { QueryClient } from "@monarcode/effetch-query";
import { QueryProvider } from "@monarcode/effetch-query/react";
import { RouterContextProvider } from "react-router";
import { HydratedRouter } from "react-router/dom";

import { queryClientContext } from "./query-context.js";

/**
 * The app in the browser, with the page's client: components read it from
 * the `QueryProvider`, and client loaders from the router's context.
 */
export function BrowserApp({
	client,
}: {
	readonly client: QueryClient.QueryClient;
}) {
	return (
		<QueryProvider client={client}>
			<HydratedRouter
				getContext={() =>
					new RouterContextProvider(
						new Map([[queryClientContext, client]]),
					)
				}
			/>
		</QueryProvider>
	);
}
