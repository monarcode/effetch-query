# Examples

Complete programs using effetch-query, to read and copy. Each one is
typechecked with the package (`pnpm run typecheck`), so they always match
the current API. Each folder has its own `tsconfig.json`, because each
registers its own services (`Register`). `tanstack-start` and
`react-router` are also the package's integration tests:
[`test/examples/`](../test/examples) builds them, serves them and drives
them in a browser environment.

All but `effect-only` use [dummyjson.com](https://dummyjson.com)'s todos and
auth APIs. dummyjson answers writes but saves nothing, so a reload shows its
todos as they were.

| Example                                                   | What it shows                                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [`effect-only/`](effect-only)                             | Queries, the cache and a mutation from Effect code, with no UI: what's cached, what's refetched.   |
| [`basic/`](basic)                                         | The smallest React app: a query, and a mutation that shows its change at once.                     |
| [`tanstack-start/`](tanstack-start)                       | A full TanStack Start app on effetch endpoints.                                                    |
| [`tanstack-start-httpclient/`](tanstack-start-httpclient) | The same app on Effect's `HttpClient`, with no effetch: the queries and mutations written by hand. |
| [`react-router/`](react-router)                           | The same app in React Router's framework mode, on effetch endpoints.                               |

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

Five cache operations, three reads: `main` returns what each step saw.

## `basic/`

Ten todos with a checkbox each, in one small React app:

```text
basic/
├── api.ts         the effetch client, its todos query and toggle mutation
├── App.tsx        the list
└── main.tsx       the browser entry: the query client over FetchHttpClient
```

- **[`api.ts`](basic/api.ts)** defines the effetch client, registers it
  (`Register["services"]`), and turns two `Fetch.endpoint`s into `todos`
  and `toggleTodo`. The toggle writes its change to the list before the
  request (`optimistic`), and dummyjson's answer after it (`onSuccess`).
  It invalidates nothing: dummyjson saves nothing, so a refetch would bring
  the old todo back.
- **[`App.tsx`](basic/App.tsx)** reads the list with `useQuery`, and runs
  each toggle with its own `useMutation`.

```bash
pnpm exec vite examples/basic
```

## The full apps

`tanstack-start`, `tanstack-start-httpclient` and `react-router` are one app
three ways, with the same pages, sign-in and look:

| Page         | What it shows                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `/login`     | Sign in as `emilys` / `emilyspass`. A failed sign-in shows dummyjson's message. Already signed in, it redirects home. |
| `/`          | The user's todos, loaded on the server. Toggle and delete show at once, and are undone if dummyjson fails them.       |
| `/todos`     | Every todo, ten at a time, with "Load more": an infinite query paged by `skip`.                                       |
| `/todos/:id` | One todo, streamed: the loader starts it without waiting. A missing one shows dummyjson's message and "Try again".    |

How they work:

- **A client per request.** On the server, each request gets its own query
  client, with that request's token. In the browser, the page keeps one.
  The pages arrive with their queries' values, and hydrate without a fetch.
- **Signing in.** `login` is a mutation. It keeps the access token in a
  `session` cookie, which the browser reads for every request, and writes
  the user to `viewer`, so the next page has them without a fetch. The
  cookie is readable from JavaScript, so the browser can call dummyjson
  itself; a production app would keep it `httpOnly`, and call its own
  server instead.
- **Signed out**, `viewer` (`GET /auth/me`) dies with the router's
  `redirect()` to `/login`, and the loaders that fetch it follow it. Signing
  out clears the cookie and resets every query.
- **Writes keep dummyjson's answer.** As in `basic`, nothing is invalidated
  after a write: the cache keeps what dummyjson answered.
- **One look.** [`ui/`](ui) is a stylesheet and presentational components
  that take data and callbacks, so each app's own code is only its data
  and routing.
- **Tested end to end.** [`test/examples/`](../test/examples) builds
  `tanstack-start` and `react-router` with `VITE_DUMMYJSON_URL` set to an
  in-memory dummyjson, serves them, then loads their pages into happy-dom
  and hydrates them with the app from source. One suite runs on both: the
  redirect, a page hydrated without a fetch, signing in and out, the
  toggle and its undo, delete, refresh, a change kept across pages,
  "Load more", the streamed page, a missing todo and "Try again", a page
  that fails to load, and not found.

To run one against dummyjson.com, then open the address it prints:

```bash
pnpm exec vite dev examples/tanstack-start
```

```bash
pnpm exec vite dev examples/tanstack-start-httpclient
```

```bash
pnpm exec react-router dev examples/react-router
```

### `tanstack-start/`

```text
tanstack-start/
├── src/dummyjson.ts    the effetch client, with the session's bearer token
├── src/session.ts      the session cookie, read on the server and in the browser
├── src/api.ts          the endpoints as queries and mutations, viewer and login
├── src/router.tsx      a router and query client per request
├── src/todo-item.tsx   a todo row, with its toggle and delete
├── src/page-error.tsx  the page shown when a page fails to load
└── src/routes/         the pages: __root, login, _app (signed in) and its children
```

`getRouter` makes the query client and connects it to the router
(`connectQueryClient`). Loaders fetch into it; queries cross to the browser
with the page, and stream in when they're still loading.

### `tanstack-start-httpclient/`

The same app, with the same routes, but its data layer is Effect's own:

- **[`src/dummyjson.ts`](tanstack-start-httpclient/src/dummyjson.ts)** is
  a `DummyJson` service over `HttpClient`: `prependUrl`, a bearer token
  from the session, and each response decoded with its Schema, or failed
  with dummyjson's message as an `ApiError`.
- **[`src/api.ts`](tanstack-start-httpclient/src/api.ts)** defines each
  query and mutation by hand, with `Query.make`, `Query.family`,
  `InfiniteQuery.make` and `Mutation.make`, its key and its schema.

Compare its `src/api.ts` with `tanstack-start`'s to see what effetch's
`endpoints` writes for you.

### `react-router/`

```text
react-router/
├── app/dummyjson.ts       the effetch client, as in tanstack-start
├── app/api.ts             the queries and mutations, as in tanstack-start
├── app/query-client.ts    a query client with a token
├── app/query-context.ts   the root middleware: a client per request, disposed after it
├── app/entry.server.tsx   the server render, with the request's client
├── app/browser.tsx        the app in the browser: its client, for components and client loaders
├── app/entry.client.tsx   the page's client, and hydration
├── app/root.tsx           the document, the middleware and the not-found page
├── app/routes.ts          the routes
└── app/routes/            the pages: login, signed-in (the layout) and its children
```

On the first page, each loader fetches into the request's client and
returns `QueryClient.dehydrate(client)`, which the route hands to a
`HydrationBoundary`. After that, each route's `clientLoader` fetches into
the page's own client, which `BrowserApp` puts in the router's context, as
the Start apps' loaders do in the browser: what the page has cached isn't
fetched again, and dummyjson's unsaved changes stay until a reload.
