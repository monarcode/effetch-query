import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
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

/** A 401: no session, or one that has expired. */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
	"Unauthorized",
	{ message: Schema.String },
) {}

/** A 404 for a todo, with dummyjson's message saying which. */
export class TodoNotFound extends Schema.TaggedError<TodoNotFound>()(
	"TodoNotFound",
	{ message: Schema.String },
) {}

/** The signed-in user's access token, read for every request. */
export class Session extends Context.Service<
	Session,
	{ readonly token: Effect.Effect<string | undefined> }
>()("Session") {}

/**
 * The Effetch client for dummyjson.com, as a service. Its `layer` needs the
 * `Session` its token comes from, and an `HttpClient`.
 */
export class DummyJson extends Fetch.Service<DummyJson>()("DummyJson", {
	baseUrl: import.meta.env.VITE_DUMMYJSON_URL ?? "https://dummyjson.com",
	defaultError: ApiError,
	// Every endpoint fails with an `Unauthorized` on a 401, typed, so code
	// can catch it by its tag.
	statusErrors: { 401: Unauthorized },
	plugins: [bearer({ token: Session.use((session) => session.token) })],
}) {}

declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: DummyJson;
	}
}
