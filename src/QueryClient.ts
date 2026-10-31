import type * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Reactivity from "effect/reactivity/Reactivity";
import type * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";

import { observeNodes } from "./internal/cache.js";
import { initialValues, makeClientState } from "./internal/runtime.js";
import type { QueryKey } from "./Query.js";
import type { Signals } from "./Signals.js";

/**
 * Declares the services your queries and mutations run with. Augment it once,
 * next to your composition root, and every definition, client hook and
 * {@link QueryClient.runPromise} is typed against it:
 *
 * - {@link make} requires a layer that provides these services.
 * - An Effect that needs a service outside them doesn't compile.
 *
 * Without the augmentation, {@link Services} is `never`, so anything that
 * needs a service fails to compile.
 *
 * @example
 * ```ts
 * import * as Context from "effect/Context";
 * import * as Layer from "effect/Layer";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 *
 * class Greeter extends Context.Service<
 *   Greeter,
 *   { readonly greet: (name: string) => string }
 * >()("app/Greeter") {}
 *
 * declare module "@monarcode/effetch-query" {
 *   interface Register {
 *     readonly services: Greeter;
 *   }
 * }
 *
 * export const queryClient = QueryClient.make({
 *   layer: Layer.succeed(Greeter, { greet: (name) => `Hello, ${name}` }),
 * });
 * ```
 *
 * @since 0.1.0
 */
export interface Register {}

/**
 * The services declared in {@link Register}, or `never` without the
 * augmentation.
 *
 * @example
 * ```ts
 * import type * as Effect from "effect/Effect";
 *
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * // An Effect that needs only your services.
 * type UsesServices = Effect.Effect<void, never, QueryClient.Services>;
 * ```
 *
 * @since 0.1.0
 */
export type Services = Register extends { readonly services: infer S }
	? S
	: never;

/**
 * What queries, mutations and the client's hooks run with: your
 * {@link Services} and the {@link QueryClient}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 *
 * export const nodeCount: Effect.Effect<number, never, QueryClient.Requirements> =
 *   QueryClient.QueryClient.useSync((client) => client.registry.getNodes().size);
 * ```
 *
 * @since 0.1.0
 */
export type Requirements = Services | QueryClient;

/**
 * An app-wide hook in {@link QueriesOptions} or {@link MutationsOptions}: it
 * receives an event and runs with your services and the client. It can't
 * fail; handle errors inside it. A hook that dies is logged, and the others
 * still run. Query hooks run in a fiber of their own, after the query shows
 * its result, so a slow hook doesn't hold the query up.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * export const logFetch: QueryClient.Hook<QueryClient.QuerySucceeded> = ({
 *   key,
 * }) => Effect.log("Fetched", key);
 * ```
 *
 * @since 0.1.0
 */
export type Hook<Event> = (
	event: Event,
) => Effect.Effect<void, never, Requirements>;

/**
 * A query cache with its own {@link AtomRegistry.AtomRegistry} and its own
 * build of your layer. Create one with {@link make} (or {@link layer} in
 * Effect programs). Every query, mutation and Effect-side cache function runs
 * with it, as the {@link QueryClient} service.
 *
 * A client is cheap to create. On a server, create one per request and
 * {@link QueryClient.dispose} it when the response is done.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import type * as Layer from "effect/Layer";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 *
 * const queryClient = QueryClient.make({ layer: AppLayer });
 *
 * const answer = await queryClient.runPromise(Effect.succeed(42));
 *
 * await queryClient.dispose();
 * ```
 *
 * @since 0.1.0
 */
export interface QueryClient {
	/**
	 * The registry that holds this client's cache, for `@effect/atom-react`
	 * and your own atoms. Don't `reset` or `dispose` it: use
	 * {@link QueryClient.dispose}. Its `onNodeAdded` and `onNodeRemoved`
	 * hooks are the client's: replacing them breaks invalidation.
	 */
	readonly registry: AtomRegistry.AtomRegistry;
	/**
	 * Runs an Effect with your services and this client, for code outside
	 * Effect such as a router loader. `Reactivity` is provided too, the
	 * instance the cache listens to, so `Reactivity.invalidate` run here
	 * refetches queries that declare those keys. If the Effect fails, rejects
	 * with its error (`Cause.squash`), as `Effect.runPromise` does. Pass
	 * `{ signal }` to interrupt it when the signal aborts.
	 */
	readonly runPromise: <A, E>(
		effect: Effect.Effect<A, E, Requirements | Reactivity.Reactivity>,
		options?: Effect.RunOptions | undefined,
	) => Promise<A>;
	/**
	 * Like {@link QueryClient.runPromise}, but resolves with the `Exit`
	 * instead of rejecting.
	 */
	readonly runPromiseExit: <A, E>(
		effect: Effect.Effect<A, E, Requirements | Reactivity.Reactivity>,
		options?: Effect.RunOptions | undefined,
	) => Promise<Exit.Exit<A, E>>;
	/**
	 * Releases everything the client owns. It disposes the cache and clears
	 * its timers, interrupts fetches in flight and the Effects started by
	 * {@link QueryClient.runPromise}, then closes the layer's scope. A layer
	 * build in progress is waited for, not cut short, because a memo map
	 * shared with your app runtime would keep the interruption.
	 *
	 * Resolves once the interrupted fetches and the layer's finalizers have
	 * run. If a finalizer throws, the layer is still released and the promise
	 * rejects. Don't use the client afterwards.
	 */
	readonly dispose: () => Promise<void>;
}

/**
 * The service every Effect-side cache function needs. Queries, mutations and
 * the client's hooks already run with it; elsewhere, run the Effect with
 * {@link QueryClient.runPromise} or provide {@link layer}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 *
 * const nodeCount: Effect.Effect<number, never, QueryClient.QueryClient> =
 *   QueryClient.QueryClient.useSync((client) => client.registry.getNodes().size);
 * ```
 *
 * @since 0.1.0
 */
export const QueryClient: Context.Service<QueryClient, QueryClient> =
	Context.Service<QueryClient>("@monarcode/effetch-query/QueryClient");

/**
 * Options for {@link make} and {@link layer}.
 *
 * @example
 * ```ts
 * import type * as Layer from "effect/Layer";
 * import * as Schedule from "effect/Schedule";
 *
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 *
 * export const options: QueryClient.Options = {
 *   layer: AppLayer,
 *   queries: {
 *     defaults: { staleTime: "1 minute", retry: Schedule.recurs(2) },
 *   },
 *   mutations: { defaults: { concurrent: false } },
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface Options {
	/**
	 * Provides the services declared in {@link Register}. The client builds it
	 * the first time it's needed and keeps it until
	 * {@link QueryClient.dispose}. If it fails to build, everything that needs
	 * it dies with that failure.
	 */
	readonly layer: Layer.Layer<Services, unknown>;
	/**
	 * The memo map to build `layer` with. Pass your `ManagedRuntime`'s
	 * `memoMap` so layers it has built are shared rather than built twice.
	 * Default: a new one, or for {@link layer} the memo map of the layer graph
	 * the client is built in.
	 *
	 * Clients that share a memo map also share one `Reactivity`, so a
	 * `Reactivity.invalidate` in one refetches the matching queries of all of
	 * them. No cached values cross between clients.
	 */
	readonly memoMap?: Layer.MemoMap | undefined;
	/** Where focus and reconnect come from. Default: the browser's. */
	readonly signals?: Signals | undefined;
	/** Defaults and app-wide hooks for every query. */
	readonly queries?: QueriesOptions | undefined;
	/** Defaults and app-wide hooks for every mutation. */
	readonly mutations?: MutationsOptions | undefined;
}

/**
 * The `queries` group of {@link Options}: defaults for every query, and hooks
 * that run on every fetch. The hooks run with your services, after the
 * query's `retry`. Interruptions never reach them.
 *
 * @example
 * ```ts
 * import * as Cause from "effect/Cause";
 * import * as Effect from "effect/Effect";
 *
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * export const queries: QueryClient.QueriesOptions = {
 *   defaults: { staleTime: "30 seconds" },
 *   onFailure: ({ key, cause }) =>
 *     Effect.logWarning("Query failed", key, Cause.pretty(cause)),
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface QueriesOptions {
	/** Options for every query. A query's own options override them. */
	readonly defaults?: QueryDefaults | undefined;
	/** Runs once per successful fetch, not for `Query.set`. */
	readonly onSuccess?: Hook<QuerySucceeded> | undefined;
	/** Runs once per failed fetch, after `retry`. */
	readonly onFailure?: Hook<QueryFailed> | undefined;
	/**
	 * Runs once per fetch that succeeds or fails, after `onSuccess` or
	 * `onFailure`. None of the hooks run for a fetch that was interrupted
	 * (replaced by a refetch, reset, collected or disposed).
	 */
	readonly onSettled?: Hook<QuerySettled> | undefined;
}

/**
 * Options every query takes, set for all of them in
 * {@link QueriesOptions.defaults}. A query's own options (`Query.Options`)
 * extend these, with `E` its error type.
 *
 * @example
 * ```ts
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * export const defaults: QueryClient.QueryDefaults = {
 *   staleTime: "1 minute",
 *   refetchOnFocus: false,
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface QueryDefaults<E = unknown> {
	/** How long a success counts as fresh. Default: 0, stale at once. */
	readonly staleTime?: Duration.Input | undefined;
	/**
	 * Retries a failed fetch on this schedule, which gets each failure.
	 * Defects aren't retried. Default: no retries.
	 */
	readonly retry?: Schedule.Schedule<unknown, E> | undefined;
	/** Refetch a stale query when a component starts using it. Default: `true`. */
	readonly refetchOnMount?: boolean | undefined;
	/** Refetch a failed query when a component starts using it. Default: `true`. */
	readonly retryOnMount?: boolean | undefined;
	/** Refetch a stale query in use when the app regains focus. Default: `true`. */
	readonly refetchOnFocus?: boolean | undefined;
	/** Refetch a stale query in use when the device reconnects. Default: `true`. */
	readonly refetchOnReconnect?: boolean | undefined;
	/**
	 * Refetch a query in use this often. Polling pauses while nothing uses
	 * the query and resumes when something starts using it. Default: never.
	 */
	readonly refetchInterval?: Duration.Input | undefined;
}

/**
 * What {@link QueriesOptions.onSuccess} receives.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * export const onSuccess = ({ key }: QueryClient.QuerySucceeded) =>
 *   Effect.log("Fetched", key);
 * ```
 *
 * @since 0.1.0
 */
export interface QuerySucceeded {
	/** The query's key. */
	readonly key: QueryKey;
	/** The fetched value. */
	readonly value: unknown;
}

/**
 * What {@link QueriesOptions.onFailure} receives.
 *
 * @example
 * ```ts
 * import * as Cause from "effect/Cause";
 * import * as Effect from "effect/Effect";
 *
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * export const onFailure = ({ key, cause }: QueryClient.QueryFailed) =>
 *   Effect.logWarning("Query failed", key, Cause.pretty(cause));
 * ```
 *
 * @since 0.1.0
 */
export interface QueryFailed {
	/** The query's key. */
	readonly key: QueryKey;
	/** Why the fetch failed, after `retry`. */
	readonly cause: Cause.Cause<unknown>;
}

/**
 * What {@link QueriesOptions.onSettled} receives.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import * as Exit from "effect/Exit";
 *
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * export const onSettled = ({ key, exit }: QueryClient.QuerySettled) =>
 *   Effect.log("Settled", key, Exit.isSuccess(exit));
 * ```
 *
 * @since 0.1.0
 */
export interface QuerySettled {
	/** The query's key. */
	readonly key: QueryKey;
	/** How the fetch ended, after `retry`. */
	readonly exit: Exit.Exit<unknown, unknown>;
}

/**
 * The `mutations` group of {@link Options}: defaults for every mutation, and
 * hooks that run on every run, after the mutation's own callbacks. The hooks
 * run with your services. Interruptions never reach them.
 *
 * @example
 * ```ts
 * import * as Cause from "effect/Cause";
 * import * as Effect from "effect/Effect";
 *
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * export const mutations: QueryClient.MutationsOptions = {
 *   defaults: { concurrent: true },
 *   onFailure: ({ cause }) =>
 *     Effect.logWarning("Mutation failed", Cause.pretty(cause)),
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface MutationsOptions {
	/** Options for every mutation. A mutation's own options override them. */
	readonly defaults?: MutationDefaults | undefined;
	/** Runs before each run, after the mutation's optimistic writes. */
	readonly onMutate?: Hook<MutationStarted> | undefined;
	/** Runs after each successful run. */
	readonly onSuccess?: Hook<MutationSucceeded> | undefined;
	/** Runs after each failed run, once its optimistic writes are rolled back. */
	readonly onFailure?: Hook<MutationFailed> | undefined;
	/** Runs after each run that succeeds or fails. */
	readonly onSettled?: Hook<MutationSettled> | undefined;
}

/**
 * Options every mutation takes, set for all of them in
 * {@link MutationsOptions.defaults}.
 *
 * @example
 * ```ts
 * import * as Schedule from "effect/Schedule";
 *
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * export const defaults: QueryClient.MutationDefaults = {
 *   retry: Schedule.recurs(1),
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface MutationDefaults {
	/** Retries a failed run on this schedule. Default: no retries. */
	readonly retry?: Schedule.Schedule<unknown, unknown> | undefined;
	/**
	 * Whether runs can overlap. With `false`, a new run interrupts the one in
	 * progress. Default: `true`.
	 */
	readonly concurrent?: boolean | undefined;
}

/**
 * What {@link MutationsOptions.onMutate} receives.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * export const onMutate = ({ variables }: QueryClient.MutationStarted) =>
 *   Effect.log("Mutating", variables);
 * ```
 *
 * @since 0.1.0
 */
export interface MutationStarted {
	/** What the mutation was called with. */
	readonly variables: unknown;
}

/**
 * What {@link MutationsOptions.onSuccess} receives.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 *
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * export const onSuccess = ({ value }: QueryClient.MutationSucceeded) =>
 *   Effect.log("Mutated", value);
 * ```
 *
 * @since 0.1.0
 */
export interface MutationSucceeded {
	/** What the mutation was called with. */
	readonly variables: unknown;
	/** What the run returned. */
	readonly value: unknown;
}

/**
 * What {@link MutationsOptions.onFailure} receives.
 *
 * @example
 * ```ts
 * import * as Cause from "effect/Cause";
 * import * as Effect from "effect/Effect";
 *
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * export const onFailure = ({ cause }: QueryClient.MutationFailed) =>
 *   Effect.logWarning("Mutation failed", Cause.pretty(cause));
 * ```
 *
 * @since 0.1.0
 */
export interface MutationFailed {
	/** What the mutation was called with. */
	readonly variables: unknown;
	/** Why the run failed, after `retry`. */
	readonly cause: Cause.Cause<unknown>;
}

/**
 * What {@link MutationsOptions.onSettled} receives.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import * as Exit from "effect/Exit";
 *
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * export const onSettled = ({ exit }: QueryClient.MutationSettled) =>
 *   Effect.log("Mutation settled", Exit.isSuccess(exit));
 * ```
 *
 * @since 0.1.0
 */
export interface MutationSettled {
	/** What the mutation was called with. */
	readonly variables: unknown;
	/** How the run ended, after `retry`. */
	readonly exit: Exit.Exit<unknown, unknown>;
}

/**
 * Creates a {@link QueryClient}. Nothing is built until the client is first
 * used: then it builds `layer` once and keeps it until
 * {@link QueryClient.dispose}.
 *
 * @example
 * ```ts
 * import type * as Layer from "effect/Layer";
 * import * as ManagedRuntime from "effect/ManagedRuntime";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 * const appRuntime = ManagedRuntime.make(AppLayer);
 *
 * export const queryClient = QueryClient.make({
 *   layer: AppLayer,
 *   // Share layers already built by the app's runtime.
 *   memoMap: appRuntime.memoMap,
 *   queries: { defaults: { staleTime: "1 minute" } },
 * });
 * ```
 *
 * @see {@link layer} to create one in an Effect program
 *
 * @since 0.1.0
 */
export const make = (options: Options): QueryClient => {
	const memoMap = options.memoMap ?? Layer.makeMemoMapUnsafe();
	// `Reactivity.layer` is last so it wins over one in `options.layer`: the
	// runtime's atoms build the same layer with the same memo map, so both
	// see one instance.
	const services = Layer.mergeAll(
		Layer.orDie(options.layer),
		Layer.sync(QueryClient, () => client),
		Reactivity.layer,
	);
	// Disposing the runtime interrupts a build in progress. With a shared memo
	// map, the app's runtime may be waiting on that build, and its memo map
	// entry would keep the interruption, so the build can't be interrupted.
	const runtime = ManagedRuntime.make(
		Layer.fromBuild((memoMap, scope) =>
			Effect.uninterruptible(
				Layer.buildWithMemoMap(services, memoMap, scope),
			),
		),
		{ memoMap },
	);
	const state = makeClientState();
	const registry = AtomRegistry.make({
		initialValues: initialValues({
			layer: Layer.effectContext(runtime.contextEffect),
			memoMap,
			state,
			options,
		}),
	});
	observeNodes(registry, state);
	const client: QueryClient = {
		registry,
		runPromise: (effect, runOptions) =>
			runtime.runPromise(effect, runOptions),
		runPromiseExit: (effect, runOptions) =>
			runtime.runPromiseExit(effect, runOptions),
		// Disposing the registry interrupts fetches without waiting for them,
		// so they're awaited before the layer they use is released.
		// `registry.dispose()` rethrows a finalizer's error: the rest still
		// runs, and the error becomes the rejection.
		dispose: () =>
			Effect.runPromise(
				Effect.sync(() => registry.dispose()).pipe(
					Effect.ensuring(
						Effect.suspend(() => Fiber.interruptAll([...state.fibers])),
					),
					Effect.ensuring(runtime.disposeEffect),
				),
			),
	};
	return client;
};

/**
 * Creates a {@link QueryClient} as a layer, for Effect programs and tests
 * without React. The client is disposed when the layer's scope closes.
 *
 * Unless `options.memoMap` is set, the client builds `options.layer` with
 * the memo map of the layer graph it's built in, so services that graph also
 * builds are built once.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import type * as Layer from "effect/Layer";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 *
 * const program = Effect.gen(function* () {
 *   const client = yield* QueryClient.QueryClient;
 *   return client.registry.getNodes().size;
 * });
 *
 * Effect.runPromise(
 *   program.pipe(Effect.provide(QueryClient.layer({ layer: AppLayer }))),
 * );
 * ```
 *
 * @see {@link make} to create one outside Effect
 *
 * @since 0.1.0
 */
export const layer = (options: Options): Layer.Layer<QueryClient> =>
	Layer.fromBuildMemo((memoMap, scope) =>
		Effect.suspend(() => {
			const client = make({
				...options,
				memoMap: options.memoMap ?? memoMap,
			});
			return Effect.as(
				Scope.addFinalizer(
					scope,
					Effect.promise(() => client.dispose()),
				),
				Context.make(QueryClient, client),
			);
		}),
	);
