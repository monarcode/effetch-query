"use client";

import { RegistryContext } from "@effect/atom-react";
import * as Data from "effect/Data";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import * as React from "react";

import type * as QueryClient from "../QueryClient.js";

const ClientContext = React.createContext<QueryClient.QueryClient | null>(null);

/**
 * Props for {@link QueryProvider}.
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
	/** The tree that uses the client. */
	readonly children?: React.ReactNode | undefined;
}

/**
 * Makes a {@link QueryClient.QueryClient} available to the hooks below it. It
 * also provides the client's registry as `@effect/atom-react`'s
 * `RegistryContext`, so atom-react's own hooks (`useAtomValue` and the rest)
 * share the cache. The hooks of `@monarcode/effetch-query/react` throw a
 * {@link MissingQueryProvider} outside one.
 *
 * @example
 * ```ts
 * import type * as Layer from "effect/Layer";
 * import * as React from "react";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 * import { QueryProvider } from "@monarcode/effetch-query/react";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 * declare const App: React.FC;
 *
 * const queryClient = QueryClient.make({ layer: AppLayer });
 *
 * export const Root = () =>
 *   React.createElement(
 *     QueryProvider,
 *     { client: queryClient },
 *     React.createElement(App),
 *   );
 * ```
 *
 * @since 0.1.0
 */
export const QueryProvider = ({
	client,
	children,
}: QueryProviderProps): React.ReactElement =>
	React.createElement(
		ClientContext.Provider,
		{ value: client },
		React.createElement(
			RegistryContext.Provider,
			{ value: client.registry },
			children,
		),
	);

/**
 * Thrown by {@link useQueryClient} and the other hooks of
 * `@monarcode/effetch-query/react` outside a {@link QueryProvider}.
 *
 * @example
 * ```ts
 * import { MissingQueryProvider } from "@monarcode/effetch-query/react";
 *
 * export const isMissingProvider = (error: unknown) =>
 *   error instanceof MissingQueryProvider;
 * ```
 *
 * @since 0.1.0
 */
export class MissingQueryProvider extends Data.TaggedError(
	"MissingQueryProvider",
)<{ readonly message: string }> {}

/**
 * Returns the {@link QueryClient.QueryClient} of the nearest
 * {@link QueryProvider}, for running Effects from event handlers. Throws a
 * {@link MissingQueryProvider} outside one.
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
		throw new MissingQueryProvider({
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
