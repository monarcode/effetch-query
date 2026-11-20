import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { Fetch } from "@monarcode/effetch";

// The test suite is one TypeScript program, so this augmentation applies to
// every test: queries and clients in the tests run with `Greeting`,
// `TestApi` and `ServiceApi`.
declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: Greeting | TestApi | ServiceApi;
	}
}

export class Greeting extends Context.Service<
	Greeting,
	{ readonly text: string }
>()("test/Greeting") {}

export const greetingLayer = (text: string): Layer.Layer<Greeting> =>
	Layer.succeed(Greeting, { text });

/** The error body the test API sends. */
export const ApiError = Schema.Struct({ message: Schema.String });

/** What every `TestApi` call fails with on a 401: the client's `statusErrors`. */
export class SessionExpired extends Schema.TaggedError<SessionExpired>()(
	"SessionExpired",
	{ message: Schema.String },
) {}

/** The client's `statusErrors`. */
export const clientStatusErrors = { 401: SessionExpired };

/** What the `guard` plugin fails with when a request has `x-deny`. */
export class Denied extends Data.TaggedError("Denied")<{}> {}

/** A plugin with an error of its own, for the error types. */
export const guard = Fetch.plugin({
	name: "guard",
	onRequest: (request) =>
		request.headers["x-deny"] === undefined
			? Effect.succeed(request)
			: Effect.fail(new Denied()),
});

/** The effetch client the effetch adapter's tests call through. */
export class TestApi extends Context.Service<
	TestApi,
	Fetch.Client<[typeof guard], typeof ApiError, typeof clientStatusErrors>
>()("test/TestApi") {}

/**
 * The test API as a `Fetch.Service` class, which the effetch adapter reads
 * its `defaultError` and `statusErrors` from. Its layer needs an
 * `HttpClient`, such as `FetchTest.layer`.
 */
export class ServiceApi extends Fetch.Service<ServiceApi>()("test/ServiceApi", {
	baseUrl: "https://api.test",
	defaultError: ApiError,
	statusErrors: clientStatusErrors,
}) {}

/** One request the test API received. */
export interface ApiRequest {
	readonly method: string;
	readonly url: URL;
	readonly body: unknown;
	readonly headers: Headers.Headers;
}

/** How the test API answers: a `Response`, or `undefined` for a 404. */
export type ApiHandler = (request: ApiRequest) => Response | undefined;

// A multipart body stays a `FormData`, so tests can read its parts and files.
const bodyOf = (body: {
	readonly _tag: string;
	readonly body?: unknown;
	readonly formData?: unknown;
}) =>
	body._tag === "Uint8Array" && body.body instanceof Uint8Array
		? JSON.parse(new TextDecoder().decode(body.body))
		: body._tag === "FormData"
			? body.formData
			: undefined;

/** An in-memory `HttpClient` that answers with `handler`. */
export const httpLayer = (
	handler: ApiHandler = () => undefined,
): Layer.Layer<HttpClient.HttpClient> =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) =>
			Effect.sync(() =>
				HttpClientResponse.fromWeb(
					request,
					handler({
						method: request.method,
						url,
						body: bodyOf(request.body),
						headers: request.headers,
					}) ?? Response.json({ message: "not found" }, { status: 404 }),
				),
			),
		),
	);

/** A `TestApi` over an in-memory `HttpClient` that answers with `handler`. */
export const testApiLayer = (
	handler: ApiHandler = () => undefined,
): Layer.Layer<TestApi> =>
	Layer.effect(TestApi)(
		Fetch.make({
			baseUrl: "https://api.test",
			defaultError: ApiError,
			statusErrors: clientStatusErrors,
			plugins: [guard],
		}),
	).pipe(Layer.provide(httpLayer(handler)));

/** `ServiceApi` over an in-memory `HttpClient` that answers with `handler`. */
export const serviceApiLayer = (
	handler: ApiHandler = () => undefined,
): Layer.Layer<ServiceApi> =>
	ServiceApi.layer.pipe(Layer.provide(httpLayer(handler)));

/** Both test APIs, `TestApi` and `ServiceApi`, answering with `handler`. */
export const apiLayers = (
	handler: ApiHandler = () => undefined,
): Layer.Layer<TestApi | ServiceApi> =>
	Layer.merge(testApiLayer(handler), serviceApiLayer(handler));

/**
 * Every registered service: `Greeting` with `text`, and a `TestApi` and a
 * `ServiceApi` that answer with `handler`, else 404. Pass `serviceApi` to
 * give `ServiceApi` a layer of its own, such as one over `FetchTest.layer`.
 */
export const servicesLayer = (
	text = "hello",
	handler: ApiHandler = () => undefined,
	serviceApi: Layer.Layer<ServiceApi> = serviceApiLayer(handler),
): Layer.Layer<Greeting | TestApi | ServiceApi> =>
	Layer.mergeAll(greetingLayer(text), testApiLayer(handler), serviceApi);
