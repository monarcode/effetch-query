import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";

import type { Todo } from "./api.js";

/**
 * An in-memory todos API, for the tests and for working on the UI without a
 * server. Its `todos` are the server's data: change them to change what the
 * next request sees.
 */
export interface FakeApi {
	readonly todos: Map<number, Todo>;
	readonly layer: Layer.Layer<HttpClient.HttpClient>;
	/** Holds every response until the returned function is called. */
	readonly hold: () => () => void;
	/** Answers the next request with this status, as a server error would. */
	readonly failNext: (status: number) => void;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

const bodyOf = (body: { readonly _tag: string; readonly body?: unknown }) =>
	body._tag === "Uint8Array" && body.body instanceof Uint8Array
		? JSON.parse(new TextDecoder().decode(body.body))
		: undefined;

export const makeFakeApi = (initial: ReadonlyArray<Todo>): FakeApi => {
	const todos = new Map(initial.map((item) => [item.id, item]));
	const failures: Array<number> = [];
	let held = Promise.resolve();

	const respond = (method: string, url: URL, body: unknown) => {
		const status = failures.shift();
		if (status !== undefined) {
			return json({ message: "The server failed" }, status);
		}
		if (method === "GET" && url.pathname === "/todos") {
			return json([...todos.values()]);
		}
		const id = Number(url.pathname.split("/")[2]);
		const current = todos.get(id);
		if (current === undefined) {
			return json({ message: `No todo ${id}` }, 404);
		}
		if (method === "PATCH") {
			const updated = { ...current, ...(body as Partial<Todo>) };
			todos.set(id, updated);
			return json(updated);
		}
		return json(current);
	};

	const client = HttpClient.make((request, url) =>
		Effect.promise(async () => {
			await held;
			return HttpClientResponse.fromWeb(
				request,
				respond(request.method, url, bodyOf(request.body)),
			);
		}),
	);

	return {
		todos,
		layer: Layer.succeed(HttpClient.HttpClient, client),
		hold: () => {
			let release!: () => void;
			held = new Promise((resolve) => {
				release = resolve;
			});
			return () => {
				release();
				held = Promise.resolve();
			};
		},
		failNext: (status) => {
			failures.push(status);
		},
	};
};
