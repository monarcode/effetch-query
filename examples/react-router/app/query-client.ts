import type * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { Fetch } from "@monarcode/effetch";
import { QueryClient } from "@monarcode/effetch-query";

import { DummyJson, Session } from "./dummyjson.js";

/**
 * Retries a fetch that didn't reach the server, twice, a little later each
 * time. A response, even an error, is the server's answer: it isn't retried.
 */
const retryNetworkFailures = Schedule.exponential("250 millis").pipe(
	Schedule.while(
		({ input, attempt }) =>
			input instanceof Fetch.NetworkError && attempt <= 2,
	),
);

/**
 * A query client that calls dummyjson.com with `token`: one per request on
 * the server, and one for the page in the browser. Nothing here is costly to
 * build; an app with a database pool would share it through a
 * `ManagedRuntime` (the README's "Sharing your runtime").
 */
export const makeQueryClient = (
	token: Effect.Effect<string | undefined>,
	http: Layer.Layer<HttpClient.HttpClient> = FetchHttpClient.layer,
): QueryClient.QueryClient =>
	QueryClient.make({
		layer: DummyJson.layer.pipe(
			Layer.provide(Layer.merge(Layer.succeed(Session, { token }), http)),
		),
		queries: {
			defaults: { staleTime: "1 minute", retry: retryNetworkFailures },
		},
	});
