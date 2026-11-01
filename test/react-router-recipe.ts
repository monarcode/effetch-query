// The README's React Router recipe (`query-context.ts`), with the suite's
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
// no route matches.
export const queryClientContext = createContext<QueryClient.QueryClient | null>(
	null,
);

/** The request's client, in a loader or action. */
export const getQueryClient = (
	context: Readonly<RouterContextProvider>,
): QueryClient.QueryClient => {
	const client = context.get(queryClientContext);
	if (client === null) {
		throw data("app/root.tsx doesn't export queryClientMiddleware", {
			status: 500,
		});
	}
	return client;
};

// React Router resumes middleware once the page's shell is ready, while the
// body still streams, so the client is disposed when the body ends.
export const queryClientMiddleware: MiddlewareFunction<Response> = async (
	{ context },
	next,
) => {
	const client = QueryClient.make({ runtime: appRuntime });
	context.set(queryClientContext, client);
	const response = await next();
	const release = () => {
		client.dispose().catch(console.error);
	};
	const reader = response.body?.getReader();
	if (reader === undefined) {
		release();
		return response;
	}
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					controller.close();
					release();
				} else {
					controller.enqueue(value);
				}
			} catch (error) {
				controller.error(error);
				release();
			}
		},
		cancel(reason) {
			release();
			return reader.cancel(reason);
		},
	});
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
};
