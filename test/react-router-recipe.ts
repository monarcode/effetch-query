// The React Router page's recipe (`query-context.ts`), with the suite's
// services: `react-router.test.tsx` runs it, and checks it still matches.
import * as ManagedRuntime from "effect/ManagedRuntime";

import { QueryClient } from "@monarcode/effetch-query";
import {
	createContext,
	data,
	type MiddlewareFunction,
	type RouterContextProvider,
} from "react-router";

import { servicesLayer } from "./services.js";

// Builds your services once per process, for every request's client.
const appRuntime = ManagedRuntime.make(servicesLayer("hello"));

// `null` where the middleware didn't run: React Router runs none for a URL
// no route matches. In the browser, `entry.client.tsx` sets the page's client.
export const queryClientContext = createContext<QueryClient.QueryClient | null>(
	null,
);

/** The request's client in a loader, or the page's in a client loader. */
export const getQueryClient = (
	context: Readonly<RouterContextProvider>,
): QueryClient.QueryClient => {
	const client = context.get(queryClientContext);
	if (client === null) {
		throw data("No query client: see app/root.tsx and entry.client.tsx", {
			status: 500,
		});
	}
	return client;
};

// React Router resumes middleware once the page's shell is ready, while the
// body still streams, so the client is disposed once the body is sent.
export const queryClientMiddleware: MiddlewareFunction<Response> = async (
	{ context },
	next,
) => {
	const client = QueryClient.make({ runtime: appRuntime });
	context.set(queryClientContext, client);
	return QueryClient.disposeAfter(client, await next());
};
