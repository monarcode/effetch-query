# Changelog

All notable changes to `@monarcode/effetch-query`, newest first.

## Unreleased

The TanStack Router and Start integration, a Next.js App Router recipe,
and clients made from an existing `ManagedRuntime`. Phase 17 (React
Router) joins this release before it ships.

### Added

- `@monarcode/effetch-query/react/tanstack-router`: `connectQueryClient`,
  which connects a query client to a TanStack Router, and so to TanStack
  Start, where the router is made. On the server, the queries the loaders
  loaded go with the page, and queries started while rendering stream in
  as they start, those still loading as promises the browser waits for.
  The request's client is disposed when the request ends. In the browser,
  it all loads into the client before React hydrates, with no
  `HydrationBoundary`. A query or mutation that fails or dies with the
  router's `redirect()` navigates there, unless an Effect awaits the fetch:
  a loader's redirect is left to the router, and a preload's is dropped, as
  the router drops it. Options: `dehydrate` (`queries`, `failures`),
  `handleRedirects` and `wrapQueryClient`. `@tanstack/react-router`
  (`>=1.170.33 <2.0.0`) is an optional peer.
- `QueryClient.make({ runtime })` and `QueryClient.layer({ runtime })`: a
  client that uses the services of a `ManagedRuntime` you already have
  rather than building a layer. Every client of one runtime, such as one
  per request on a server, shares its build, and disposing a client leaves
  the runtime running. The clients share the runtime's `Reactivity`, so an
  invalidation by any of them, or by a service the runtime built, reaches
  all of them.
- `QueryClient.LayerOptions`, `QueryClient.RuntimeOptions` and
  `QueryClient.CommonOptions`: the two ways to give a client its services,
  and the options both take.
- The README's "TanStack Router and Start" guide, and
  `examples/tanstack-start`: a Start app with loaders, a streamed detail
  page and a redirect, built and served by its tests.
- The README's "Next.js" guide: the App Router with the core and
  `./react`, no integration package. Each request's client for server
  components comes from React's `cache()` and is disposed with Next's
  `after()`; client components get theirs from a `QueryProvider`.

### Changed

- `QueryClient.Options` is now a union, `LayerOptions | RuntimeOptions`,
  rather than an interface. Passing `runtime` with `layer` or `memoMap` is
  a compile error.
- The README's server rendering guide makes each request's client from a
  process-wide `ManagedRuntime`, so the app's layer is built once.
- `useSuspenseQuery` and `useSuspenseInfiniteQuery` throw an error with a
  string `digest`, such as what Next's `redirect()` and `notFound()`
  throw, as it is rather than in a `QueryFailure`, so the framework
  handles it.

### Fixed

- A query `hydrate` or `HydrationBoundary` loaded is no longer fetched
  again in the browser when React reads it while hydrating server HTML in
  slices: the value React's server snapshot showed was dropped before the
  query was subscribed to.
- `hydrate` and `HydrationBoundary` take a streamed result whose promise
  is a thenable whose `then` returns nothing, as React's RSC client hands
  over, rather than throwing.

## 0.1.0-alpha.3

Server rendering: send the cache with the page, and pick it up in the
browser without fetching again, streamed or not.

### Added

- A `schema` option on `Query.make` and `Query.family` (`success`, and
  `error` to send failures), and on `InfiniteQuery.make` and
  `InfiniteQuery.family` (`page`, `pageParam`, `error`). A query with a
  schema can cross from server to browser; its schema's type is its value
  type.
- `QueryClient.dehydrate(client, options)`: reads a client's cache to send
  with the page, without fetching. Values keep their timestamp, so a query
  is as fresh in the browser as it was on the server. `queries` sends only
  the queries a target matches, `pending: "promise"` sends a query still
  loading as a promise of its result, for streaming, and
  `failures: "include"` sends failed queries, which are left out by
  default.
- `QueryClient.hydrate(client, state)`: loads that state. A query that
  isn't cached shows its value when first read, a cached one takes it only
  if it's newer, and a query the server was still loading waits for its
  result instead of fetching. State from Effect's own `Hydration.dehydrate`
  loads too.
- `QueryClient.NonJsonKey` and `QueryClient.DuplicateQueryKey`: thrown by
  `dehydrate` for a key that isn't JSON, and for two cached queries with
  one key.
- `@monarcode/effetch-query/react`: `HydrationBoundary`, which loads a
  state into the provider's client so the first render matches the
  server's HTML.
- `@monarcode/effetch-query/effetch`: endpoint queries and infinite queries
  with an `output` cross with no schema to write. With
  `failures: "include"`, effetch's errors are sent too: an `HttpError`
  without its headers, but with its URL and response text.
- The README's "Server rendering" guide, and `examples/ssr`: a page
  rendered with a client per request and hydrated in the browser.

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
