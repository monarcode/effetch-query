import { createServerFn } from "@tanstack/react-start";

import type { Todo } from "./services.js";

// The server's data, standing in for a database.
const store: ReadonlyArray<Todo> = [
	{ id: 1, title: "Write the integration", done: true },
	{ id: 2, title: "Ship the alpha", done: false },
];

export const listTodos = createServerFn({ method: "GET" }).handler(
	async () => store,
);

export const findTodo = createServerFn({ method: "GET" })
	.validator((id: number) => id)
	.handler(async ({ data }) => {
		// A slow read, so the page renders first and the todo streams in.
		await new Promise((resolve) => setTimeout(resolve, 20));
		return store.find((todo) => todo.id === data) ?? null;
	});

/** Who's signed in: nobody, in this example. */
export const getViewer = createServerFn({ method: "GET" }).handler(
	async () => null as string | null,
);
