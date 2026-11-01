import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { bearer } from "@monarcode/effetch/plugins";

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

/** What dummyjson sends back when a request fails. */
export const ApiError = Schema.Struct({ message: Schema.String });

/** The signed-in user's access token, read for every request. */
export class Session extends Context.Service<
	Session,
	{ readonly token: Effect.Effect<string | undefined> }
>()("Session") {}

const makeDummyJson = Effect.gen(function* () {
	const session = yield* Session;
	return yield* Fetch.make({
		baseUrl: import.meta.env.VITE_DUMMYJSON_URL ?? "https://dummyjson.com",
		defaultError: ApiError,
		plugins: [bearer({ token: session.token })],
	});
});

/** The effetch client for dummyjson.com, as a service. */
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
