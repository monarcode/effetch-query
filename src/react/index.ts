"use client";

export {
	type InfinitePageControls,
	useInfiniteQuery,
	type UseInfiniteQueryResult,
	useMutation,
	type UseMutationResult,
	useQuery,
	type UseQueryOptions,
	useRefetch,
	type UseRefetchResult,
	useResetQueryFailure,
	useSuspenseInfiniteQuery,
	type UseSuspenseInfiniteQueryResult,
	useSuspenseQuery,
} from "./hooks.js";
export {
	HydrationBoundary,
	type HydrationBoundaryProps,
} from "./HydrationBoundary.js";
export {
	MissingQueryProvider,
	QueryProvider,
	type QueryProviderProps,
	useQueryClient,
} from "./QueryProvider.js";
export { QueryFailure } from "../QueryFailure.js";
