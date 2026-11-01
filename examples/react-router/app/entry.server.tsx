import { QueryProvider } from "@monarcode/effetch-query/react";
import { renderToReadableStream } from "react-dom/server";
import {
	type EntryContext,
	type RouterContextProvider,
	ServerRouter,
} from "react-router";

import { queryClientContext } from "./query-context.js";

// A query still loading after this long is fetched in the browser instead.
export const streamTimeout = 5_000;

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
	loadContext: RouterContextProvider,
) {
	let status = responseStatusCode;
	let shellRendered = false;
	const client = loadContext.get(queryClientContext);
	const router = <ServerRouter context={routerContext} url={request.url} />;
	const body = await renderToReadableStream(
		client === null ? (
			router
		) : (
			<QueryProvider client={client}>{router}</QueryProvider>
		),
		{
			signal: AbortSignal.timeout(streamTimeout + 1_000),
			onError(error) {
				status = 500;
				// Errors in the shell reject `renderToReadableStream`; the rest
				// are only logged, and the browser renders their boundary.
				if (shellRendered) {
					console.error(error);
				}
			},
		},
	);
	shellRendered = true;
	responseHeaders.set("Content-Type", "text/html");
	return new Response(body, { headers: responseHeaders, status });
}
