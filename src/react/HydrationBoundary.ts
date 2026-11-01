"use client";

import type * as Hydration from "effect/reactivity/Hydration";

import * as React from "react";

import { hydrate, partition } from "../internal/dehydrate.js";
import { useRegistry } from "./QueryProvider.js";

/**
 * Props for {@link HydrationBoundary}.
 *
 * @example
 * ```ts
 * import type { QueryClient } from "@monarcode/effetch-query";
 * import type { HydrationBoundaryProps } from "@monarcode/effetch-query/react";
 *
 * declare const state: QueryClient.DehydratedState;
 *
 * export const props: HydrationBoundaryProps = { state };
 * ```
 *
 * @since 0.1.0
 */
export interface HydrationBoundaryProps {
	/** What `QueryClient.dehydrate` sent from the server. Nothing loads without it. */
	readonly state?: Iterable<Hydration.DehydratedAtom> | undefined;
	/** The tree that reads it. */
	readonly children?: React.ReactNode | undefined;
}

/**
 * Loads a cache `QueryClient.dehydrate` sent from the server into the
 * client of the nearest {@link QueryProvider}, as TanStack's
 * `HydrationBoundary`, so the tree below shows the server's data without
 * fetching it again.
 *
 * Values for queries that aren't cached load during render, so its children
 * read them in the same pass, the first render after server rendering
 * included. Values for queries already cached load after commit, so a
 * transition that brings new state doesn't change the page it leaves until
 * React shows the new one. Otherwise it loads as `QueryClient.hydrate`
 * does: a cached query takes only newer data, and a query the server was
 * still loading waits for its result.
 *
 * @example
 * ```tsx
 * import * as Effect from "effect/Effect";
 * import * as Schema from "effect/Schema";
 *
 * import { Query, QueryClient } from "@monarcode/effetch-query";
 * import {
 *   HydrationBoundary,
 *   QueryProvider,
 *   useSuspenseQuery,
 * } from "@monarcode/effetch-query/react";
 *
 * declare const queryClient: QueryClient.QueryClient;
 * declare const serverState: QueryClient.DehydratedState;
 *
 * const todos = Query.make({
 *   key: ["todos"],
 *   run: Effect.succeed(["Buy milk"]),
 *   schema: { success: Schema.Array(Schema.String) },
 *   staleTime: "1 minute",
 * });
 *
 * function Todos() {
 *   const { value } = useSuspenseQuery(todos);
 *   return <ul>{value.map((todo) => <li key={todo}>{todo}</li>)}</ul>;
 * }
 *
 * export const App = () => (
 *   <QueryProvider client={queryClient}>
 *     <HydrationBoundary state={serverState}>
 *       <Todos />
 *     </HydrationBoundary>
 *   </QueryProvider>
 * );
 * ```
 *
 * @since 0.1.0
 */
export const HydrationBoundary = ({
	state,
	children,
}: HydrationBoundaryProps): React.ReactElement => {
	const registry = useRegistry();
	// Loading what isn't cached only stores it until it's read, so it's safe
	// in render, and repeating it is harmless.
	const cached = React.useMemo(() => {
		if (state === undefined) {
			return undefined;
		}
		const entries = partition(registry, state);
		if (entries.fresh.length > 0) {
			hydrate(registry, entries.fresh);
		}
		return entries.cached.length > 0 ? entries.cached : undefined;
	}, [registry, state]);
	React.useEffect(
		function hydrateCachedQueries() {
			if (cached !== undefined) {
				hydrate(registry, cached);
			}
		},
		[registry, cached],
	);
	return React.createElement(React.Fragment, null, children);
};
