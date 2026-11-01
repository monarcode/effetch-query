import type * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type * as Hydration from "effect/reactivity/Hydration";
import * as Reactivity from "effect/reactivity/Reactivity";
import type * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";

import { observeNodes } from "./internal/cache.js";
import * as hydration from "./internal/dehydrate.js";
import * as disposal from "./internal/disposeAfter.js";
import { initialValues, makeClientState, track } from "./internal/runtime.js";
import type { Mutation } from "./Mutation.js";
import type * as Query from "./Query.js";
import type { Signals } from "./Signals.js";

export { DuplicateQueryKeyError, NonJsonKeyError } from "./HydrationError.js";

/**
 * Declares the services your queries and mutations run with. Augment it once,
 * next to your composition root, and every definition, client hook and
 * {@link QueryClient.runPromise} is typed against it:
 *
 * - {@link make} requires a layer or a runtime that provides these services.
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
 * its result, so a slow hook doesn't hold the query up. Mutation hooks are
 * part of the run: it completes after them.
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
 * A query cache with its own {@link AtomRegistry.AtomRegistry}, and your
 * services from its own build of your layer or from your runtime. Create one
 * with {@link make} (or {@link layer} in Effect programs). Every query,
 * mutation and Effect-side cache function runs with it, as the
 * {@link QueryClient} service.
 *
 * A client is cheap to create. On a server, create one per request from
 * your process's runtime ({@link RuntimeOptions}) and
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
	 * its timers, then interrupts what's in flight: fetches, mutation runs,
	 * and the Effects started by {@link QueryClient.runPromise}. Last, it
	 * closes the layer's scope. An interrupted mutation run doesn't roll back
	 * its optimistic writes, since the cache is already gone. A layer build in
	 * progress is waited for, not cut short, because a memo map shared with
	 * your app runtime would keep the interruption.
	 *
	 * Resolves once everything interrupted and the layer's finalizers have
	 * run. If a finalizer throws, the layer is still released and the
	 * promise rejects. Don't use the client afterwards.
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
 * Options for {@link make} and {@link layer}: your services, as a layer
 * ({@link LayerOptions}) or a runtime that already provides them
 * ({@link RuntimeOptions}), with the {@link CommonOptions}.
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
export type Options = LayerOptions | RuntimeOptions;

/**
 * {@link Options} that give the client a layer, which it builds itself.
 *
 * @example
 * ```ts
 * import type * as Layer from "effect/Layer";
 *
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 *
 * export const options: QueryClient.LayerOptions = { layer: AppLayer };
 * ```
 *
 * @see {@link RuntimeOptions} to use a runtime you already have
 *
 * @since 0.1.0
 */
export interface LayerOptions extends CommonOptions {
	/**
	 * Provides the services declared in {@link Register}. The client builds it
	 * the first time it's needed and keeps it until
	 * {@link QueryClient.dispose}. If it fails to build, everything that needs
	 * it dies with that failure.
	 */
	readonly layer: Layer.Layer<Services, unknown>;
	/**
	 * The memo map to build `layer` with, so layers built with it before are
	 * shared rather than built twice: pass a `ManagedRuntime`'s `memoMap` when
	 * the client adds services of its own to the runtime's (with none, pass
	 * the runtime itself, {@link RuntimeOptions}). Default: a new one, or for
	 * {@link layer} the memo map of the layer graph the client is built in.
	 *
	 * Clients that share a memo map also share one `Reactivity`, so a
	 * `Reactivity.invalidate` in one refetches the matching queries of all of
	 * them. No cached values cross between clients.
	 */
	readonly memoMap?: Layer.MemoMap | undefined;
	/** Not with a layer: see {@link RuntimeOptions}. */
	readonly runtime?: undefined;
}

/**
 * {@link Options} that give the client a `ManagedRuntime` providing your
 * services, built once for every client that uses it. Share one runtime per
 * process: on a server, each request's client then reuses its services
 * rather than building them again.
 *
 * The client doesn't own the runtime: {@link QueryClient.dispose} leaves it
 * running. The runtime builds its layer the first time any client needs it;
 * if that fails, or the runtime has been disposed, everything that needs it
 * dies.
 *
 * The client builds its own parts with the runtime's `memoMap`, so it shares
 * the runtime's `Reactivity` with the services the runtime built (an SQL
 * client publishes on it) and with the runtime's other clients: a
 * `Reactivity.invalidate` in any of them refetches the matching queries of
 * all. No cached values cross between clients.
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
 * // A client per request, sharing the runtime's services.
 * export const handle = async (request: Request) => {
 *   const queryClient = QueryClient.make({ runtime: appRuntime });
 *   try {
 *     return new Response(new URL(request.url).pathname);
 *   } finally {
 *     await queryClient.dispose();
 *   }
 * };
 * ```
 *
 * @see {@link LayerOptions} to give the client a layer instead
 *
 * @since 0.1.0
 */
export interface RuntimeOptions extends CommonOptions {
	/** Provides the services declared in {@link Register}. */
	readonly runtime: ManagedRuntime.ManagedRuntime<Services, unknown>;
	/** Not with a runtime, which provides the services. */
	readonly layer?: undefined;
	/** Not with a runtime: the client uses the runtime's. */
	readonly memoMap?: undefined;
}

/**
 * The {@link Options} every client takes, whether it's given a layer or a
 * runtime.
 *
 * @example
 * ```ts
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * export const common: QueryClient.CommonOptions = {
 *   queries: { defaults: { staleTime: "1 minute" } },
 *   mutations: { defaults: { concurrent: false } },
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface CommonOptions {
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
	readonly key: Query.Key;
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
	readonly key: Query.Key;
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
	readonly key: Query.Key;
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
	/** Runs before each run's `run`, after its optimistic writes. */
	readonly onMutate?: Hook<MutationStarted> | undefined;
	/** Runs after each successful run, after its `onSuccess` and `invalidates`. */
	readonly onSuccess?: Hook<MutationSucceeded> | undefined;
	/**
	 * Runs after each failed run, after its optimistic writes are rolled back
	 * and its `onFailure` ran.
	 */
	readonly onFailure?: Hook<MutationFailed> | undefined;
	/**
	 * Runs after each run that succeeds or fails, after its `onSettled`. None
	 * of the hooks run past an interruption.
	 */
	readonly onSettled?: Hook<MutationSettled> | undefined;
}

/**
 * Options every mutation takes, set for all of them in
 * {@link MutationsOptions.defaults}. A mutation's own options
 * (`Mutation.MakeOptions`) extend these, with `E` its error type.
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
export interface MutationDefaults<E = unknown> {
	/**
	 * Retries a failed run on this schedule, which gets each failure. Defects
	 * aren't retried. Default: no retries.
	 */
	readonly retry?: Schedule.Schedule<unknown, E> | undefined;
	/**
	 * Whether one use's runs can overlap, such as one component's
	 * `useMutation`. With `false`, a new run interrupts the one in progress,
	 * whose optimistic writes are rolled back first. Separate uses, and
	 * `Mutation.run` calls, never interrupt each other. Default: `true`.
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
	/** The mutation's definition, to compare with yours. */
	readonly mutation: Mutation<never, unknown, unknown>;
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
	/** The mutation's definition, to compare with yours. */
	readonly mutation: Mutation<never, unknown, unknown>;
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
	/** The mutation's definition, to compare with yours. */
	readonly mutation: Mutation<never, unknown, unknown>;
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
	/** The mutation's definition, to compare with yours. */
	readonly mutation: Mutation<never, unknown, unknown>;
	/** What the mutation was called with. */
	readonly variables: unknown;
	/** How the run ended, after `retry`. */
	readonly exit: Exit.Exit<unknown, unknown>;
}

/**
 * Creates a {@link QueryClient}. Nothing is built until the client is first
 * used: then it builds `layer` once and keeps it until
 * {@link QueryClient.dispose}. Given a `runtime` instead, it uses the
 * runtime's services and builds none of its own ({@link RuntimeOptions}).
 *
 * @example
 * ```ts
 * import type * as Layer from "effect/Layer";
 * import * as ManagedRuntime from "effect/ManagedRuntime";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 *
 * export const queryClient = QueryClient.make({
 *   layer: AppLayer,
 *   queries: { defaults: { staleTime: "1 minute" } },
 * });
 *
 * // Or with the services of a runtime you already have.
 * const appRuntime = ManagedRuntime.make(AppLayer);
 * export const sharedClient = QueryClient.make({ runtime: appRuntime });
 * ```
 *
 * @see {@link layer} to create one in an Effect program
 *
 * @since 0.1.0
 */
export const make = (options: Options): QueryClient => {
	const appRuntime = options.runtime;
	const memoMap =
		appRuntime?.memoMap ?? options.memoMap ?? Layer.makeMemoMapUnsafe();
	// Read when it's needed: disposing a runtime replaces its `contextEffect`.
	const app =
		appRuntime === undefined
			? options.layer
			: Layer.effectContext(Effect.suspend(() => appRuntime.contextEffect));
	// `Reactivity.layer` is last so it wins over one in the app's services:
	// the runtime's atoms build the same layer with the same memo map, so
	// both see one instance.
	const services = Layer.mergeAll(
		Layer.orDie(app),
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
			context: runtime.contextEffect,
			memoMap,
			state,
			options,
		}),
	});
	observeNodes(registry, state);
	// Tracked so `dispose()` interrupts them along with fetches, as soon as
	// the registry is gone, rather than once the layer is released: in
	// between, a mutation run would reach the disposed registry.
	const tracked = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.withFiber((fiber) => {
			track(state, fiber);
			return effect;
		});
	const client: QueryClient = {
		registry,
		runPromise: (effect, runOptions) =>
			runtime.runPromise(tracked(effect), runOptions),
		runPromiseExit: (effect, runOptions) =>
			runtime.runPromiseExit(tracked(effect), runOptions),
		// Disposing the registry interrupts fetches without waiting for them,
		// so they're awaited before the layer they use is released.
		// `registry.dispose()` rethrows a finalizer's error: the rest still
		// runs, and the error becomes the rejection.
		dispose: () =>
			Effect.runPromise(
				Effect.sync(() => {
					state.disposed = true;
					registry.dispose();
				}).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							for (const settle of state.onDispose) {
								settle();
							}
						}),
					),
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
 * builds are built once. A client given `options.runtime` uses the runtime's
 * services instead.
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
			const client = make(
				options.runtime === undefined
					? { ...options, memoMap: options.memoMap ?? memoMap }
					: options,
			);
			return Effect.as(
				Scope.addFinalizer(
					scope,
					Effect.promise(() => client.dispose()),
				),
				Context.make(QueryClient, client),
			);
		}),
	);

/**
 * A client's cache as `dehydrate` sends it: Effect's `Hydration` format, so
 * a framework's serializer carries it as it carries any atom state. Its
 * values are JSON; a query still fetching carries a promise of its result,
 * which only streaming serializers (React's, TanStack Start's, React
 * Router's) can send.
 *
 * @example
 * ```ts
 * import { QueryClient } from "@monarcode/effetch-query";
 *
 * declare const client: QueryClient.QueryClient;
 *
 * export const state: QueryClient.DehydratedState = QueryClient.dehydrate(client);
 * export const html = `<script>window.__QUERY_STATE__ = ${JSON.stringify(state)}</script>`;
 * ```
 *
 * @since 0.1.0
 */
export type DehydratedState = ReadonlyArray<Hydration.DehydratedAtom>;

/**
 * Options for {@link dehydrate}.
 *
 * @example
 * ```ts
 * import type { QueryClient } from "@monarcode/effetch-query";
 *
 * // Stream the queries still loading, and send failures too.
 * export const options: QueryClient.DehydrateOptions = {
 *   queries: ["todos"],
 *   pending: "promise",
 *   failures: "include",
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface DehydrateOptions {
	/** Only the queries this matches, as `Query.invalidate` matches them. Default: every query. */
	readonly queries?: Query.Target | undefined;
	/**
	 * A query still fetching, with nothing to show yet: `"promise"` sends a
	 * promise of its result, for streaming server rendering, and the browser
	 * waits for it instead of fetching; `"omit"` leaves it out, and the
	 * browser fetches it. Default: `"omit"`.
	 */
	readonly pending?: "omit" | "promise" | undefined;
	/**
	 * A failed query: `"include"` sends it with its error, encoded with the
	 * query's `schema.error` (defects as `Schema.Defect`); `"omit"` leaves it
	 * out, so the browser fetches it again and server errors never reach the
	 * page. Default: `"omit"`.
	 */
	readonly failures?: "omit" | "include" | undefined;
}

/**
 * Reads a client's cache to send to the browser, for server rendering, as
 * TanStack's `dehydrate`. Load what the page needs first (`Query.prefetch`
 * through {@link QueryClient.runPromise}), then send the result with the
 * page and load it with {@link hydrate} (or `HydrationBoundary` from
 * `@monarcode/effetch-query/react`).
 *
 * Only queries with a `schema` are sent, encoded with it, timestamp
 * included, so a query stays fresh in the browser as long as it would on
 * the server. It reads without fetching: a stale query is sent as it is.
 * Values a schema can't encode are left out.
 *
 * Throws {@link NonJsonKeyError} for a key that isn't JSON, and
 * {@link DuplicateQueryKeyError} when two queries it sends have one key.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import * as Schema from "effect/Schema";
 *
 * import { Query, QueryClient } from "@monarcode/effetch-query";
 *
 * declare const client: QueryClient.QueryClient;
 *
 * const todos = Query.make({
 *   key: ["todos"],
 *   run: Effect.succeed(["Buy milk"]),
 *   schema: { success: Schema.Array(Schema.String) },
 * });
 *
 * export const render = async () => {
 *   await client.runPromise(Query.prefetch(todos));
 *   return QueryClient.dehydrate(client);
 * };
 * ```
 *
 * @see {@link hydrate} to load it in the browser
 *
 * @since 0.1.0
 */
export const dehydrate = (
	client: QueryClient,
	options?: DehydrateOptions | undefined,
): DehydratedState => hydration.dehydrate(client.registry, options);

/**
 * Loads a cache {@link dehydrate} sent into a client, as TanStack's
 * `hydrate`. A query that isn't cached shows its value the first time it's
 * read, without fetching, and refetches once it's stale. A cached query
 * takes it only if it's newer than the last data it has. A query the server
 * was still loading waits for its result instead of fetching.
 *
 * Values its schema can't decode are dropped, and the query fetches. State
 * from Effect's own `Hydration.dehydrate`, for other atoms, is loaded too.
 *
 * @example
 * ```ts
 * import { QueryClient } from "@monarcode/effetch-query";
 *
 * declare const client: QueryClient.QueryClient;
 * declare const window: { readonly __QUERY_STATE__: QueryClient.DehydratedState };
 *
 * QueryClient.hydrate(client, window.__QUERY_STATE__);
 * ```
 *
 * @see {@link dehydrate} to send it from the server
 *
 * @since 0.1.0
 */
export const hydrate = (
	client: QueryClient,
	state: Iterable<Hydration.DehydratedAtom>,
): void => hydration.hydrate(client.registry, state);

/**
 * Returns `response` with its body wrapped so that `client` is disposed once
 * the body has been sent: when it ends, fails, or the reader cancels it (a
 * client that disconnects). A response with no body disposes the client at
 * once. Use it for a client made per request on a server that answers with
 * a streamed `Response`, where the request's handler returns before its
 * streamed results are sent: React Router's middleware, Hono, `Bun.serve`,
 * `Deno.serve`.
 *
 * Send the response it returns: one that's discarded is never read, so the
 * client is never disposed. Only the status, status text and headers are
 * kept, not a runtime's own options (Cloudflare's `encodeBody`, say), and
 * the body goes out as a stream, so a fixed body loses the length the
 * runtime would have sent. A body already read or locked throws, after the
 * client is disposed. A failed {@link QueryClient.dispose} is logged with
 * `console.error`, not thrown.
 *
 * The core uses `ReadableStream` and `Response` only when this is called,
 * so it still loads where they don't exist, such as React Native.
 *
 * @example
 * ```ts
 * import type * as Layer from "effect/Layer";
 * import * as ManagedRuntime from "effect/ManagedRuntime";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 * declare const render: (client: QueryClient.QueryClient) => Promise<Response>;
 *
 * const appRuntime = ManagedRuntime.make(AppLayer);
 *
 * export const handle = async (): Promise<Response> => {
 *   const client = QueryClient.make({ runtime: appRuntime });
 *   return QueryClient.disposeAfter(client, await render(client));
 * };
 * ```
 *
 * @see {@link make} for the client
 * @see {@link dehydrate} to send its queries, still loading ones included
 *
 * @since 0.1.0
 */
export const disposeAfter: (
	client: QueryClient,
	response: Response,
) => Response = disposal.disposeAfter;
