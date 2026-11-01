import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { Query } from "@monarcode/effetch-query";
import { redirect } from "@tanstack/react-router";

import { Session, Todo, TodoApi } from "./services.js";

// Each query has a `schema`, so the server can send it to the browser.

export const todos = Query.make({
	key: ["todos"],
	run: TodoApi.use((api) => api.list),
	schema: { success: Schema.Array(Todo) },
	staleTime: "30 seconds",
});

export const todo = Query.family({
	key: ["todo"],
	run: (id: number) => TodoApi.use((api) => api.find(id)),
	schema: { success: Todo },
	staleTime: "30 seconds",
});

/** The signed-in viewer. Signed out, it redirects to the sign-in page. */
export const viewer = Query.make({
	key: ["viewer"],
	run: Session.use(({ viewer }) =>
		Effect.flatMap(viewer, (name) =>
			name === null
				? Effect.die(redirect({ to: "/login" }))
				: Effect.succeed(name),
		),
	),
	schema: { success: Schema.String },
});
