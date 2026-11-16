"use client";

import type * as Cause from "effect/Cause";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import * as React from "react";

import { onRecovered, resetQueryFailure } from "../internal/suspense.js";
import { QueryFailure } from "../QueryFailure.js";
import { useRegistry } from "./QueryProvider.js";

/**
 * What {@link QueryBoundaryProps.failure} is called with: the failure a
 * query below the boundary threw, and a way to try again.
 *
 * @example
 * ```ts
 * import type { QueryBoundaryFailureProps } from "@monarcode/effetch-query/react";
 *
 * export const message = ({ error }: QueryBoundaryFailureProps): string =>
 *   error instanceof Error ? error.message : String(error);
 * ```
 *
 * @since 0.1.0
 */
export interface QueryBoundaryFailureProps {
	/**
	 * The failure squashed to one value (`Cause.squash`), for display: the
	 * query's error, or the defect it died with.
	 */
	readonly error: unknown;
	/** Why the query failed: its error, a defect, or an interruption. */
	readonly cause: Cause.Cause<unknown>;
	/**
	 * Refetches the failed query and renders the children again, which show
	 * `pending` while the refetch runs. Only that query: another failed query
	 * below throws again.
	 */
	readonly retry: () => void;
}

/**
 * Props for {@link QueryBoundary}.
 *
 * @example
 * ```ts
 * import type { QueryBoundaryProps } from "@monarcode/effetch-query/react";
 *
 * export const props: QueryBoundaryProps = {
 *   pending: "Loading…",
 *   failure: ({ retry }) => "Something went wrong",
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface QueryBoundaryProps {
	/**
	 * What to show while a query below suspends: the `Suspense` fallback.
	 * Default: nothing.
	 */
	readonly pending?: React.ReactNode | undefined;
	/**
	 * Renders what to show when a query below fails with nothing to show,
	 * such as an error message and a "Try again" button that calls `retry`.
	 * Called only for a `QueryFailure`; any other error goes on to the next
	 * error boundary up.
	 */
	readonly failure: (props: QueryBoundaryFailureProps) => React.ReactNode;
	/** The tree that reads queries, with `useSuspenseQuery` for example. */
	readonly children?: React.ReactNode | undefined;
}

interface CatchProps {
	readonly registry: AtomRegistry.AtomRegistry;
	readonly failure: QueryBoundaryProps["failure"];
	readonly children?: React.ReactNode | undefined;
}

interface CatchState {
	readonly caught: { readonly error: unknown } | undefined;
}

class Catch extends React.Component<CatchProps, CatchState> {
	override state: CatchState = { caught: undefined };

	static getDerivedStateFromError(error: unknown): CatchState {
		return { caught: { error } };
	}

	private watching:
		| { readonly error: unknown; readonly stop: () => void }
		| undefined;

	readonly retry = (): void => {
		resetQueryFailure(this.props.registry, this.state.caught?.error);
		this.setState({ caught: undefined });
	};

	override componentDidMount(): void {
		this.watch();
	}

	override componentDidUpdate(): void {
		this.watch();
	}

	private watch(): void {
		const error = this.state.caught?.error;
		if (this.watching?.error === error) {
			return;
		}
		this.watching?.stop();
		this.watching =
			error === undefined
				? undefined
				: {
						error,
						stop: onRecovered(this.props.registry, error, () =>
							this.setState({ caught: undefined }),
						),
					};
	}

	override componentWillUnmount(): void {
		this.watching?.stop();
		this.watching = undefined;
	}

	override render(): React.ReactNode {
		const caught = this.state.caught;
		if (caught === undefined) {
			return this.props.children;
		}
		if (!QueryFailure.is(caught.error)) {
			// Thrown from this boundary's render, it reaches the next one up.
			throw caught.error;
		}
		return this.props.failure({
			error: caught.error.error,
			cause: caught.error.cause,
			retry: this.retry,
		});
	}
}

/**
 * Shows `pending` while the queries below suspend, and `failure` when one of
 * them fails with nothing to show: a `Suspense` boundary inside an error
 * boundary that catches only `QueryFailure`s. Its `retry` refetches the
 * failed query and renders the children again. Any other error goes on to
 * the next error boundary up.
 *
 * It shows `failure` until `retry` is called or the failed query succeeds
 * some other way, such as a refetch on reconnect: while it shows, the query
 * stays in use. `retry` refetches only the query that failed, so give each
 * part of a screen that can fail on its own a boundary of its own. To show
 * other content after a failure, such as the next item, give it a `key`
 * (`key={id}`), so React makes a new boundary.
 *
 * Use it around components that read with {@link useSuspenseQuery} or
 * {@link useSuspenseInfiniteQuery}. Where a router owns the error boundary
 * (an `errorComponent` or an `ErrorBoundary` route export), use
 * {@link useResetQueryFailure} there instead. In a server render it shows
 * `pending` for what suspends, as `Suspense` does. Throws a
 * `MissingQueryProviderError` outside a `QueryProvider`.
 *
 * @example
 * ```tsx
 * import * as Effect from "effect/Effect";
 *
 * import { Query } from "@monarcode/effetch-query";
 * import { QueryBoundary, useSuspenseQuery } from "@monarcode/effetch-query/react";
 *
 * const todo = Query.family({
 *   key: ["todos", "detail"],
 *   run: (id: number) => Effect.succeed({ id, title: "Buy milk" }),
 * });
 *
 * function TodoTitle({ id }: { readonly id: number }) {
 *   return <h1>{useSuspenseQuery(todo(id)).value.title}</h1>;
 * }
 *
 * export function TodoScreen({ id }: { readonly id: number }) {
 *   return (
 *     <QueryBoundary
 *       key={id}
 *       pending={<p>Loading…</p>}
 *       failure={({ error, retry }) => (
 *         <button onClick={retry}>{String(error)}: try again</button>
 *       )}
 *     >
 *       <TodoTitle id={id} />
 *     </QueryBoundary>
 *   );
 * }
 * ```
 *
 * @since 0.1.0
 */
export const QueryBoundary = ({
	pending,
	failure,
	children,
}: QueryBoundaryProps): React.ReactNode =>
	React.createElement(
		Catch,
		{ registry: useRegistry(), failure },
		React.createElement(React.Suspense, { fallback: pending }, children),
	);
