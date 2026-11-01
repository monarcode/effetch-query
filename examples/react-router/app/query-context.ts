import * as Effect from "effect/Effect";

import { QueryClient } from "@monarcode/effetch-query";
import {
	createContext,
	data,
	type MiddlewareFunction,
	type RouterContextProvider,
} from "react-router";

import { makeQueryClient } from "./query-client.js";
import { readToken } from "./session.js";

// `null` where the middleware didn't run: React Router runs none for a URL
// no route matches. In the browser, `BrowserApp` sets the page's client.
export const queryClientContext = createContext<QueryClient.QueryClient | null>(
	null,
);

/** The request's client in a loader, or the page's in a client loader. */
export const getQueryClient = (
	context: Readonly<RouterContextProvider>,
): QueryClient.QueryClient => {
	const client = context.get(queryClientContext);
	if (client === null) {
		throw data(
			"No query client: app/root.tsx's middleware sets one on the server, BrowserApp in the browser",
			{
				status: 500,
			},
		);
	}
	return client;
};

// Each request gets its own client, with its own token. React Router resumes
// middleware once the page's shell is ready, while the body still streams,
// so the client is disposed once the body is sent.
export const queryClientMiddleware: MiddlewareFunction<Response> = async (
	{ request, context },
	next,
) => {
	const client = makeQueryClient(
		Effect.succeed(readToken(request.headers.get("Cookie"))),
	);
	context.set(queryClientContext, client);
	return QueryClient.disposeAfter(client, await next());
};
