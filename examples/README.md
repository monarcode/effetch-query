# Examples

Complete programs using effetch-query. Each one is typechecked
(`pnpm run typecheck`) and tested (`pnpm test`) with the package, so they
always match the current API. Each folder has its own `tsconfig.json`,
because each registers its own services (`Register`).

| Example                             | What it shows                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`effect-only/`](effect-only)       | Queries, the cache and a mutation from Effect code, with no UI: what's cached, what's refetched, what's written.       |
| [`todos/`](todos)                   | A React app over effetch endpoints: a paged list, a detail, an optimistic toggle, a missing todo and a refresh button. |
| [`ssr/`](ssr)                       | Server rendering: a client per request, the cache sent with the HTML, and the page hydrated without a fetch.           |
| [`tanstack-start/`](tanstack-start) | A TanStack Start app: loaders, a streamed page and a redirect, built and served by its tests, then hydrated.           |

## `effect-only/`

[`effect-only.ts`](effect-only/effect-only.ts) defines a `TodoStore`
service that counts its reads, two queries and a mutation, then runs a
program against them with `QueryClient.layer`:

1. `todos` is fetched twice; the second fetch is answered from the cache.
2. `addTodo` adds a todo, writes it to `todo(id)` in its `onSuccess`, and
   invalidates `todos`.
3. `Query.get(todo(id))` finds the written todo without a read.
4. `todos` is fetched again, and read again, because it was invalidated.
5. A missing todo fails with the store's own `TodoNotFound`, caught by tag.

Five cache operations, three reads. The test,
[`effect-only.test.ts`](effect-only/effect-only.test.ts), checks each step.

## `todos/`

A small todo app, written the way a real one would be:

```text
todos/
├── api.ts           the effetch client, its endpoints as queries and mutations
├── client.ts        the query client, over an HttpClient
├── App.tsx          the components
├── main.tsx         the browser entry: the client over FetchHttpClient
├── fake-api.ts      an in-memory API for the tests
└── App.test.tsx     tests that drive the app through the DOM
```

- **[`api.ts`](todos/api.ts)** defines the effetch client and registers it
  (`Register["services"]`). `endpoints` turns three `Fetch.endpoint`
  definitions into `todos` (an infinite query, a page at a time through the
  `skip` query field), `todo` and `toggleTodo`. The toggle updates every
  cached page of every list (`Query.update` on the family) and the detail
  optimistically, writes the server's todo when it succeeds, and
  invalidates the list.
- **[`App.tsx`](todos/App.tsx)**:
  - the list reads `todos({ query: { limit: 2 } })` with
    `useInfiniteQuery`, loads more with its `fetchNextPage` (a `FlatList`'s
    `onEndReached` in React Native), and refreshes every loaded page with
    `useRefetch` (a `RefreshControl` in React Native);
  - each item toggles with its own `useMutation`, and shows when its save
    failed;
  - the detail reads `todo({ params: { id } })` with `useSuspenseQuery`. A
    missing todo reaches an error boundary as a `QueryFailure`, whose
    "Try again" button refetches it with `useResetQueryFailure`.
- **[`App.test.tsx`](todos/App.test.tsx)** renders the app over
  [`fake-api.ts`](todos/fake-api.ts), which serves pages, and can hold
  responses and fail the next request. It checks the toggle shows before
  the server answers, on the first page and a later one, that a rejected
  toggle is undone, that a missing todo can be retried once it exists, that
  "load more" keeps the list shown while the next page loads, and that a
  refresh shows the server's latest list.

To run it against a real server, serve `main.tsx` with any bundler (Vite,
for example) and an API at `https://todos.example`, or change `baseUrl` in
`api.ts`.

## `ssr/`

A page rendered on the server and picked up in the browser, with plain
React (`renderToString` and `hydrateRoot`), so it carries over to any
server or framework:

```text
ssr/
├── services.ts      the services: a product catalog and the signed-in viewer
├── app.tsx          two queries with a schema, and the components
├── page.tsx         the tree both sides render, under a HydrationBoundary
├── server.tsx       renders a page per request
├── browser.tsx      hydrates the server's page
├── main.tsx         the browser entry: the catalog over the server's API
└── ssr.test.tsx     tests that render on the server and hydrate the HTML
```

- **[`app.tsx`](ssr/app.tsx)** defines `products` and `greeting`. Each has a
  `schema`, which is what lets it cross to the browser, and a `staleTime`,
  so the browser doesn't refetch what the server just loaded.
- **[`server.tsx`](ssr/server.tsx)** makes a client per request, with that
  request's viewer, sharing one memo map so the catalog is built once per
  process. It prefetches both queries, renders the page, embeds
  `QueryClient.dehydrate`'s result (escaped, so a value can't close its
  script tag) and disposes the client.
- **[`browser.tsx`](ssr/browser.tsx)** reads the embedded data, makes the
  app's client and hydrates the same tree, whose `HydrationBoundary` loads
  the server's cache before the first render.
- **[`ssr.test.tsx`](ssr/ssr.test.tsx)** renders on the "server", loads the
  HTML into the page and hydrates it. It checks the HTML has the data, that
  hydrating changes nothing in the page, logs no mismatch and reads nothing
  from the catalog, that two requests at once each get their own viewer,
  and that a product named `</script>` can't break out of the embedded
  data.

To run it for real, serve `server.tsx`'s pages from any server, bundle
`main.tsx` as `/main.js`, and serve the catalog as JSON at `/api/products`.

## `tanstack-start/`

A TanStack Start app connected with `connectQueryClient`:

```text
tanstack-start/
├── vite.config.ts        Start's Vite plugin
├── src/api.ts            Start server functions over an in-memory store
├── src/services.ts       TodoApi and Session over them, merged as AppLayer
├── src/todos.ts          the queries
├── src/router.tsx        getRouter: a client per router, connected to it
├── src/routes/           the list, a streamed detail, a guarded account page
├── render.mjs            renders pages with the built app, for the tests
└── start.test.tsx        tests that build the app, serve it and hydrate it
```

- **[`src/services.ts`](tanstack-start/src/services.ts)** defines two
  services, `TodoApi` and `Session`, whose live layers call Start server
  functions, in-process on the server and over HTTP from the browser, and
  merges them into `AppLayer`, which registers them (`Register`).
- **[`src/todos.ts`](tanstack-start/src/todos.ts)** defines three queries
  with a `schema`. `viewer` dies with a `redirect()` to `/login` when
  nobody is signed in.
- **[`src/router.tsx`](tanstack-start/src/router.tsx)** is Start's
  `getRouter`: a query client per router, so per request on the server,
  passed to the routes in the router's context and connected to it. Every
  client uses one process-wide `ManagedRuntime`, so `AppLayer` is built
  once, not per request.
- **[`src/routes/`](tanstack-start/src/routes)**: the list's loader awaits
  `Query.fetch(todos)`; the detail's starts `Query.prefetch(todo(id))`
  without waiting, so the page renders at once and the todo streams in;
  the account page's loader fetches `viewer`, and the router follows its
  redirect.
- **[`start.test.tsx`](tanstack-start/start.test.tsx)** builds the app with
  Vite, renders pages with the built server in a process of its own
  ([`render.mjs`](tanstack-start/render.mjs)), then loads each page into
  the test's browser, runs its scripts and hydrates it with the app's
  router over a fake API that counts its reads. It checks that the list
  and the streamed detail hydrate with no mismatch and no read, that
  navigating reads once, that the account page redirects on the server,
  and that a missing todo shows its error once the browser fetches it.

To run it, start Vite in the example's folder:

```bash
pnpm exec vite dev examples/tanstack-start
```
