import type { QueryClient } from "@monarcode/effetch-query";
import {
	HydrationBoundary,
	QueryProvider,
} from "@monarcode/effetch-query/react";

import { App } from "./app.js";

/** What the server embeds for the browser: the viewer and the cache. */
export interface PageData {
	readonly viewer: string;
	readonly state: QueryClient.DehydratedState;
}

/** The whole tree, the same on the server and in the browser. */
export function Page({
	client,
	data,
}: {
	readonly client: QueryClient.QueryClient;
	readonly data: PageData;
}) {
	return (
		<QueryProvider client={client}>
			<HydrationBoundary state={data.state}>
				<App />
			</HydrationBoundary>
		</QueryProvider>
	);
}
