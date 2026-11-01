import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface LocalServer {
	/** Its origin, such as `http://127.0.0.1:4545`. */
	readonly url: string;
	readonly close: () => Promise<void>;
}

const cors = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

/**
 * Serves `handle` over HTTP on a local port, streaming its responses: the
 * fake dummyjson, for a built app's server and for a browser, which it
 * allows from any origin as dummyjson does; and the built apps themselves.
 */
export const serve = (
	handle: (request: Request) => Promise<Response>,
	port = 0,
): Promise<LocalServer> =>
	new Promise((resolve) => {
		const server = createServer(async (incoming, outgoing) => {
			if (incoming.method === "OPTIONS") {
				// Every header asked for, as dummyjson allows: Effect's
				// `HttpClient` sends a `traceparent`.
				outgoing
					.writeHead(204, {
						...cors,
						"access-control-allow-headers":
							incoming.headers["access-control-request-headers"] ?? "",
					})
					.end();
				return;
			}
			const chunks: Array<Buffer> = [];
			for await (const chunk of incoming) {
				chunks.push(chunk as Buffer);
			}
			const headers = new Headers();
			for (const [name, value] of Object.entries(incoming.headers)) {
				if (typeof value === "string") {
					headers.set(name, value);
				}
			}
			const response = await handle(
				new Request(
					`http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`,
					{
						method: incoming.method ?? "GET",
						headers,
						...(chunks.length === 0
							? {}
							: { body: Buffer.concat(chunks) }),
					},
				),
			);
			outgoing.writeHead(response.status, {
				...Object.fromEntries(response.headers),
				...cors,
			});
			if (response.body !== null) {
				for await (const chunk of response.body) {
					outgoing.write(chunk);
				}
			}
			outgoing.end();
		});
		server.listen(port, "127.0.0.1", () => {
			const { port: bound } = server.address() as AddressInfo;
			resolve({
				url: `http://127.0.0.1:${bound}`,
				close: () =>
					new Promise((done) => {
						server.close(() => done());
					}),
			});
		});
	});
