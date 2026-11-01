import type * as QueryClient from "../QueryClient.js";

/**
 * Disposes a client nothing awaits, logging a failure: a rejection left
 * unhandled would end a Node server's process.
 */
export const disposeInBackground = (client: QueryClient.QueryClient): void => {
	client.dispose().catch((error: unknown) => {
		console.error("Disposing the request's query client failed:", error);
	});
};

/** `QueryClient.disposeAfter`. */
export const disposeAfter = (
	client: QueryClient.QueryClient,
	response: Response,
): Response => {
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	try {
		reader = response.body?.getReader();
	} catch (error) {
		// A body already read or locked can't be wrapped.
		disposeInBackground(client);
		throw error;
	}
	if (reader === undefined) {
		disposeInBackground(client);
		return response;
	}
	let disposed = false;
	const release = () => {
		if (!disposed) {
			disposed = true;
			disposeInBackground(client);
		}
	};
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					controller.close();
					release();
				} else {
					controller.enqueue(value);
				}
			} catch (error) {
				controller.error(error);
				release();
			}
		},
		cancel(reason) {
			release();
			return reader.cancel(reason);
		},
	});
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
};
