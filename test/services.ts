import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";

// The test suite is one TypeScript program, so this augmentation applies to
// every test: queries and clients in the tests run with `Greeting` and
// `TestApi`.
declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: Greeting | TestApi;
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
	Fetch.Client<[typeof guard], typeof ApiError>
>()("test/TestApi") {}

/** One request the test API received. */
export interface ApiRequest {
	readonly method: string;
	readonly url: URL;
	readonly body: unknown;
}

/** How the test API answers: a `Response`, or `undefined` for a 404. */
export type ApiHandler = (request: ApiRequest) => Response | undefined;

const bodyOf = (body: { readonly _tag: string; readonly body?: unknown }) =>
	body._tag === "Uint8Array" && body.body instanceof Uint8Array
		? JSON.parse(new TextDecoder().decode(body.body))
		: undefined;

/** A `TestApi` over an in-memory `HttpClient` that answers with `handler`. */
export const testApiLayer = (
	handler: ApiHandler = () => undefined,
): Layer.Layer<TestApi> =>
	Layer.effect(TestApi)(
		Fetch.make({
			baseUrl: "https://api.test",
			defaultError: ApiError,
			plugins: [guard],
		}),
	).pipe(
		Layer.provide(
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
							}) ??
								Response.json(
									{ message: "not found" },
									{ status: 404 },
								),
						),
					),
				),
			),
		),
	);

/** Every registered service: `Greeting` with `text`, and a `TestApi` that answers 404. */
export const servicesLayer = (
	text = "hello",
	handler: ApiHandler = () => undefined,
): Layer.Layer<Greeting | TestApi> =>
	Layer.merge(greetingLayer(text), testApiLayer(handler));
