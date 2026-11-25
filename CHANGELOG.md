# Changelog

All notable changes to `@monarcode/effetch-query`, newest first.

## Unreleased

### Added

- A documentation site at https://effetch-query.pages.dev, built from
  `site/` (Fumadocs on TanStack Start, prerendered to static files). Every
  guide moved there from the README, one page per task, with search. The
  docs check compiles the pages' examples too, and CI builds the site.
  Every example has type hovers, and the API reference, a page per
  namespace and entry point, is generated from the JSDoc.

### Changed

- The README is now an overview: the pitch, install, a quick start and
  links to the site's guides. `homepage` in `package.json` points to the
  site.

## 0.1.0-rc.5

Additive: opt-in entity sync, two exported errors, named types for
`api.query`, and namespace docs in editor hovers. It works with
`@monarcode/effetch` 0.1.0-rc.4 and later in 0.1, as rc.4 does. One fix
can surface in your app: `useRefetch` with a key that holds a query now
throws `Query.KeyHoldsTargetError` instead of doing nothing (see Fixed).

### Added

- `Query.KeyHoldsTargetError` and, from `@monarcode/effetch-query/effetch`,
  `EndpointQueryError` are exported, so you can check for them with
  `instanceof` and name their types. They were thrown before, but only
  their `_tag` could be matched. Their tags and messages are unchanged,
  and their fields (`key`; `route` and `cause`) are documented.
- Named types for what `api.query` takes and gives:
  `EndpointQueryValue`, `EndpointQueryCallError` and
  `EndpointQueryOptionsFor`. `api.query`'s declaration uses them in place
  of inline conditional types, so Go to Definition and its hover read
  more simply. The types they resolve to, at each call, are unchanged.
- `api.query`, `api.infiniteQuery` and `api.mutation` have examples in
  their hovers.
- Entity sync: `QueryClient.make({ entities: { sync: [Todos] } })` keeps
  the cached copies of those entities in sync. When a query's fetch
  succeeds, each copy in its value goes over the older copies with the
  same id in every other query that holds the entity, so a details
  refetch updates the list rows, and a list fetch updates the cached
  details, with no other fetch. The newer copy wins, by when its fetch
  started (each page's own request, for an infinite query's refetch), and
  loading the next page sends only that page. A write counts as newer
  than fetches in flight, but only fetched copies are synced to other
  queries. A query opts out with
  `entities: { sync: false }` (`Query.EntitiesOptions`). See "Keep copies
  in sync" in the README.
- The README explains decoding an endpoint's own response shape to an
  entity's schema ("Responses in other shapes"), and what server
  rendering needs from a schema that transforms ("Schemas that
  transform"): a query whose schema can't encode its value is left out
  of `dehydrate` with no error, and the browser fetches it again.

### Fixed

- `useRefetch` with a key that holds a query, a family or a group, such as
  `useRefetch([todos, profile])`, now throws `Query.KeyHoldsTargetError` as
  it renders, as the README said it fails. Before, its `refetch` did
  nothing and the error was lost. Pass a `Query.group` instead.

### Changed

- Hovers on the core namespaces (`Entity`, `InfiniteQuery`, `Mutation`,
  `Query`, `QueryClient` and `Signals`) show their docs. Before, a hover
  showed only the module's path, such as
  `(alias) module ".../dist/Query"`. A member's hover now reads
  `(alias) const Query.make: …`, with its docs as before. Go to Definition
  on a namespace lands on `index.d.ts`; on a member, it still lands on the
  member's own declaration. Completions after `Query.` list each member as
  an alias, as Effetch's `Fetch.` does.
- Developed and tested against `effect` 4.1.5 (and `@effect/atom-react`
  4.1.5). The peer ranges are unchanged.

## 0.1.0-rc.4

Released alongside `@monarcode/effetch` 0.1.0-rc.4, which it needs: upgrade
both together. Effetch Query's own API is unchanged.

### Changed

- **Breaking for Effetch's import:** the `@monarcode/effetch` peer range is
  now `>=0.1.0-rc.4 <0.2.0`. Effetch rc.4's main entry exports only the
  `Fetch` namespace, and Effetch Query imports it that way, so it doesn't
  work with Effetch rc.3. The other way round fails too: Effetch Query
  rc.3 and earlier, whose range allows Effetch rc.4, throw from
  `fromClient` with it. Upgrade both together. In your own code, change
  each import:

  ```ts
  // Before
  import * as Fetch from "@monarcode/effetch";
  // After
  import { Fetch } from "@monarcode/effetch";
  ```

  `pnpm exec effetch-migrate` (or `npx -p @monarcode/effetch
  effetch-migrate`) rewrites them for you; run it with `--dry-run` first.
  Imports from `@monarcode/effetch-query` and its subpaths stay the same.

- The README, the JSDoc examples and every example app import
  `{ Fetch }`. The README's "Define a mutation" shows uploading a file
  with Effetch's new `Fetch.multipart` and `Fetch.UploadFile`:
  `api.mutation` sends such an endpoint's body as `multipart/form-data`,
  with `body` typed by the schema, and needed no change for it.

## 0.1.0-rc.3

Released alongside `@monarcode/effetch` 0.1.0-rc.3, which it needs: upgrade
both together. Additions agreed as exceptions to the API freeze, as the rc.1
and rc.2 additions were.

### Added

- `fromClient` in `@monarcode/effetch-query/effetch`: the new name of
  `endpoints`, which works the same. It says what it takes, your Effetch
  client, and no longer reads like Effetch's `Fetch.endpoint` and
  `Fetch.Endpoints`.
- Live queries, which a server keeps current while they're read:
  - `Query.stream({ key, run })` and `Query.streamFamily`: the value is a
    `Stream`'s latest element, such as a price feed over a WebSocket.
    `Query.fetch` returns the first element; `retry` resubscribes after a
    failure; `refetch`, `invalidate` and `reset` subscribe again.
  - `live` on `Query.make`, `Query.family` and `api.query`: a `Stream` of
    updates, each applied to the fetched value as it arrives. A push keeps
    the value's age, and is applied again to a fetch that was running and
    after an optimistic write is undone, so make updates idempotent.
  - `api.query` takes Effetch stream endpoints (`stream: "sse"` or
    `"ndjson"`) as stream queries keyed by route, holding each
    `Fetch.SseEvent` or NDJSON value; `EndpointStreamOptions` types their
    options.

  The stream runs only while the query is read, and stops about a second
  after the last reader leaves; the value stays cached for `gcTime`.

- `Entity`: one record held by many queries, written everywhere it's
  cached. `Entity.make(Todo, { id })` says once what identifies a todo;
  `Entity.update(Todos, id, f)`, `Entity.set(Todos, todo)` and
  `Entity.remove(Todos, id)` write every cached query whose schema holds
  it (an endpoint's `output`, or a query's `schema`), recorded like
  `Query.update`, so a failed mutation undoes them, and keep each query's
  age, so they make none fresh; a query showing a failure is left to its
  refetch. A `Schema.Class` entity keeps its class when the updater returns
  a plain copy. `Entity.get(Todos, id)` reads the newest
  copy, for a `placeholder`. Nothing is normalized, and a query without a
  schema is skipped.
- `select` on `useQuery`, `useSuspenseQuery` and `useQueryState`: derive
  what a component shows from a query's value, such as a count or one
  field. The component doesn't re-render for changes the selection doesn't
  show, and the query still refetches on mount and focus, which a derived
  atom read with `useAtomValue` doesn't.
- `useQueryState(query, options?)`: reads a query as `useQuery` does and
  returns an object with `status`, `data`, `error`, `cause`, `isPending`,
  `isSuccess`, `isFailure`, `isFetching`, `isPlaceholder`, `refetch` and
  `result`. Checking `status` narrows `data` and `error`.
- `QueryBoundary`: shows `pending` while the queries inside suspend, and
  `failure({ error, cause, retry })` when one throws a `QueryFailure`,
  until `retry` or until the query succeeds. Other errors go on to the next
  error boundary.
- `placeholder` on `api.query`, `Query.make` and `Query.family`: a value
  to show, as a waiting `Success`, until the first fetch settles, such as a
  list's copy of an item. On `api.query`, it gets the call's `params` and
  `query`. It's never cached, fetched, updated or sent, a query reading
  this one through `ctx.result` waits for the real value, and a server
  render doesn't show it. `useQueryState`'s `isPlaceholder` is true while
  it shows, and while `keepPrevious` shows the previous query's value.
- `useQueries(queries, options?)` reads a list of queries whose length can
  change, and returns their results in order: a tuple for a tuple, an
  array for an array. Combine them with `AsyncResult.all`.
- `paused` on `useQuery`, `useQueryState`, `useInfiniteQuery` and
  `useQueries`: the hook keeps showing what it had and doesn't count as a
  use, so invalidation, focus and polling don't refetch for it. What it
  shows isn't `waiting`, and a `clear` replaces it with what the cache has.
  When it resumes, the query refetches if it's stale. For screens a
  navigator keeps mounted.
- `Query.clear(target)` and `client.clear()` drop values without
  fetching, for signing out: the screens still mounted don't refetch with
  no session, and values `hydrate` left for queries not yet read are
  dropped too. Queries in use show `Initial` until something asks for them
  (a component that starts using one, `fetch`, `invalidate` or
  `refetch`). A query that reads a cleared one through `ctx.result` is
  cleared too. A `fetch` waiting on a cleared query is interrupted and a
  `refetch` resolves, and a mutation's optimistic write made before the
  clear isn't rolled back over it, and `useResetQueryFailure` fetches a
  cleared query again. `Query.reset` still fetches again at once.
- The client has the cache functions as methods, for code outside Effect
  such as router loaders and event handlers. Each does what its `Query`
  function does:
  - `client.fetch(query)` returns `Promise<A>`, rejected as the query
    fails, so a router's redirect still gets through. It replaces
    `client.runPromise(Query.fetch(query))`.
  - `client.prefetch(query)` never rejects: `void client.prefetch(query)`
    replaces `void client.runPromiseExit(Query.prefetch(query))`.
  - `client.invalidate`, `refetch`, `reset` and `clear` take a target, or
    none for every query.
- `QueryClient.make()` and `QueryClient.layer()` take no options when
  `Register` declares no services (`QueryClient.OptionalOptions`).
- `useMutation` returns `variables`: the variables of the run `result`
  shows, `undefined` before the first run and after `reset`. Render the
  change a run is making from them, without touching the cache.
- `useMutationState(mutation)` lists a mutation's runs in progress on the
  client, oldest first, with their variables, whichever component or
  `Mutation.run` started them.
- `concurrent` takes `"queue"` and `"drop"` as well as `true` and `false`.
  With `"queue"`, one `useMutation`'s runs go one at a time, in order; a
  queued run counts as in progress, and its `optimistic` runs when it
  starts. With `"drop"`, a run started while the one `useMutation` shows is
  in progress is ignored, and its `run` resolves at once with an
  interrupted `Exit`.
- `useIsFetching(target?)` and `useIsMutating(mutation?)` count the queries
  fetching and the mutation runs in progress, for an app-wide progress
  bar. A server render, and the first render as the page hydrates, count
  none.
- `fromClient(Api)` reads `defaultError` and `statusErrors` from a
  `Fetch.Service` class (Effetch `0.1.0-rc.3`), so the client's errors
  reach the browser in server rendering without naming them twice. A client
  behind a `Context.Service` key works as before, with the options, and
  options still replace the class's. `Fetch.Endpoints` definitions work with
  `api.query` and `api.mutation`.
- `api.query`, `api.infiniteQuery` and `api.mutation` take endpoints with
  a `query` schema (Effetch `0.1.0-rc.3`), with `query` typed by the
  schema. A query is keyed by its query as sent, each value encoded to a
  string (a `Date` as its ISO string), so equal requests share a query and
  the key goes to the browser as JSON. A query that doesn't match the
  schema, or has a `Redacted` field, throws an `EndpointQueryError`. An
  infinite query's `pageParam` names an optional field of the schema.
- `fromClient(Api, { invalidates: "route" })`: an endpoint mutation that
  succeeds invalidates its route's queries, the keys under its literals
  before the first param (`PATCH /todos/:id` invalidates `["todos"]`; a
  route with no param, its whole path). A mutation's own `invalidates`
  replaces it, and `invalidates: []` turns it off. Without the option,
  mutations invalidate only what they say.

### Changed

- `@monarcode/effetch` peer range: `>=0.1.0-rc.3 <0.2.0`. Upgrade Effetch
  with Effetch Query.
- A key that holds a query, a family or a group, such as
  `Query.invalidate([wallet, transactions])`, fails with a
  `KeyHoldsTargetError` defect instead of silently matching nothing.
  Combine targets with `Query.group`. In a mutation's `invalidates` list,
  the run fails that way before it starts; from an `invalidates` function,
  which runs after the change is saved, the target is logged and skipped.
- The API reference (JSDoc) was audited across every entry point: each
  function says what it returns and how it fails, each option its default,
  and related exports link to each other. Documentation only: no type or
  behaviour changed.
- The README is rewritten as the full guide, in the order you learn the
  library: how it works, getting started, then queries, reading them in
  React, mutations, the cache, infinite and live queries, platforms,
  server rendering and frameworks. It covers every API, new and old, with
  an API reference that lists every export of every entry point, and badges
  for the frameworks it supports. Along the way:
  - The setup uses `Fetch.Service`, with a section for a client made with
    `Fetch.make`; a `Fetch.optional` recipe covers a detail that may not
    exist; the testing section uses Effetch's `FetchTest`.
  - "Invalidate after a mutation" puts the three ways side by side: per
    mutation, by route, and everything after any mutation
    (`mutations: { onSuccess: () => Query.invalidate([]) }`).
  - Router loaders use `client.fetch`, and `useRefetch([a, b])` is shown
    failing with `KeyHoldsTargetError`: pass a `Query.group`.
  - "Sign out and switch accounts" leads with a client per account
    (`QueryProvider` with `make` and `resetKey`), which follows the account
    when a session ends or changes away from your sign-out button, such as
    in another tab. `client.clear()` stays as the simpler option when only
    your button ends the session. The TanStack guide's redirect example
    says to catch the typed error when `statusErrors` maps the 401.
  - The TanStack mapping covers every addition, and names
    `queryClient.query()`, which TanStack Query 5.102 added, deprecating
    `ensureQueryData`, `fetchQuery` and `prefetchQuery`.

- The full examples (`tanstack-start`, `tanstack-start-httpclient` and
  `react-router`) follow their router's patterns and use more of the
  library: typed `Unauthorized` and `TodoNotFound` errors, one guard for
  the signed-in pages (`beforeLoad` in TanStack Router, `middleware` in
  React Router), React Router's generated route types, `params.parse` and
  `pendingComponent` in TanStack Router, page titles, a todo opened from a
  list shown at once (`placeholder` with `Entity.get`), app-wide
  `useIsFetching` and `useIsMutating` indicators, `select`, sign-in with
  `concurrent: "drop"`, and a `retry` for network failures. The shared
  `AppShell` takes `loading` and `saving`, and the shared suite tests all
  of it on all three built apps. In `tanstack-start-httpclient`, "Load
  more" after a delete no longer repeats a todo, and All todos' count
  drops with a delete in every app.

- `effect-only` shows a live query (`Query.stream` on a store that pushes
  its count), `Query.refetch` of a `Query.group` next to
  `Query.invalidate`, and a client `queries.onFailure` hook.
  `test/examples/effect-only` runs it.

### Deprecated

- `endpoints`: use `fromClient`, and rename the import and the call. It
  works the same through the 0.1 releases, and goes in 0.2.0.

### Fixed

- A reader that switched to a query another component had fetched earlier
  didn't refetch it on mount, however stale it was.

## 0.1.0-rc.2

Released alongside `@monarcode/effetch` 0.1.0-rc.2. Additions agreed as
exceptions to the API freeze, as the rc.1 additions were.

### Added

- `Query.group(...targets)` combines queries, families, keys and other
  groups into one `Query.Group`, a target of its own: `Query.refetch`,
  `invalidate`, `reset`, a mutation's `invalidates` and `useRefetch` act on
  every query one of its targets matches, each once. One `useRefetch(home)`
  now refreshes a screen built from several features, and stays refetching
  until every one of them in use has settled. Groups don't go to writes
  (`Query.set`, `update`), and an array of queries is still a key, not a
  group: `Query.group([a, b])` is a type error (`Query.GroupTargets`).
  `Query.Target` now includes `Query.Group`, so code that narrows a target
  by hand (`Array.isArray(target) ? … : target.key`) needs a case for it.
- Errors by status through `./effetch`, for effetch's new `statusErrors`
  (status → the schema of your own error). Queries, infinite queries and
  mutations made from an endpoint with `statusErrors` fail with those
  errors, typed, so `Effect.catchTag` and `onErrorTag` narrow them; the
  client's map is typed from its service. `endpoints(Client, {
  statusErrors })` takes the client's map, as it takes `defaultError`, so
  `QueryClient.dehydrate` with `failures: "include"` sends those errors as
  themselves; without it they're typed but not sent. New type:
  `RegisteredStatusErrors`; `EndpointQuery.endpoint` and
  `EndpointInfiniteQuery.endpoint` carry the map. Endpoints without
  `statusErrors` keep their types and dehydrated payloads.

- `QueryProvider` can own its client: give it `make` instead of `client`,
  and a `resetKey` such as the signed-in account's ID. It makes a client on
  the first render and a new one each time `resetKey` changes, rendering
  the tree with the new client from that render, and disposes the old one,
  and its own when it unmounts (a tick later, so StrictMode keeps one
  client). A failed dispose is logged with `console.error`. Into a
  replacement client, a `HydrationBoundary` below loads only state
  dehydrated after the change, so one account's server state never reaches
  another's cache. For the browser and React Native, above every `Suspense`
  boundary: on the server, keep `client`, one per request. New type:
  `OwnedQueryProviderProps`; `QueryProviderProps` gains `make?: undefined`
  and `resetKey?: undefined`, so the two forms can't mix. `QueryProvider`
  now takes either props type, so `React.ComponentProps<typeof
  QueryProvider>` has an optional `client`: a wrapper that reads it should
  type its props as `QueryProviderProps`.

### Changed

- `@monarcode/effetch` peer range is now `>=0.1.0-rc.2 <0.2.0`: the
  adapter's types use effetch's `StatusErrorMap`.

## 0.1.0-rc.1

Fixes from using the RC in cashmore-mobile, and two additions agreed as
exceptions to the API freeze, which otherwise holds until `0.1.0`.

### Added

- `useMutation`'s `run` takes callbacks for one run as a second argument,
  `run(variables, { onSuccess, onFailure, onSettled })`, as TanStack's
  `mutate(variables, { onSuccess })`. They run after the mutation's own,
  and are dropped if, before the run settles, `reset` is called, a newer
  run starts or the component unmounts; so a lookup reset when its input
  changes never fills in an old answer. New type: `UseMutationRunOptions`.
  Passing `run` itself to `map` or `forEach` no longer compiles, since
  the index would be taken as the options: write
  `ids.map((id) => run(id))`.
- `QueryClient.get(client, query)` reads a query's cached value
  synchronously, as an `Option`, outside Effect: TanStack's
  `getQueryData`.

### Fixed

- Endpoint queries and infinite queries accept a `query` typed with an
  `interface`, as effetch's own calls do: `EndpointQueryArgs` checks it
  with `Fetch.QueryOf`.
- The docs say that, with `concurrent: false`, a run a newer one replaces
  resolves with an interrupted `Exit`.

## 0.1.0-rc.0

The first release candidate: the TanStack Router and Start integration,
Next.js and React Router recipes, and clients made from an existing
`ManagedRuntime`. The API is frozen until `0.1.0`: later candidates carry
fixes only.

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
- `QueryClient.disposeAfter(client, response)`: returns the response with
  its body wrapped so the client is disposed once the body has been sent,
  fails or is cancelled. For a client per request on a server that answers
  with a streamed `Response`, such as React Router's middleware, Hono,
  `Bun.serve` or `Deno.serve`.
- `QueryClient.LayerOptions`, `QueryClient.RuntimeOptions` and
  `QueryClient.CommonOptions`: the two ways to give a client its services,
  and the options both take.
- `Mutation.isMutation`, to match `Query.isQuery` and
  `InfiniteQuery.isInfiniteQuery`.
- The README's "TanStack Router and Start" guide.
- The README's "Next.js" guide: the App Router with the core and
  `./react`, no integration package. Each request's client for server
  components comes from React's `cache()` and is disposed with Next's
  `after()`; client components get theirs from a `QueryProvider`.
- The README's "React Router" guide: framework mode with the core and
  `./react`, no integration package. A root middleware makes each
  request's client, which loaders read from the router's context and the
  server render uses through `entry.server.tsx`, and disposes it with
  `QueryClient.disposeAfter`; loaders return the dehydrated state, promises
  included, for a `HydrationBoundary`.
- New examples, all on dummyjson.com's todos and auth APIs: `basic`, a
  list with an optimistic toggle in one small React app; and three full
  apps with the same pages, sign-in and look: `tanstack-start` (Effetch
  endpoints), `tanstack-start-httpclient` (Effect's `HttpClient`, with
  `Query.family` and `Mutation.make`) and `react-router` (framework mode,
  Effetch endpoints). The examples are plain code now, typechecked with the
  package; `test/examples` builds `tanstack-start` and `react-router`,
  serves them against an in-memory dummyjson, and hydrates their pages in
  happy-dom.

### Changed

- **Breaking:** names follow Effect 4's conventions, ahead of the API
  freeze. Types drop their namespace's prefix: `Query.QueryKey` is
  `Query.Key`, `Query.QueryTarget` is `Query.Target`, `Query.QueryFamily`
  is `Query.Family`, `Query.QuerySchema` is `Query.Schema`,
  `InfiniteQuery.InfiniteQueryFamily` is `InfiniteQuery.Family` and
  `InfiniteQuery.PageSchema` is `InfiniteQuery.Schema`. Type ids are
  `TypeId`, as `Atom.TypeId` is: `Query.TypeId`, `Mutation.TypeId` and
  `InfiniteQuery.TypeId`. Defects end in `Error`, as effetch's errors do:
  `QueryClient.NonJsonKeyError`, `QueryClient.DuplicateQueryKeyError` and
  `MissingQueryProviderError`, `_tag` included. `QueryFailure` keeps its
  name.
- `QueryClient.Options` is now a union, `LayerOptions | RuntimeOptions`,
  rather than an interface. Passing `runtime` with `layer` or `memoMap` is
  a compile error.
- The README's server rendering guide makes each request's client from a
  process-wide `ManagedRuntime`, so the app's layer is built once.
- The `todos` and `ssr` examples are replaced by the new ones, and no
  example carries its own tests any more.
- The README is rewritten: why Effetch Query exists and how it relates to
  TanStack Query, a step-by-step start, and every example built on Effetch,
  with a "Without Effetch" section for queries over any Effect.

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
