import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Exit from "effect/Exit";
import * as Hydration from "effect/reactivity/Hydration";

import type * as Query from "../Query.js";
import type * as QueryClient from "../QueryClient.js";
import { dehydrate, hydrate } from "./dehydrate.js";
import { disposeInBackground } from "./disposeAfter.js";
import { subscribe } from "./events.js";
import { StateAtom } from "./runtime.js";

/**
 * The parts of a TanStack router (`@tanstack/router-core`) the integration
 * uses (DESIGN.md §3.13), so any framework's router fits and this module
 * imports nothing from TanStack.
 */
export interface SsrRouter {
	readonly isServer: boolean;
	readonly options: {
		dehydrate?: (() => unknown) | undefined;
		hydrate?: ((dehydrated: any) => unknown) | undefined;
	};
	serverSsrLifecycle?:
		| {
				readonly onServerSsrAttach?:
					| ReadonlyArray<(serverSsr: any) => void>
					| undefined;
		  }
		| undefined;
	readonly serverSsr?: ServerSsr | undefined;
	readonly stores: { readonly location: { readonly get: () => unknown } };
	readonly navigate: (options: any) => unknown;
	readonly resolveRedirect: (redirect: any) => { readonly options: unknown };
}

interface ServerSsr {
	readonly onRenderFinished: (listener: () => void) => void;
	readonly onCleanup: (listener: () => void) => void;
}

/** What the server adds to the router's dehydrated state, under `query`. */
export interface DehydratedQueries {
	/** What the loaders loaded, sent with the page. */
	readonly initial: QueryClient.DehydratedState;
	/** Queries started while rendering, a batch at a time. */
	readonly stream: ReadableStream<QueryClient.DehydratedState>;
}

export interface ConnectOptions {
	readonly router: SsrRouter;
	readonly client: QueryClient.QueryClient;
	readonly dehydrate: Omit<QueryClient.DehydrateOptions, "pending">;
	readonly handleRedirects: boolean;
	/** The router's own `isRedirect`. */
	readonly isRedirect: (value: unknown) => boolean;
}

/** Wires a client into a router's server rendering or its hydration (DESIGN.md §3.13). */
export const connect = (options: ConnectOptions): void => {
	if (options.router.isServer) {
		connectServer(options);
		return;
	}
	connectBrowser(options);
};

const connectServer = ({
	router,
	client,
	dehydrate: dehydrateOptions,
}: ConnectOptions): void => {
	const state = client.registry.get(StateAtom);
	// Attached before `router.load()`, so a redirect or an error thrown before
	// the router dehydrates still disposes the client.
	router.serverSsrLifecycle = {
		...router.serverSsrLifecycle,
		onServerSsrAttach: [
			...(router.serverSsrLifecycle?.onServerSsrAttach ?? []),
			(serverSsr: ServerSsr) =>
				serverSsr.onCleanup(() => disposeInBackground(client)),
		],
	};
	const theirs = router.options.dehydrate;
	router.options.dehydrate = async () => {
		const dehydrated = (await theirs?.()) as object | undefined;
		const serverSsr = router.serverSsr;
		if (state.disposed || serverSsr === undefined) {
			return dehydrated;
		}
		const options = { ...dehydrateOptions, pending: "promise" } as const;
		const sent = new Map<string, Query.Query<any, any>>();
		const initial = dehydrate(client.registry, options, sent);
		let controller!: ReadableStreamDefaultController<QueryClient.DehydratedState>;
		const stream = new ReadableStream<QueryClient.DehydratedState>({
			start(started) {
				controller = started;
			},
		});
		let open = true;
		let scheduled = false;
		const finish = (failure?: { readonly error: unknown }) => {
			if (!open) {
				return;
			}
			open = false;
			unsubscribe();
			try {
				if (failure === undefined) {
					controller.close();
				} else {
					controller.error(failure.error);
				}
			} catch {
				// The reader may have cancelled the stream already.
			}
		};
		const flush = () => {
			scheduled = false;
			if (!open || state.disposed) {
				return;
			}
			try {
				const batch = dehydrate(client.registry, options, sent);
				if (batch.length > 0) {
					controller.enqueue(batch);
				}
			} catch (error) {
				finish({ error });
			}
		};
		// A microtask batches queries started in the same turn, and sends
		// them before React resumes a Suspense boundary that waited on them.
		const unsubscribe = subscribe(state, (event) => {
			if (event._tag === "FetchStarted" && !scheduled) {
				scheduled = true;
				queueMicrotask(flush);
			}
		});
		serverSsr.onRenderFinished(() => {
			flush();
			finish();
		});
		serverSsr.onCleanup(() => finish());
		const query: DehydratedQueries = { initial, stream };
		return { ...dehydrated, query };
	};
};

const connectBrowser = ({
	router,
	client,
	handleRedirects,
	isRedirect,
}: ConnectOptions): void => {
	const theirs = router.options.hydrate;
	router.options.hydrate = async (
		dehydrated:
			| { readonly query?: DehydratedQueries | undefined }
			| undefined,
	) => {
		const query = dehydrated?.query;
		const ended = pageEnded();
		try {
			await theirs?.(dehydrated);
			if (query !== undefined) {
				hydrate(client.registry, untilPageEnd(query.initial, ended));
			}
		} catch (error) {
			void query?.stream.cancel(error).catch(() => {});
			throw error;
		}
		if (query !== undefined) {
			void readBatches(client, query.stream, ended);
		}
	};
	if (handleRedirects) {
		subscribe(client.registry.get(StateAtom), (event) => {
			if (
				event._tag !== "FetchSettled" &&
				event._tag !== "MutationSettled"
			) {
				return;
			}
			// An awaited fetch's redirect reaches whatever awaits it: a loader's
			// reaches the router, which follows it, and a preload's is dropped.
			if (
				(event._tag === "FetchSettled" && event.awaited) ||
				Exit.isSuccess(event.exit)
			) {
				return;
			}
			const redirect = event.exit.cause.reasons
				.map((reason) =>
					Cause.isFailReason(reason)
						? reason.error
						: Cause.isDieReason(reason)
							? reason.defect
							: undefined,
				)
				.find(isRedirect) as
				| { options: Record<string, unknown> }
				| undefined;
			if (redirect !== undefined) {
				redirect.options["_fromLocation"] = router.stores.location.get();
				void router.navigate(router.resolveRedirect(redirect).options);
			}
		});
	}
};

/** Hydrates each streamed batch as it lands; a failure is reported, not thrown. */
const readBatches = async (
	client: QueryClient.QueryClient,
	stream: ReadableStream<QueryClient.DehydratedState>,
	ended: Promise<void> | undefined,
): Promise<void> => {
	const reader = stream.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				return;
			}
			hydrate(client.registry, untilPageEnd(value, ended));
		}
	} catch (error) {
		void reader.cancel(error).catch(() => {});
		queueMicrotask(() => {
			throw error;
		});
	} finally {
		reader.releaseLock();
	}
};

/** Why a streamed result is given up on: the page ended without it. */
class ResultNotSent extends Data.TaggedError("ResultNotSent")<{}> {}

/**
 * Settles once the page has loaded and its scripts have run, after which
 * the server sends nothing more. Without a DOM, never.
 */
const pageEnded = (): Promise<void> | undefined => {
	const { document } = globalThis;
	if (typeof document?.addEventListener !== "function") {
		return undefined;
	}
	return new Promise((resolve) => {
		// A macrotask later, so a result the last script resolved lands first.
		const settle = () => setTimeout(resolve, 0);
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", settle, { once: true });
		} else {
			settle();
		}
	});
};

/**
 * Gives up on streamed results still pending when the page ends, such as
 * when the server's serialization timed out, so their queries fetch rather
 * than wait for good.
 */
const untilPageEnd = (
	state: QueryClient.DehydratedState,
	ended: Promise<void> | undefined,
): QueryClient.DehydratedState => {
	if (ended === undefined) {
		return state;
	}
	const notSent = ended.then(() => Promise.reject(new ResultNotSent()));
	// Rejecting is how a race is lost; nothing else waits on it.
	notSent.catch(() => {});
	return Hydration.toValues(Array.from(state)).map((entry) =>
		entry.resultPromise === undefined
			? entry
			: {
					...entry,
					resultPromise: Promise.race([entry.resultPromise, notSent]),
				},
	);
};
