import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";

import { QueryClient } from "@monarcode/effetch-query";

import { AppApiLive } from "./api.js";

/**
 * The app's query client, over an `HttpClient`: `FetchHttpClient.layer` in
 * the app, the fake API in tests.
 */
export const makeQueryClient = (
	http: Layer.Layer<HttpClient.HttpClient>,
): QueryClient.QueryClient =>
	QueryClient.make({ layer: AppApiLive.pipe(Layer.provide(http)) });
