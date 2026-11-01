import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export const Todo = Schema.Struct({
	id: Schema.Finite,
	todo: Schema.String,
	completed: Schema.Boolean,
	userId: Schema.Finite,
});
export type Todo = typeof Todo.Type;

export const TodoPage = Schema.Struct({
	todos: Schema.Array(Todo),
	total: Schema.Finite,
	skip: Schema.Finite,
	limit: Schema.Finite,
});
export type TodoPage = typeof TodoPage.Type;

export const User = Schema.Struct({
	id: Schema.Finite,
	username: Schema.String,
	firstName: Schema.String,
	lastName: Schema.String,
	image: Schema.String,
});
export type User = typeof User.Type;

export const SignedIn = Schema.Struct({
	...User.fields,
	accessToken: Schema.String,
});

/**
 * A failed request: dummyjson's status and message, or status 0 when it
 * couldn't be reached.
 */
export class ApiError extends Data.TaggedError("ApiError")<{
	readonly status: number;
	readonly message: string;
}> {}

export interface Credentials {
	readonly username: string;
	readonly password: string;
}

const ErrorBody = Schema.Struct({ message: Schema.String });

/** Fails with dummyjson's message, or only the status if it sent none. */
const failWith = (response: HttpClientResponse.HttpClientResponse) =>
	Effect.flatMap(response.json, (body) =>
		Effect.fail(
			new ApiError({
				status: response.status,
				message: Schema.is(ErrorBody)(body)
					? body.message
					: `dummyjson answered ${response.status}`,
			}),
		),
	);

/** The signed-in user's access token, read for every request. */
export class Session extends Context.Service<
	Session,
	{ readonly token: Effect.Effect<string | undefined> }
>()("Session") {}

const makeDummyJson = Effect.gen(function* () {
	const session = yield* Session;
	const http = (yield* HttpClient.HttpClient).pipe(
		HttpClient.mapRequest(
			HttpClientRequest.prependUrl(
				import.meta.env.VITE_DUMMYJSON_URL ?? "https://dummyjson.com",
			),
		),
		HttpClient.mapRequestEffect((request) =>
			Effect.map(session.token, (token) =>
				token === undefined
					? request
					: HttpClientRequest.bearerToken(request, token),
			),
		),
	);

	/** Sends a request and decodes its body, or fails with dummyjson's message. */
	const send = <S extends Schema.Codec<unknown, unknown>>(
		request: HttpClientRequest.HttpClientRequest,
		schema: S,
	) =>
		http.execute(request).pipe(
			Effect.filterOrElse((response) => response.status < 400, failWith),
			Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
			Effect.catchTags({
				HttpClientError: (error) =>
					Effect.fail(
						new ApiError({
							status: error.response?.status ?? 0,
							message: error.message,
						}),
					),
				// dummyjson sent something other than it documents.
				SchemaError: Effect.die,
			}),
		);

	return {
		me: send(HttpClientRequest.get("/auth/me"), User),
		login: (credentials: Credentials) =>
			send(
				HttpClientRequest.post("/auth/login").pipe(
					HttpClientRequest.bodyJsonUnsafe({
						...credentials,
						expiresInMins: 60,
					}),
				),
				SignedIn,
			),
		userTodos: (userId: number) =>
			send(HttpClientRequest.get(`/todos/user/${userId}`), TodoPage),
		todos: (params: { readonly limit: number; readonly skip: number }) =>
			send(HttpClientRequest.get("/todos", { urlParams: params }), TodoPage),
		todo: (id: number) => send(HttpClientRequest.get(`/todos/${id}`), Todo),
		updateTodo: (id: number, patch: { readonly completed: boolean }) =>
			send(
				HttpClientRequest.patch(`/todos/${id}`).pipe(
					HttpClientRequest.bodyJsonUnsafe(patch),
				),
				Todo,
			),
		deleteTodo: (id: number) =>
			send(HttpClientRequest.delete(`/todos/${id}`), Todo),
	};
});

/** dummyjson.com's todos and auth, over Effect's `HttpClient`. */
export class DummyJson extends Context.Service<
	DummyJson,
	Effect.Success<typeof makeDummyJson>
>()("DummyJson") {}

declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: DummyJson;
	}
}

/** The client, given the session and an `HttpClient`. */
export const DummyJsonLive = Layer.effect(DummyJson)(makeDummyJson);
