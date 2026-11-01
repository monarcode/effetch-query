import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Query, QueryClient } from "../src/index.js";
import { disposeClients, makeClient } from "./helpers.js";

afterEach(disposeClients);

class StreamBroke extends Data.TaggedError("StreamBroke")<{}> {}

class DisposeFailed extends Data.TaggedError("DisposeFailed")<{}> {}

const isDisposed = (client: QueryClient.QueryClient) => {
	try {
		client.registry.get(Query.make({ key: ["probe"], run: Effect.void }));
		return false;
	} catch {
		return true;
	}
};

/** A body the test feeds chunk by chunk. */
const feed = () => {
	let push: (chunk: string) => void = () => {};
	let end: () => void = () => {};
	let fail: (error: unknown) => void = () => {};
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			push = (chunk) => controller.enqueue(encoder.encode(chunk));
			end = () => controller.close();
			fail = (error) => controller.error(error);
		},
	});
	return { body, push: (chunk: string) => push(chunk), end, fail };
};

describe("QueryClient.disposeAfter", () => {
	it("disposes the client once the body has been read to its end", async () => {
		const client = await makeClient();
		const source = feed();
		const response = QueryClient.disposeAfter(
			client,
			new Response(source.body),
		);
		source.push("streamed ");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(isDisposed(client)).toBe(false);

		source.push("results");
		source.end();

		expect(await response.text()).toBe("streamed results");
		await vi.waitFor(() => expect(isDisposed(client)).toBe(true));
	});

	it("keeps the response's status, status text and headers", async () => {
		const client = await makeClient();
		const response = QueryClient.disposeAfter(
			client,
			new Response("missing", {
				status: 404,
				statusText: "Not Found",
				headers: { "Content-Type": "text/plain", "X-Request": "1" },
			}),
		);

		expect(response.status).toBe(404);
		expect(response.statusText).toBe("Not Found");
		expect(response.headers.get("Content-Type")).toBe("text/plain");
		expect(response.headers.get("X-Request")).toBe("1");
		expect(await response.text()).toBe("missing");
	});

	it("disposes the client when the reader cancels the body", async () => {
		const client = await makeClient();
		const source = feed();
		const response = QueryClient.disposeAfter(
			client,
			new Response(source.body),
		);

		await response.body?.cancel();

		await vi.waitFor(() => expect(isDisposed(client)).toBe(true));
	});

	it("disposes the client when the body fails, and passes the failure on", async () => {
		const client = await makeClient();
		const source = feed();
		const response = QueryClient.disposeAfter(
			client,
			new Response(source.body),
		);
		source.fail(new StreamBroke());

		await expect(response.text()).rejects.toBeInstanceOf(StreamBroke);
		await vi.waitFor(() => expect(isDisposed(client)).toBe(true));
	});

	it("disposes the client at once for a response with no body", async () => {
		const client = await makeClient();
		const redirect = Response.redirect("http://localhost/login", 302);

		expect(QueryClient.disposeAfter(client, redirect)).toBe(redirect);
		await vi.waitFor(() => expect(isDisposed(client)).toBe(true));
	});

	it("disposes the client and throws for a body already read", async () => {
		const client = await makeClient();
		const response = new Response("read");
		await response.text();

		expect(() => QueryClient.disposeAfter(client, response)).toThrow(
			TypeError,
		);
		await vi.waitFor(() => expect(isDisposed(client)).toBe(true));
	});

	it("logs a failed dispose rather than rejecting", async () => {
		const failure = new DisposeFailed();
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const client = await makeClient();
		vi.spyOn(client, "dispose").mockRejectedValue(failure);

		QueryClient.disposeAfter(client, new Response(null));

		await vi.waitFor(() =>
			expect(errors).toHaveBeenCalledWith(
				"Disposing the request's query client failed:",
				failure,
			),
		);
	});
});
