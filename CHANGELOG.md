# Changelog

All notable changes to `@monarcode/effetch-query`, newest first.

## 0.1.0-alpha.2

Infinite queries, and `Query.update` across a family.

### Added

- `InfiniteQuery.make` and `InfiniteQuery.family`: paged queries whose
  value is an `InfiniteData` (`pages` and `pageParams`), from
  `initialPageParam`, `nextPageParam`, an optional `previousPageParam`, and
  `maxPages`. An infinite query is a query, so `Query.get`, `Query.set`,
  `Query.update`, `Query.invalidate` and the rest work on it. A refetch
  fetches as many pages as are loaded, each from the page before it, as
  TanStack v5 does.
- `InfiniteQuery.fetchNextPage` and `InfiniteQuery.fetchPreviousPage`: fetch
  one page at either end. A failed page keeps the loaded pages, and a write
  made while a page loads stays.
- `@monarcode/effetch-query/react`: `useInfiniteQuery` and
  `useSuspenseInfiniteQuery`, with `fetchNextPage`, `fetchPreviousPage`,
  `hasNextPage`, `hasPreviousPage`, `isFetchingNextPage` and
  `isFetchingPreviousPage`, for "load more" buttons and infinite scroll
  (`onEndReached` in React Native).
- `@monarcode/effetch-query/effetch`: `api.infiniteQuery(endpoint, {
  pageParam, ... })`. `pageParam` names the query field each page's param
  is sent in; it's left out of the key.
- `Query.update` takes a family: it writes every cached member, with its
  argument, as TanStack's `setQueriesData` does. In a mutation's
  `optimistic`, a failed run puts each member back.

### Fixed

- `Query.fetch` no longer fetches twice when a query that was invalidated
  while unused settles at once.

## 0.1.0-alpha.1

The first release from the Release workflow. The package's code is the same
as `0.1.0-alpha.0`.

### Changed

- Published from GitHub Actions with npm trusted publishing, so this and
  every later version carries a provenance statement linking it to its
  source commit and build.

## 0.1.0-alpha.0

The first release: TanStack-Query-style server state for Effect 4, built on
`effect/reactivity` and `@effect/atom-react`.

### Added

- `QueryClient.make` and `QueryClient.layer`: a client per app (or per
  server request) with its own cache, built from the layer that provides the
  services you register in `Register`. A query that needs an unregistered
  service is a compile error. Options for every query and mutation
  (`queries.defaults`, `mutations.defaults`) and app-wide hooks
  (`onSuccess`, `onFailure`, `onSettled`, `onMutate`). `memoMap` shares
  layer builds with your `ManagedRuntime`.
- `Query.make` and `Query.family`: cached queries from any Effect, with
  hierarchical keys, `staleTime`, `gcTime`, `retry` (a `Schedule`, none by
  default), `refetchInterval`, and refetching on mount, on focus and on
  reconnect. A query's `run` can read other queries.
- The cache from Effect: `Query.fetch`, `Query.prefetch`, `Query.get`,
  `Query.set`, `Query.update`, `Query.invalidate`, `Query.refetch` and
  `Query.reset`. Targets are a query, a family, or a key prefix.
- `Mutation.make` and `Mutation.run`: changes with `optimistic` cache writes
  that are undone if the run fails, `onSuccess`, `onFailure`, `onSettled`,
  `invalidates`, `retry` and `concurrent`.
- `Signals.browser` (the default) and `Signals.none` for focus and
  reconnect.
- `@monarcode/effetch-query/react`: `QueryProvider`, `useQuery` (with
  `keepPrevious`, and `null` for no query), `useSuspenseQuery`,
  `useMutation`, `useRefetch`, `useQueryClient`, `useResetQueryFailure`,
  and `QueryFailure` for error boundaries.
- `@monarcode/effetch-query/react-native`: `reactNativeSignals`, from
  `AppState` and NetInfo, which it takes as arguments.
- `@monarcode/effetch-query/effetch`: `endpoints`, which turns effetch
  endpoint definitions into queries keyed by their route and mutations,
  with errors typed from the endpoint and the client's plugins.
