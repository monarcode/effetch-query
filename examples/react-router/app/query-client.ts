import type * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";

import { QueryClient } from "@monarcode/effetch-query";

import { DummyJsonLive, Session } from "./dummyjson.js";

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
		layer: DummyJsonLive.pipe(
			Layer.provide(Layer.merge(Layer.succeed(Session, { token }), http)),
		),
		queries: { defaults: { staleTime: "1 minute" } },
	});
