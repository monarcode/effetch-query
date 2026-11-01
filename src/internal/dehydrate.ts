import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Hydration from "effect/reactivity/Hydration";
import type * as Schema from "effect/Schema";

import { DuplicateQueryKey } from "../HydrationError.js";
import type * as Query from "../Query.js";
import type * as QueryClient from "../QueryClient.js";
import { hydrateValue } from "./cache.js";
import {
	type Codec,
	decodeResult,
	encodeResult,
	hashOption,
} from "./hydration.js";
import { matcher } from "./keyIndex.js";
import { internals, peek, type QueryHydration } from "./queryAtom.js";
import { type ClientState, StateAtom } from "./runtime.js";

const isOwnKey = (key: string): boolean =>
	key.startsWith("effetch-query:") || key.startsWith("effetch-query/");

/**
 * What of a settled result goes to the browser: a success, or a failure
 * when asked for, as not waiting, since nothing fetches it there.
 */
const sendable = <A, E>(
	result: AsyncResult.AsyncResult<A, E>,
	failures: "omit" | "include",
): Option.Option<AsyncResult.AsyncResult<A, E>> => {
	if (AsyncResult.isSuccess(result)) {
		return Option.some(
			AsyncResult.success(result.value, { timestamp: result.timestamp }),
		);
	}
	if (AsyncResult.isFailure(result) && failures === "include") {
		return Option.some(
			AsyncResult.failure(result.cause, {
				previousSuccess: result.previousSuccess,
			}),
		);
	}
	return Option.none();
};

/**
 * A promise of the result of a fetch still running: its JSON once it
 * settles, or an `Initial` (the browser fetches it) when it isn't sent or
 * the client is disposed first.
 */
const settled = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
	codec: Codec<A, E>,
	failures: "omit" | "include",
): Promise<Schema.Json> => {
	const state = registry.get(StateAtom);
	const nothing = codec.encode(AsyncResult.initial());
	return new Promise((resolve) => {
		let unsubscribe: (() => void) | undefined;
		let done = false;
		const settle = (json: Schema.Json) => {
			if (done) {
				return;
			}
			done = true;
			state.onDispose.delete(cancel);
			unsubscribe?.();
			resolve(json);
		};
		const cancel = () => settle(nothing);
		state.onDispose.add(cancel);
		unsubscribe = registry.subscribe(query, (result) => {
			if (!result.waiting) {
				settle(
					Option.getOrElse(
						Option.flatMap(sendable(result, failures), (result) =>
							encodeResult(codec, result),
						),
						() => nothing,
					),
				);
			}
		});
		if (done) {
			unsubscribe();
		}
	});
};

/** `QueryClient.dehydrate` (DESIGN.md §3.12). */
export const dehydrate = (
	registry: AtomRegistry.AtomRegistry,
	options: QueryClient.DehydrateOptions = {},
): Array<Hydration.DehydratedAtom> => {
	const { pending = "omit", failures = "omit" } = options;
	const matches =
		options.queries === undefined ? () => true : matcher(options.queries);
	const dehydratedAt = Date.now();
	const sent = new Set<string>();
	const entries: Array<Hydration.DehydratedAtomValue> = [];
	for (const query of registry.get(StateAtom).index) {
		const { hydration } = internals(query);
		if (hydration === undefined || !matches(query)) {
			continue;
		}
		const entry = toEntry(registry, query, hydration, pending, failures);
		if (Option.isNone(entry)) {
			continue;
		}
		const key = hydration.hash();
		if (sent.has(key)) {
			throw new DuplicateQueryKey({
				key: query.key,
				message: `Two cached queries have the key ${key}, so the browser can't tell them apart`,
			});
		}
		sent.add(key);
		entries.push({
			"~effect/reactivity/Hydration/DehydratedAtom": true,
			key,
			dehydratedAt,
			...entry.value,
		});
	}
	return entries;
};

const toEntry = <A, E>(
	registry: AtomRegistry.AtomRegistry,
	query: Query.Query<A, E>,
	{ codec }: QueryHydration<A, E>,
	pending: "omit" | "promise",
	failures: "omit" | "include",
): Option.Option<{
	readonly value: Schema.Json;
	readonly resultPromise?: Promise<Schema.Json> | undefined;
}> => {
	const current = peek(registry, query);
	if (Option.isNone(current)) {
		return Option.none();
	}
	const result = current.value;
	if (result.waiting && Option.isNone(AsyncResult.value(result))) {
		if (pending === "omit") {
			return Option.none();
		}
		return Option.map(
			encodeResult(codec, AsyncResult.initial(true)),
			(value) => ({
				value,
				resultPromise: settled(registry, query, codec, failures),
			}),
		);
	}
	return Option.map(
		Option.flatMap(sendable(result, failures), (result) =>
			encodeResult(codec, result),
		),
		(value) => ({ value }),
	);
};

/** The cached queries that can cross the wire, by hash. */
const cachedByHash = (
	registry: AtomRegistry.AtomRegistry,
): Map<string, Cached> => {
	const byHash = new Map<string, Cached>();
	for (const query of registry.get(StateAtom).index) {
		const { hydration } = internals(query);
		if (hydration !== undefined) {
			Option.map(hashOption(hydration.hash), (hash) =>
				byHash.set(hash, { query, hydration }),
			);
		}
	}
	return byHash;
};

/**
 * Splits a state into entries for what isn't cached, which loading only
 * stores until it's read, and entries for what is, which loading changes
 * in place. `HydrationBoundary` loads the first during render and the
 * second after commit, as atom-react's does.
 */
export const partition = (
	registry: AtomRegistry.AtomRegistry,
	state: Iterable<Hydration.DehydratedAtom>,
): {
	readonly fresh: Array<Hydration.DehydratedAtomValue>;
	readonly cached: Array<Hydration.DehydratedAtomValue>;
} => {
	const byHash = cachedByHash(registry);
	const nodes = registry.getNodes();
	const fresh: Array<Hydration.DehydratedAtomValue> = [];
	const cached: Array<Hydration.DehydratedAtomValue> = [];
	for (const entry of Hydration.toValues(Array.from(state))) {
		const exists = isOwnKey(entry.key)
			? byHash.has(entry.key)
			: nodes.has(entry.key);
		(exists ? cached : fresh).push(entry);
	}
	return { fresh, cached };
};

/** `QueryClient.hydrate` (DESIGN.md §3.12). */
export const hydrate = (
	registry: AtomRegistry.AtomRegistry,
	state: Iterable<Hydration.DehydratedAtom>,
): void =>
	load(registry, Hydration.toValues(Array.from(state)), () =>
		cachedByHash(registry),
	);

/** Loads entries {@link partition} found no cached query for. */
export const hydrateFresh = (
	registry: AtomRegistry.AtomRegistry,
	entries: ReadonlyArray<Hydration.DehydratedAtomValue>,
): void => load(registry, entries, () => new Map());

const load = (
	registry: AtomRegistry.AtomRegistry,
	entries: ReadonlyArray<Hydration.DehydratedAtomValue>,
	cached: () => Map<string, Cached>,
): void => {
	const client = registry.get(StateAtom);
	let byHash: Map<string, Cached> | undefined;
	const others: Array<Hydration.DehydratedAtomValue> = [];
	for (const entry of entries) {
		if (!isOwnKey(entry.key)) {
			others.push(entry);
			continue;
		}
		byHash ??= cached();
		const target = byHash.get(entry.key);
		if (entry.resultPromise === undefined) {
			loadValue(registry, entry.key, entry.value, target);
		} else {
			stream(registry, client, entry, entry.resultPromise, target?.query);
		}
	}
	if (others.length > 0) {
		Hydration.hydrate(registry, others);
	}
};

/** Stores a value until its query is first read, or puts it into the cached query. */
const loadValue = (
	registry: AtomRegistry.AtomRegistry,
	key: string,
	value: unknown,
	target: Cached | undefined,
): void => {
	if (target === undefined) {
		registry.setSerializable(key, value);
		return;
	}
	Option.map(
		Option.filter(
			decodeResult(target.hydration.codec, value),
			(result) => !AsyncResult.isInitial(result),
		),
		(result) => hydrateValue(registry, target.query, result),
	);
};

interface Cached {
	readonly query: Query.Query<any, any>;
	readonly hydration: QueryHydration<any, any>;
}

/**
 * Leaves a result the server is still loading for the query's next fetch,
 * which waits for it instead of fetching: its first, or, for a cached query
 * that isn't fetching and has nothing newer, the refetch this starts, as
 * TanStack's `hydrate` does with a pending query's promise. If no fetch has
 * taken it when it lands, it's loaded as a value.
 */
const stream = (
	registry: AtomRegistry.AtomRegistry,
	client: ClientState,
	entry: Hydration.DehydratedAtomValue,
	promise: Promise<unknown>,
	query: Query.Query<any, any> | undefined,
): void => {
	registry.preloadedSerializable.delete(entry.key);
	if (query !== undefined) {
		const current = peek(registry, query);
		if (
			Option.isSome(current) &&
			(current.value.waiting ||
				(AsyncResult.isSuccess(current.value) &&
					current.value.timestamp >= entry.dehydratedAt))
		) {
			return;
		}
	}
	client.streamed.set(entry.key, promise);
	// A result no fetch has taken when it lands is loaded as a value, so it
	// keeps the server's timestamp rather than taking the time of a read
	// that may come much later.
	const untaken = () =>
		client.streamed.get(entry.key) === promise &&
		client.streamed.delete(entry.key) &&
		!client.disposed;
	void promise.then((json) => {
		if (untaken()) {
			loadValue(
				registry,
				entry.key,
				json,
				cachedByHash(registry).get(entry.key),
			);
		}
	}, untaken);
	if (query !== undefined) {
		registry.refresh(query);
	}
};
