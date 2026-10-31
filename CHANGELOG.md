# Changelog

All notable changes to `@monarcode/effetch-query`, newest first.

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
