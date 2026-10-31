import * as Duration from "effect/Duration";
import type * as Schedule from "effect/Schedule";

import type * as Query from "../Query.js";
import type * as QueryClient from "../QueryClient.js";

/**
 * The built-in defaults, used when neither the query (or mutation) nor the
 * client's `defaults` set an option. The public JSDoc quotes these values.
 */
export const queryDefaults = {
	staleTime: Duration.zero,
	gcTime: Duration.minutes(5),
	refetchOnMount: true,
	retryOnMount: true,
	refetchOnFocus: true,
	refetchOnReconnect: true,
} as const;

export const mutationDefaults = {
	concurrent: true,
} as const;

/** A query's settings: its own, else the client's defaults, else the built-in ones. */
export interface QuerySettings<E> {
	readonly staleTime: Duration.Duration;
	readonly retry: Schedule.Schedule<unknown, E> | undefined;
	readonly refetchOnMount: boolean;
	readonly retryOnMount: boolean;
	readonly refetchOnFocus: boolean;
	readonly refetchOnReconnect: boolean;
	readonly refetchInterval: Duration.Duration | undefined;
}

export const resolveQueryOptions = <E>(
	options: Query.Options<E>,
	defaults: QueryClient.QueryDefaults | undefined,
): QuerySettings<E> => {
	const refetchInterval = options.refetchInterval ?? defaults?.refetchInterval;
	return {
		staleTime: Duration.fromInputUnsafe(
			options.staleTime ?? defaults?.staleTime ?? queryDefaults.staleTime,
		),
		retry: options.retry ?? defaults?.retry,
		refetchOnMount:
			options.refetchOnMount ??
			defaults?.refetchOnMount ??
			queryDefaults.refetchOnMount,
		retryOnMount:
			options.retryOnMount ??
			defaults?.retryOnMount ??
			queryDefaults.retryOnMount,
		refetchOnFocus:
			options.refetchOnFocus ??
			defaults?.refetchOnFocus ??
			queryDefaults.refetchOnFocus,
		refetchOnReconnect:
			options.refetchOnReconnect ??
			defaults?.refetchOnReconnect ??
			queryDefaults.refetchOnReconnect,
		refetchInterval:
			refetchInterval === undefined
				? undefined
				: Duration.fromInputUnsafe(refetchInterval),
	};
};

/** A query's `gcTime`. It's set when the query is defined, so there's no client default. */
export const resolveGcTime = (
	options: Pick<Query.Options<never>, "gcTime">,
): Duration.Duration =>
	Duration.fromInputUnsafe(options.gcTime ?? queryDefaults.gcTime);
