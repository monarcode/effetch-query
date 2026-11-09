"use client";

import { RegistryContext } from "@effect/atom-react";
import * as Data from "effect/Data";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import * as React from "react";

import { disposeInBackground } from "../internal/disposeAfter.js";
import type * as QueryClient from "../QueryClient.js";

const ClientContext = React.createContext<QueryClient.QueryClient | null>(null);
const HydrateSinceContext = React.createContext<number | undefined>(undefined);

/**
 * Props for {@link QueryProvider} with a client you own: the provider uses
 * it and never disposes it. For a client the provider makes and disposes,
 * see {@link OwnedQueryProviderProps}.
 *
 * @example
 * ```ts
 * import type * as Layer from "effect/Layer";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 * import type { QueryProviderProps } from "@monarcode/effetch-query/react";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 *
 * export const props: QueryProviderProps = {
 *   client: QueryClient.make({ layer: AppLayer }),
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface QueryProviderProps {
	/** The client the hooks below use. The provider doesn't dispose it. */
	readonly client: QueryClient.QueryClient;
	/** Only with an owned client: {@link OwnedQueryProviderProps.make}. */
	readonly make?: undefined;
	/** Only with an owned client: {@link OwnedQueryProviderProps.resetKey}. */
	readonly resetKey?: undefined;
	/** The tree that uses the client. */
	readonly children?: React.ReactNode | undefined;
}

/**
 * Props for {@link QueryProvider} with a client the provider owns: it makes
 * one with `make`, a new one each time `resetKey` changes, and disposes each
 * when it's replaced or the provider unmounts. Pass the signed-in account's
 * ID as `resetKey`, so no account sees another's cache.
 *
 * For the browser and React Native only. Effects don't run in server
 * rendering, so a client made there would never be disposed: on the server,
 * give {@link QueryProviderProps.client} a client per request, and dispose
 * it when the response is done (`QueryClient.disposeAfter`). Put it above
 * every `Suspense` boundary: a first render React discards before it shows
 * anything leaves the client it made undisposed.
 *
 * @example
 * ```ts
 * import type * as Layer from "effect/Layer";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 * import type { OwnedQueryProviderProps } from "@monarcode/effetch-query/react";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 * declare const accountId: string;
 *
 * export const props: OwnedQueryProviderProps = {
 *   make: () => QueryClient.make({ layer: AppLayer }),
 *   resetKey: accountId,
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface OwnedQueryProviderProps {
	/**
	 * Makes the client, on the first render and again when `resetKey`
	 * changes. A new function on each render doesn't make a new client, so
	 * an inline arrow is fine.
	 */
	readonly make: () => QueryClient.QueryClient;
	/**
	 * Changing it replaces the client with a new one from `make`, and
	 * disposes the old one: its cache goes, and its fetches and mutation runs
	 * are interrupted. The tree below never renders with the old client
	 * again. A `HydrationBoundary` below loads into the new client only
	 * what the server dehydrated after the change (by its clock), so state
	 * the previous account's page sent doesn't reach the new account.
	 */
	readonly resetKey?: string | undefined;
	/** Only with a client you own: {@link QueryProviderProps.client}. */
	readonly client?: undefined;
	/** The tree that uses the client. */
	readonly children?: React.ReactNode | undefined;
}

/**
 * Makes a {@link QueryClient.QueryClient} available to the hooks below it. It
 * also provides the client's registry as `@effect/atom-react`'s
 * `RegistryContext`, so atom-react's own hooks (`useAtomValue` and the rest)
 * share the cache. The hooks of `@monarcode/effetch-query/react` throw a
 * {@link MissingQueryProviderError} outside one.
 *
 * Give it a `client` you own ({@link QueryProviderProps}), or a `make` it
 * calls to own one, made again for each `resetKey`
 * ({@link OwnedQueryProviderProps}): a sign-out or an account switch then
 * drops the previous account's cache. A mounted provider can switch between
 * the two forms: the owned client is disposed when a `client` replaces it.
 *
 * @example
 * ```tsx
 * import type * as Layer from "effect/Layer";
 * import type * as React from "react";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 * import { QueryProvider } from "@monarcode/effetch-query/react";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 * declare const App: React.FC;
 *
 * // A client you own, which the provider never disposes.
 * const queryClient = QueryClient.make({ layer: AppLayer });
 *
 * export const Root = () => (
 *   <QueryProvider client={queryClient}>
 *     <App />
 *   </QueryProvider>
 * );
 * ```
 *
 * @example
 * ```tsx
 * import type * as Layer from "effect/Layer";
 * import type * as React from "react";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 * import { QueryProvider } from "@monarcode/effetch-query/react";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 * declare function useAccountId(): string; // e.g. the signed-in user's ID
 *
 * // A client per account: a new one, and the old one disposed, when the
 * // account changes.
 * export function Providers({ children }: { readonly children: React.ReactNode }) {
 *   const accountId = useAccountId();
 *   return (
 *     <QueryProvider
 *       make={() => QueryClient.make({ layer: AppLayer })}
 *       resetKey={accountId}
 *     >
 *       {children}
 *     </QueryProvider>
 *   );
 * }
 * ```
 *
 * @since 0.1.0
 */
export const QueryProvider = (
	props: QueryProviderProps | OwnedQueryProviderProps,
): React.ReactElement => {
	const owned = useOwnedClient(props.make, props.resetKey);
	const client = owned?.client ?? props.client;
	return React.createElement(
		ClientContext.Provider,
		{ value: client ?? null },
		client === undefined
			? props.children
			: React.createElement(
					HydrateSinceContext.Provider,
					{ value: owned?.hydrateSince },
					React.createElement(
						RegistryContext.Provider,
						{ value: client.registry },
						props.children,
					),
				),
	);
};

interface OwnedClient {
	readonly client: QueryClient.QueryClient;
	readonly resetKey: string | undefined;
	/**
	 * When it replaced another, if it did: server state dehydrated before
	 * then belongs to the previous key.
	 */
	readonly hydrateSince: number | undefined;
}

const useOwnedClient = (
	make: (() => QueryClient.QueryClient) | undefined,
	resetKey: string | undefined,
): OwnedClient | undefined => {
	// React can render without committing (StrictMode's second render, an
	// abandoned transition), so every client made is kept here until it's
	// disposed, and a commit disposes the ones it didn't use.
	const madeRef = React.useRef<Set<QueryClient.QueryClient>>(null);
	const made = (madeRef.current ??= new Set());
	const count = React.useRef(0);
	const create = (makeClient: () => QueryClient.QueryClient): OwnedClient => {
		const client = makeClient();
		made.add(client);
		return {
			client,
			resetKey,
			hydrateSince: count.current++ > 0 ? Date.now() : undefined,
		};
	};
	// A ref rather than a state initializer, which StrictMode calls twice.
	const initial = React.useRef<OwnedClient | null | undefined>(undefined);
	initial.current ??= make === undefined ? null : create(make);
	const [owned, setOwned] = React.useState(initial.current ?? undefined);
	let current = owned;
	if (
		make === undefined
			? owned !== undefined
			: owned === undefined || owned.resetKey !== resetKey
	) {
		current = make === undefined ? undefined : create(make);
		setOwned(current);
	}

	const committed = React.useRef<QueryClient.QueryClient | undefined>(
		undefined,
	);
	React.useEffect(
		function disposeReplacedClients() {
			const releaseAllBut = (kept: QueryClient.QueryClient | undefined) => {
				for (const client of made) {
					if (client !== kept && made.delete(client)) {
						disposeInBackground(
							client,
							"the QueryProvider's query client",
						);
					}
				}
			};
			committed.current = owned?.client;
			releaseAllBut(owned?.client);
			if (owned === undefined) {
				return;
			}
			// On unmount, deferred, and skipped if the provider mounts again,
			// as StrictMode's mount, unmount, mount does. A replacement's own
			// commit has already released this client.
			return function disposeWhenReleased() {
				committed.current = undefined;
				setTimeout(function disposeUnlessRemounted() {
					if (committed.current === undefined) {
						releaseAllBut(undefined);
					}
				}, 0);
			};
		},
		[owned],
	);
	return current;
};

/**
 * Thrown by {@link useQueryClient} and the other hooks of
 * `@monarcode/effetch-query/react` outside a {@link QueryProvider}.
 *
 * @example
 * ```ts
 * import { MissingQueryProviderError } from "@monarcode/effetch-query/react";
 *
 * export const isMissingProvider = (error: unknown) =>
 *   error instanceof MissingQueryProviderError;
 * ```
 *
 * @since 0.1.0
 */
export class MissingQueryProviderError extends Data.TaggedError(
	"MissingQueryProviderError",
)<{ readonly message: string }> {}

/**
 * Returns the {@link QueryClient.QueryClient} of the nearest
 * {@link QueryProvider}, for running Effects from event handlers. Throws a
 * {@link MissingQueryProviderError} outside one.
 *
 * @example
 * ```ts
 * import { Query } from "@monarcode/effetch-query";
 * import { useQueryClient } from "@monarcode/effetch-query/react";
 *
 * export const useSignOut = () => {
 *   const client = useQueryClient();
 *   return () => client.runPromise(Query.reset(["session"]));
 * };
 * ```
 *
 * @since 0.1.0
 */
export const useQueryClient = (): QueryClient.QueryClient => {
	const client = React.useContext(ClientContext);
	if (client === null) {
		throw new MissingQueryProviderError({
			message:
				"No QueryClient: a hook from @monarcode/effetch-query/react was called outside a <QueryProvider client={queryClient}>.",
		});
	}
	return client;
};

/**
 * The registry the hooks use: atom-react's, which `useAtomValue` reads too,
 * once a {@link QueryProvider} is known to be above. Without one, atom-react
 * would fall back to its own module-level registry, which no client made.
 *
 * @internal
 */
export const useRegistry = (): AtomRegistry.AtomRegistry => {
	useQueryClient();
	return React.useContext(RegistryContext);
};

/**
 * From when a `HydrationBoundary` may load server state into the nearest
 * provider's client: for a client an owned provider made to replace
 * another, only state dehydrated after it, since what came before belongs
 * to the previous key. `undefined` for any state.
 *
 * @internal
 */
export const useHydrateSince = (): number | undefined =>
	React.useContext(HydrateSinceContext);
