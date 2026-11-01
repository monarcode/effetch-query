<h1>
  <img
    src="https://github.com/monarcode/effetch-query/raw/main/assets/banner.png"
    alt="Effetch Query: effectful queries and mutations for Effect 4, inspired by TanStack Query"
    width="100%"
  />
</h1>

[![npm](https://img.shields.io/npm/v/@monarcode/effetch-query)](https://www.npmjs.com/package/@monarcode/effetch-query)
[![CI](https://github.com/monarcode/effetch-query/actions/workflows/ci.yml/badge.svg)](https://github.com/monarcode/effetch-query/actions/workflows/ci.yml)
[![bundle size](https://deno.bundlejs.com/badge?q=@monarcode/effetch-query&config=%7B%22esbuild%22%3A%7B%22external%22%3A%5B%22effect%22%2C%22effect%2F%2A%22%2C%22%40effect%2Fatom-react%22%2C%22react%22%2C%22react%2F%2A%22%2C%22%40monarcode%2Feffetch%22%2C%22%40monarcode%2Feffetch%2F%2A%22%5D%7D%7D)](https://bundlejs.com/?q=@monarcode/effetch-query&config=%7B%22esbuild%22%3A%7B%22external%22%3A%5B%22effect%22%2C%22effect%2F%2A%22%2C%22%40effect%2Fatom-react%22%2C%22react%22%2C%22react%2F%2A%22%2C%22%40monarcode%2Feffetch%22%2C%22%40monarcode%2Feffetch%2F%2A%22%5D%7D%7D)

**Server state for [Effect](https://effect.website) apps, inspired by
[TanStack Query](https://tanstack.com/query).**

effetch-query caches what your app loads from its server, shares it between
the components that show it, keeps it fresh in the background, and updates
it when you change something. Queries and mutations are Effects, run with
your app's services, and their errors stay typed all the way to the
component.

It's the companion to [effetch](https://github.com/monarcode/effetch), the
typed HTTP client for Effect: effetch makes the call, effetch-query caches
it. It works with any Effect too.

> **Release candidate.** The API is frozen for `0.1.0`: the
> `0.1.0-rc.N` releases only fix bugs.

## Contents

- [Why effetch-query](#why-effetch-query)
  - [How it works](#how-it-works)
  - [With thanks to TanStack Query](#with-thanks-to-tanstack-query)
  - [At a glance](#at-a-glance)
- [Getting started](#getting-started)
  - [Install](#install)
  - [1. Your API client](#1-your-api-client)
  - [2. A query client](#2-a-query-client)
  - [3. Your first queries](#3-your-first-queries)
  - [4. Showing a query](#4-showing-a-query)
  - [5. Changing data](#5-changing-data)
- [Queries in depth](#queries-in-depth)
  - [From endpoints to queries](#from-endpoints-to-queries)
  - [Keys](#keys)
  - [Freshness and refetching](#freshness-and-refetching)
  - [Query options](#query-options)
  - [Using the cache from Effect](#using-the-cache-from-effect)
- [Mutations in depth](#mutations-in-depth)
  - [Optimistic updates](#optimistic-updates)
  - [Mutation options](#mutation-options)
- [Infinite queries](#infinite-queries)
- [React](#react)
  - [Reading queries](#reading-queries)
  - [Suspense and error boundaries](#suspense-and-error-boundaries)
  - [Running mutations](#running-mutations)
  - [Load more](#load-more)
  - [Pull to refresh](#pull-to-refresh)
  - [Atoms](#atoms)
- [React Native](#react-native)
- [Without effetch](#without-effetch)
- [Server rendering](#server-rendering)
  - [Sending the cache](#sending-the-cache)
  - [Loading it in the browser](#loading-it-in-the-browser)
  - [Streaming](#streaming)
- [Frameworks](#frameworks)
  - [TanStack Router and Start](#tanstack-router-and-start)
  - [Next.js](#nextjs)
  - [React Router](#react-router)
- [The client](#the-client)
- [Testing](#testing)
- [Coming from TanStack Query](#coming-from-tanstack-query)
- [Reference](#reference)
- [Examples](#examples)
- [Development](#development)
- [License](#license)

## Why effetch-query

effetch-query started in real frontend projects built with Effect and
effetch. Their API calls were Effects, with typed errors, services and
retries. Their UI used TanStack Query, the standard way to cache server
data in React. Joining the two meant writing a bridge: run each Effect into
a promise, hand the promise to TanStack Query, and turn its errors back
into something the UI could match on.

That bridge was where the trouble lived. TanStack Query sits on the other
side of a promise, outside Effect: past it, errors lose their Effect types,
a query can't use your layers, and interrupting an Effect that's no longer
needed takes wiring of its own. effetch had made each call effectful; what
was still missing was a cache that spoke Effect.

effetch-query is that cache. Instead of patching TanStack Query, it brings
the parts of it that make apps feel fast into Effect itself: one fetch
shared by every component, fresh data in the background, optimistic
updates and invalidation by key.

### How it works

- **A query is an Effect with a key.** It runs with your app's services,
  from a layer or a runtime you give the client, so it can use your effetch
  client, a database, or another query.
- **Errors keep their types.** A query's result is an `AsyncResult` that
  holds the full `Cause`, so a component can tell a 404 from a network
  error from a bug.
- **The cache is Effect too.** Fetching, invalidating and writing to the
  cache are Effects you can use in your own programs, and a mutation's
  callbacks are Effects that run with your services.
- **React only subscribes.** The cache is built on Effect's own reactivity
  (`effect/reactivity` atoms), and the React hooks read from it. Server
  rendering, TanStack Router, Next.js and React Router are covered.

### With thanks to TanStack Query

effetch-query owes its model, its vocabulary and many of its defaults to
[TanStack Query](https://tanstack.com/query). If you know it, you'll feel at
home here, and [Coming from TanStack Query](#coming-from-tanstack-query)
maps one to the other.

TanStack Query is the industry standard for data fetching, and the right
choice for most apps. effetch-query is an alternative for people building
their apps with Effect, who want their server state to be Effect as well.

Want to keep TanStack Query and still write your frontend with Effect?
Watch [tanstack-effect-bridge](https://github.com/monarcode/tanstack-effect-bridge),
our next project.

### At a glance

```tsx
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { QueryClient } from "@monarcode/effetch-query";
import { endpoints } from "@monarcode/effetch-query/effetch";
import {
  QueryProvider,
  useMutation,
  useQuery,
} from "@monarcode/effetch-query/react";

const Todo = Schema.Struct({
  id: Schema.Finite,
  title: Schema.String,
  done: Schema.Boolean,
});

// Your effetch client, as a service.
const makeApiClient = Fetch.make({ baseUrl: "https://api.example.com" });

class ApiClient extends Context.Service<
  ApiClient,
  Effect.Success<typeof makeApiClient>
>()("ApiClient") {}

declare module "@monarcode/effetch-query" {
  interface Register {
    readonly services: ApiClient;
  }
}

const api = endpoints(ApiClient);

// A cached query for each call of the endpoint.
const todos = api.query(
  Fetch.endpoint("GET /todos", { output: Schema.Array(Todo) }),
  { staleTime: "1 minute" },
);

// A mutation that refetches the todos once it succeeds.
const toggleTodo = api.mutation(
  Fetch.endpoint("PATCH /todos/:id", {
    input: Schema.Struct({ done: Schema.Boolean }),
    output: Todo,
  }),
  { invalidates: [todos] },
);

// The cache, which runs queries with your services.
const queryClient = QueryClient.make({
  layer: Layer.effect(ApiClient)(makeApiClient).pipe(
    Layer.provide(FetchHttpClient.layer),
  ),
});

export function App() {
  return (
    <QueryProvider client={queryClient}>
      <Todos />
    </QueryProvider>
  );
}

function Todos() {
  const result = useQuery(todos());
  const toggle = useMutation(toggleTodo);

  return AsyncResult.match(result, {
    onInitial: () => <p>Loading…</p>,
    onFailure: () => <p>Couldn't load your todos.</p>,
    onSuccess: ({ value }) => (
      <ul>
        {value.map((todo) => (
          <li
            key={todo.id}
            onClick={() =>
              void toggle.run({
                params: { id: todo.id },
                body: { done: !todo.done },
              })
            }
          >
            {todo.done ? "✓" : "○"} {todo.title}
          </li>
        ))}
      </ul>
    ),
  });
}
```

## Getting started

This walks through a small todo app, one step at a time: an effetch client,
a query client, two queries, a component that shows them, and a mutation.
Later sections build on the same files.

### Install

```bash
pnpm add @monarcode/effetch-query @monarcode/effetch effect
```

For React, add `@effect/atom-react` and `react` (19):

```bash
pnpm add @effect/atom-react react
```

effetch-query needs `effect` 4.1 or later. It runs in browsers, React Native
(Hermes), Node 20+, Bun and Deno.

### 1. Your API client

Start with an effetch client for your API, shared as a service. If you
already use effetch, you have this:

```ts api.ts
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";

export const Todo = Schema.Struct({
  id: Schema.Finite,
  title: Schema.String,
  done: Schema.Boolean,
});
export type Todo = typeof Todo.Type;

// What the API sends back when a request fails.
export const ApiError = Schema.Struct({ message: Schema.String });

export const makeApiClient = Fetch.make({
  baseUrl: "https://api.example.com",
  defaultError: ApiError,
});

export class ApiClient extends Context.Service<
  ApiClient,
  Effect.Success<typeof makeApiClient>
>()("ApiClient") {}

// Sends requests with the browser's `fetch`.
export const ApiClientLive = Layer.effect(ApiClient)(makeApiClient).pipe(
  Layer.provide(FetchHttpClient.layer),
);

// The services your queries and mutations can use.
declare module "@monarcode/effetch-query" {
  interface Register {
    readonly services: ApiClient;
  }
}
```

The `declare module` block at the end tells effetch-query which services
your queries run with. Write it once, anywhere in your app. From then on, a
query that uses a service you haven't registered doesn't compile, and the
client must be given a layer that provides them. With several services, use
a union (`ApiClient | Analytics`).

### 2. A query client

The query client holds the cache. Give it the layer that provides your
services; it builds the layer the first time a query needs it:

```ts client.ts
import { QueryClient } from "@monarcode/effetch-query";

import { ApiClientLive } from "./api.js";

export const queryClient = QueryClient.make({
  layer: ApiClientLive,
  queries: {
    // Data counts as fresh for 30 seconds after it's fetched.
    defaults: { staleTime: "30 seconds" },
  },
});
```

One client is enough for a browser app. On a server, you'll make one per
request ([Server rendering](#server-rendering)).

### 3. Your first queries

`endpoints` turns effetch endpoints into queries. Each call of the endpoint,
with its own params, is its own cached query:

```ts todos.ts
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { endpoints } from "@monarcode/effetch-query/effetch";

import { ApiClient, ApiError, Todo } from "./api.js";

// Queries and mutations that call your API through ApiClient. Give it the
// client's defaultError too, so their errors are typed with it.
export const api = endpoints(ApiClient, { defaultError: ApiError });

export const todos = api.query(
  Fetch.endpoint("GET /todos", { output: Schema.Array(Todo) }),
);
// todos({ query: { done: false } }) is the query keyed ["todos", { done: false }]

export const todo = api.query(
  Fetch.endpoint("GET /todos/:id", { output: Todo }),
  { staleTime: "1 minute" },
);
// todo({ params: { id: 1 } }) is the query keyed ["todos", 1]
```

Define queries at module level, like your schemas. A query holds no data
itself: the data lives in the client, and nothing is fetched until
something reads the query.

**Calling the client yourself.** If you'd rather not define endpoints, a
query can call your effetch client directly. `Query.make` defines one
query and `Query.family` one per argument, each from an Effect you write:

```ts
import * as Schema from "effect/Schema";

import { Query } from "@monarcode/effetch-query";

import { ApiClient, Todo } from "./api.js";

export const todos = Query.family({
  key: ["todos", "list"],
  run: (filter: { readonly done: boolean }) =>
    ApiClient.use((client) =>
      client.get("/todos", { query: filter, output: Schema.Array(Todo) }),
    ),
});
// todos({ done: false }) is the query keyed ["todos", "list", { done: false }]

export const todo = Query.family({
  key: ["todos", "detail"],
  run: (id: number) =>
    ApiClient.use((client) =>
      client.get("/todos/:id", { params: { id }, output: Todo }),
    ),
  staleTime: "1 minute",
});
// todo(1) is the query keyed ["todos", "detail", 1]
```

The queries work the same, with the same typed errors. The difference is
what you write yourself: the key, which an endpoint takes from its route,
and a `schema` for [server rendering](#server-rendering), which an
endpoint takes from its `output`.

### 4. Showing a query

`useQuery` reads a query in a component. It fetches the first time, then
shows the cached value, and refetches in the background when the value is
stale:

```tsx open-todos.tsx
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { useQuery } from "@monarcode/effetch-query/react";

import { todos } from "./todos.js";

export function OpenTodos() {
  const result = useQuery(todos({ query: { done: false } }));

  return AsyncResult.match(result, {
    onInitial: () => <p>Loading…</p>,
    onFailure: () => <p>Couldn't load your todos.</p>,
    onSuccess: ({ value }) => (
      <ul>
        {value.map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
    ),
  });
}
```

The result is an `AsyncResult`: `Initial` before the first value, `Success`
with a value, or `Failure` with what went wrong. Give your app the client
with `QueryProvider`:

```tsx App.tsx
import { QueryProvider } from "@monarcode/effetch-query/react";

import { queryClient } from "./client.js";
import { OpenTodos } from "./open-todos.js";

export function App() {
  return (
    <QueryProvider client={queryClient}>
      <OpenTodos />
    </QueryProvider>
  );
}
```

Two components that show `todos({ query: { done: false } })` share one
fetch and one cached value.

### 5. Changing data

A mutation changes data on the server. `invalidates` says which queries are
out of date once it succeeds, and they refetch:

```ts toggle-todo.ts
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";

import { Todo } from "./api.js";
import { api, todos } from "./todos.js";

export const toggleTodo = api.mutation(
  Fetch.endpoint("PATCH /todos/:id", {
    input: Schema.Struct({ done: Schema.Boolean }),
    output: Todo,
  }),
  { invalidates: [todos] },
);
```

`useMutation` runs it from a component. Its variables are the endpoint's
call options:

```tsx
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { useMutation } from "@monarcode/effetch-query/react";

import type { Todo } from "./api.js";
import { toggleTodo } from "./toggle-todo.js";

export function ToggleButton({ todo }: { readonly todo: Todo }) {
  const { result, run } = useMutation(toggleTodo);

  return (
    <button
      disabled={result.waiting}
      onClick={() =>
        void run({ params: { id: todo.id }, body: { done: !todo.done } })
      }
    >
      {AsyncResult.isFailure(result)
        ? "Try again"
        : todo.done
          ? "Undo"
          : "Done"}
    </button>
  );
}
```

**Calling the client yourself.** `Mutation.make` defines a mutation from
an Effect you write, so it can call your effetch client directly. Its
variables are whatever its `run` takes, here the todo to toggle:

```ts
import { Mutation } from "@monarcode/effetch-query";

import { ApiClient, Todo } from "./api.js";

export const toggleTodo = Mutation.make({
  run: (todo: Todo) =>
    ApiClient.use((client) =>
      client.patch("/todos/:id", {
        params: { id: todo.id },
        body: { done: !todo.done },
        output: Todo,
      }),
    ),
  // A key reaches every query under it, endpoint or not.
  invalidates: [["todos"]],
});
// useMutation(toggleTodo).run(todo)
```

That's the whole loop: define, read, change, refetch. The rest of this
guide goes deeper into each part.

## Queries in depth

### From endpoints to queries

`api.query`, `api.infiniteQuery` and `api.mutation` add no behaviour of
their own: they call your endpoint through your effetch client, and take a
query's or mutation's options.

- **Keys come from the route:** the path with its params filled in, then the
  query object. `GET /todos/:id` with `{ params: { id: 1 } }` is
  `["todos", 1]`, so invalidating `["todos"]` reaches every todos endpoint.
  For a second backend with the same paths, `endpoints(Client, { key: ["billing"] })`
  puts a prefix before every key.
- **Errors are typed from the endpoint and the client:** `todo`'s error is
  `NetworkError | DecodeError | HttpError.With<{ message: string }>`, with
  your plugins' errors if you use any.
- **`query` takes endpoints without a body** (`GET`, `HEAD`, `OPTIONS`,
  `TRACE`). Everything else is a `mutation`, whose variables are the call's
  options.
- **As a target, an endpoint query matches its own queries only:**
  `Query.invalidate(todo)` reaches every `todo({ params })`, not
  `GET /todos` or `GET /todos/:id/comments`.
- **Server rendering needs nothing extra** when the endpoint has an
  `output`: it's the schema the value crosses to the browser with
  ([Server rendering](#server-rendering)).
- Pass `headers` and `plugins` as options of `query`, `infiniteQuery` and
  `mutation`, as with effetch's `client.bind`.

Make one `api.query` per endpoint: two of the same route would share keys
but not their cache.

### Keys

A key is an array that identifies a query in the cache, such as
`["todos", 1]`. Keys are hierarchical: invalidating `["todos"]` reaches
every key that starts with it, so the broadest part comes first. Parts are
compared by value, so `{ done: false }` matches `{ done: false }`.

Keep keys to JSON values (strings, numbers, booleans, `null`, arrays and
plain objects): with server rendering, they're sent to the browser.

### Freshness and refetching

A query's value is **fresh** for its `staleTime` after it's fetched, and
**stale** after that. A stale value is still shown, and refetched in the
background when:

- a component starts using the query (`refetchOnMount`),
- the app comes back into focus (`refetchOnFocus`) or the device comes back
  online (`refetchOnReconnect`), for queries in use,
- it's invalidated, or its `refetchInterval` comes round.

While it refetches, the query keeps showing its value, with `waiting: true`.
A query that failed is fetched again when a component starts using it
(`retryOnMount`). A query nothing uses is dropped after its `gcTime`.

### Query options

| Option               | Default   | What it does                                                                     |
| -------------------- | --------- | -------------------------------------------------------------------------------- |
| `staleTime`          | `0`       | How long a value counts as fresh (a `Duration.Input`, such as `"1 minute"`).     |
| `gcTime`             | 5 minutes | How long a query nothing uses keeps its value.                                   |
| `retry`              | none      | A `Schedule` to retry failed fetches with.                                       |
| `refetchOnMount`     | `true`    | Refetch a stale query when a component starts using it.                          |
| `retryOnMount`       | `true`    | Refetch a failed query when a component starts using it.                         |
| `refetchOnFocus`     | `true`    | Refetch stale queries in use when the app comes back into focus.                 |
| `refetchOnReconnect` | `true`    | Refetch stale queries in use when the device comes back online.                  |
| `refetchInterval`    | none      | Refetch on this interval while the query is in use.                              |
| `reactivityKeys`     | none      | Also refetch when these `Reactivity` keys are invalidated (`effect/reactivity`). |

The client's `queries.defaults` sets all but `gcTime` and `reactivityKeys`
for every query, and a query's own options win.

`retry` defaults to none, where TanStack Query retries three times: effetch
has a retry plugin, and a query shouldn't retry what the client already
retried.

### Using the cache from Effect

Everything the cache does is an Effect. Inside queries and mutations the
client is already there; elsewhere, such as a router loader or an event
handler, run the Effect with `queryClient.runPromise`:

```ts
import * as Effect from "effect/Effect";

import { Query } from "@monarcode/effetch-query";

import { queryClient } from "./client.js";
import { todo, todos } from "./todos.js";

const openTodo = (id: number) =>
  Effect.gen(function* () {
    // The cached value if it's fresh, otherwise a fetch.
    const current = yield* Query.fetch(todo({ params: { id } }));
    // Warm the cache for the next screen, without waiting for it.
    yield* Query.prefetch(todos({ query: { done: current.done } }));
    return current;
  });

export const loadTodo = (id: number) => queryClient.runPromise(openTodo(id));

export const refreshEverything = () =>
  queryClient.runPromise(Query.invalidate(["todos"]));
```

| Function                   | What it does                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `Query.fetch(query)`       | The value if fresh, otherwise a fetch. Joins a fetch already running. Fails as the query does. |
| `Query.prefetch(query)`    | Fetches if not fresh, and ignores the result. Never fails.                                     |
| `Query.get(query)`         | The cached value as an `Option`. Never fetches.                                                |
| `Query.set(query, value)`  | Writes a value, fresh as if just fetched.                                                      |
| `Query.update(query, f)`   | Writes `f(value)`; does nothing without a value.                                               |
| `Query.update(family, f)`  | Writes `f(value, args)` to every cached query of a family, such as `todos`.                    |
| `Query.invalidate(target)` | Marks queries stale: those in use refetch now, the rest when next used.                        |
| `Query.refetch(target)`    | Refetches the queries in use, and completes when they've settled.                              |
| `Query.reset(target)`      | Drops the values; queries in use fetch again.                                                  |

To read the cache where you can't wait for a promise, such as a form
listener, `QueryClient.get(queryClient, query)` returns the cached value as
an `Option`, as `Query.get` does.

A **target** is one query (`todo({ params: { id: 1 } })`), a family of
queries (`todos`, every call of the endpoint), or a key (`["todos"]`,
every query whose key starts with it).

## Mutations in depth

### Optimistic updates

An optimistic update shows the change before the server confirms it. Write
the cache in `optimistic`: if the request fails, every write it made is
undone. This `toggleTodo` flips the todo at once, in its own query and in
every cached list:

```ts
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { Query } from "@monarcode/effetch-query";

import { Todo } from "./api.js";
import { api, todo, todos } from "./todos.js";

export const toggleTodo = api.mutation(
  Fetch.endpoint("PATCH /todos/:id", {
    input: Schema.Struct({ done: Schema.Boolean }),
    output: Todo,
  }),
  {
    optimistic: ({ params, body }) =>
      Effect.andThen(
        Query.update(todo({ params }), (current) => ({
          ...current,
          done: body.done,
        })),
        // Every cached list, whatever its filter.
        Query.update(todos, (list) =>
          list.map((item) =>
            item.id === params.id ? { ...item, done: body.done } : item,
          ),
        ),
      ),
    // The server's version replaces the guess.
    onSuccess: (saved) => Query.set(todo({ params: { id: saved.id } }), saved),
    invalidates: [todos],
  },
);
```

A run goes in this order:

1. `optimistic` writes to the cache, and the writes are recorded;
2. the request runs, retried on `retry`;
3. on success, `onSuccess`, then `invalidates`;
4. on failure, the writes are undone, newest first, then `onFailure`;
5. `onSettled`, either way.

A written value shows until the next fetch of that query settles, so the
old value never flashes back while the refetch runs.

### Mutation options

| Option        | What it does                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `optimistic`  | `(variables) => Effect`: cache writes to show right away, undone if the mutation fails.        |
| `onSuccess`   | `(value, variables) => Effect`, after a success.                                               |
| `onFailure`   | `(cause, variables) => Effect`, after a failure and the rollback.                              |
| `onSettled`   | `(exit, variables) => Effect`, after either.                                                   |
| `invalidates` | Targets to invalidate after `onSuccess`, or `(value, variables) => targets`.                   |
| `retry`       | A `Schedule` to retry the request with. Default: the client's `mutations.defaults`, else none. |
| `concurrent`  | `false`: within one `useMutation`, a new run interrupts the one in progress. Default `true`.   |

The callbacks run with your services and the client, so they can use the
cache. A mutation invalidates nothing unless you say so. Outside React, run
one with `Mutation.run(toggleTodo, variables)`, an Effect.

## Infinite queries

An infinite query loads a list one page at a time, for "load more" buttons
and infinite scroll. Its value is every page loaded so far, with the param
each was fetched with: `{ pages, pageParams }`.

`api.infiniteQuery` pages through an endpoint. `pageParam` names the query
field each page's param is sent in:

```ts activity.ts
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";

import { api } from "./todos.js";

const ActivityPage = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({ id: Schema.String, text: Schema.String }),
  ),
  nextCursor: Schema.NullOr(Schema.String),
});

export const activity = api.infiniteQuery(
  Fetch.endpoint("GET /activity", { output: ActivityPage }),
  {
    // Sent as ?cursor=…, and left out of the key.
    pageParam: "cursor",
    initialPageParam: null as string | null,
    // null or undefined: there's no next page.
    nextPageParam: (lastPage) => lastPage.nextCursor,
  },
);
// activity({ query: { team: "web" } }) loads its first page from
// GET /activity?team=web, and the next from ?team=web&cursor=…
```

The first fetch loads one page. `fetchNextPage` (from
[`useInfiniteQuery`](#load-more), or `InfiniteQuery.fetchNextPage` in
Effect code) adds the next one:

- On the last page, it returns the pages without fetching.
- A page that fails keeps the loaded pages: the result is a `Failure` whose
  `previousSuccess` still holds them.
- A refetch (invalidation, focus, a stale mount) fetches as many pages as
  are loaded, one after the other, each from the page before it, so a list
  that changed underneath doesn't show duplicates or gaps.

An infinite query **is** a query: invalidation, the cache functions and the
client's defaults work on it as on any other. To change its pages in an
optimistic update, `Query.update` the whole `{ pages, pageParams }` value.

| Option              | What it does                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pageParam`         | The query field each page's param is sent in (effetch only).                                                             |
| `initialPageParam`  | The first page's param.                                                                                                  |
| `nextPageParam`     | `(lastPage, pages, lastPageParam, pageParams) => param`: the next page's param, or `undefined` / `null` for none.        |
| `previousPageParam` | The same, from the first page, for `fetchPreviousPage`. Without it, there's no previous page.                            |
| `maxPages`          | The most pages to keep. Past it, a page is dropped from the far end; give `previousPageParam` too, so it can load again. |
| the rest            | As for [queries](#query-options): `staleTime`, `retry` (for each page), `refetchOnFocus`, …                              |

## React

`QueryProvider` gives your components the client
([step 4](#4-showing-a-query)). Every hook here comes from
`@monarcode/effetch-query/react`.

### Reading queries

`useQuery` returns the query's `AsyncResult`. Match on it to show each
state, with the error typed as the query defines it:

```tsx
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { useQuery } from "@monarcode/effetch-query/react";

import { todo } from "./todos.js";

export function TodoTitle({ id }: { readonly id: number | null }) {
  // null reads nothing and fetches nothing (TanStack's `enabled: false`).
  const result = useQuery(id === null ? null : todo({ params: { id } }), {
    // Keep showing the last todo while the next one loads.
    keepPrevious: true,
  });

  return AsyncResult.matchWithError(result, {
    onInitial: () => <p>Loading…</p>,
    onError: (error) =>
      error._tag === "HttpError" && error.status === 404 ? (
        <p>There's no todo {id}.</p>
      ) : (
        <p>Couldn't load the todo: {error.message}</p>
      ),
    onDefect: () => <p>Something went wrong.</p>,
    onSuccess: ({ value, waiting }) => (
      <h1 style={{ opacity: waiting ? 0.5 : 1 }}>{value.title}</h1>
    ),
  });
}
```

`waiting` is true while a fetch runs, including a background refetch.

### Suspense and error boundaries

`useSuspenseQuery` suspends until the query has a value, then returns its
`Success`. A failure with nothing to show is thrown to the nearest error
boundary as a `QueryFailure`, which carries the query and its `Cause`.
`useResetQueryFailure` refetches that query, for a "Try again" button:

```tsx
import {
  QueryFailure,
  useResetQueryFailure,
  useSuspenseQuery,
} from "@monarcode/effetch-query/react";
import * as React from "react";

import { todo } from "./todos.js";

function TodoDetail({ id }: { readonly id: number }) {
  const { value } = useSuspenseQuery(todo({ params: { id } }));
  return <h1>{value.title}</h1>;
}

function Retry({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const resetFailure = useResetQueryFailure();
  const shown = QueryFailure.is(error) ? error.error : error;
  return (
    <button
      onClick={() => {
        resetFailure(error);
        onRetry();
      }}
    >
      {String(shown)}: try again
    </button>
  );
}

class Boundary extends React.Component<
  { readonly children: React.ReactNode },
  { readonly error: unknown; readonly failed: boolean }
> {
  override state = { error: undefined as unknown, failed: false };
  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }
  override render() {
    return this.state.failed ? (
      <Retry
        error={this.state.error}
        onRetry={() => this.setState({ error: undefined, failed: false })}
      />
    ) : (
      this.props.children
    );
  }
}

export function TodoScreen({ id }: { readonly id: number }) {
  return (
    <Boundary>
      <React.Suspense fallback={<p>Loading…</p>}>
        <TodoDetail id={id} />
      </React.Suspense>
    </Boundary>
  );
}
```

A refetch that fails after a success keeps showing that success.

### Running mutations

`useMutation` gives each component its own state for a mutation: two
buttons that run `toggleTodo` never share a pending or failed state.

```tsx
import * as Exit from "effect/Exit";

import { useMutation } from "@monarcode/effetch-query/react";

import type { Todo } from "./api.js";
import { toggleTodo } from "./toggle-todo.js";

export function DoneCheckbox({ todo }: { readonly todo: Todo }) {
  const { result, run, reset } = useMutation(toggleTodo);

  return (
    <input
      type="checkbox"
      checked={todo.done}
      disabled={result.waiting}
      onChange={async (event) => {
        const exit = await run({
          params: { id: todo.id },
          body: { done: event.target.checked },
        });
        if (Exit.isFailure(exit)) {
          setTimeout(reset, 3000);
        }
      }}
    />
  );
}
```

`run` returns a `Promise` of the run's `Exit` and never rejects. A run
carries on if the component unmounts, so the mutation's `onSuccess` and
`invalidates` still happen. `reset` puts `result` back to `Initial`. With
the mutation's `concurrent: false`, a new run interrupts the one in
progress, whose `run` then resolves with an interrupted `Exit`.

`run` also takes callbacks for one run, as TanStack's
`mutate(variables, { onSuccess })` does:

```tsx
import { useMutation } from "@monarcode/effetch-query/react";

import type { Todo } from "./api.js";
import { toggleTodo } from "./toggle-todo.js";

export function MarkDone({
  todo,
  onDone,
}: {
  readonly todo: Todo;
  readonly onDone: () => void;
}) {
  const { result, run } = useMutation(toggleTodo);

  return (
    <button
      type="button"
      disabled={result.waiting}
      onClick={() =>
        run(
          { params: { id: todo.id }, body: { done: true } },
          { onSuccess: onDone },
        )
      }
    >
      Done
    </button>
  );
}
```

`onSuccess`, `onFailure` and `onSettled` run after the mutation's own. They
belong to this screen, so they're dropped if, before the run settles,
`reset` is called, a newer run starts or the component unmounts; the run
completes all the same. A lookup that you `reset` when its input changes
never fills in the answer for the old input. A lookup that only reads can
also be a query keyed by its input, read with
`useQuery(input === "" ? null : lookup(input))`.

### Load more

`useInfiniteQuery` reads an infinite query, with controls for the next and
previous pages. `useSuspenseInfiniteQuery` suspends only until the first
page:

```tsx
import { useSuspenseInfiniteQuery } from "@monarcode/effetch-query/react";

import { activity } from "./activity.js";

export function ActivityFeed() {
  const { result, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useSuspenseInfiniteQuery(activity({ query: { team: "web" } }));

  return (
    <>
      <ul>
        {result.value.pages
          .flatMap((page) => page.events)
          .map((event) => (
            <li key={event.id}>{event.text}</li>
          ))}
      </ul>
      {hasNextPage ? (
        <button
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </>
  );
}
```

The loaded pages stay on screen while the next one loads.
`fetchNextPage` never rejects: a page that fails shows in `result`. In
React Native, call it from `FlatList`'s `onEndReached`.

### Pull to refresh

A query's `waiting` is true for background refetches too, which shouldn't
show a spinner. `useRefetch` refetches on demand, with a flag for its own
refetch only:

```tsx
import { useRefetch } from "@monarcode/effetch-query/react";

import { todos } from "./todos.js";

export function RefreshButton() {
  const { refetch, isRefetching } = useRefetch(todos);
  return (
    <button disabled={isRefetching} onClick={() => void refetch()}>
      {isRefetching ? "Refreshing…" : "Refresh"}
    </button>
  );
}
// React Native: <FlatList refreshing={isRefetching} onRefresh={refetch} … />
```

### Atoms

Queries are atoms from `effect/reactivity`, and `QueryProvider` shares the
client's registry with `@effect/atom-react`. Derive values with `Atom.map`,
as TanStack's `select` does:

```tsx
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { todos } from "./todos.js";

const openTitles = Atom.map(
  todos({ query: { done: false } }),
  AsyncResult.map((list) => list.map((todo) => todo.title)),
);

export function OpenTitles() {
  const result = useAtomValue(openTitles);
  return <p>{AsyncResult.getOrElse(result, () => []).join(", ")}</p>;
}
```

`useQuery` also refetches on mount and focus; `useAtomValue` only reads.
`useQueryClient()` returns the client, to run Effects from a component.

## React Native

React Native has no browser focus or online events, so give the client its
own with `reactNativeSignals`:

```ts
import { QueryClient } from "@monarcode/effetch-query";
import { reactNativeSignals } from "@monarcode/effetch-query/react-native";
import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";

import { ApiClientLive } from "./api.js";

export const queryClient = QueryClient.make({
  layer: ApiClientLive,
  signals: reactNativeSignals({ AppState, NetInfo }),
});
```

Focus is the app coming back to the foreground, and online follows
NetInfo's `isConnected`. The package doesn't depend on `react-native` or
NetInfo: you pass them in. Everything else, hooks included, works as on
the web.

On a Hermes older than its 2026 releases, `FinalizationRegistry` is
missing, so a family keeps a small definition (about 2 KB) for every
argument it has seen, for the app's lifetime. Cached values are still
dropped after `gcTime`; this matters only for a family with many thousands
of arguments in one session, such as one keyed by free-text search.

## Without effetch

Any Effect can be a query. `Query.make` defines one, `Query.family` one per
argument, and `Mutation.make` a mutation, each with an Effect you write.
Register the services they use, as in [step 1](#1-your-api-client):

```ts
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { Mutation, Query } from "@monarcode/effetch-query";

const Todo = Schema.Struct({
  id: Schema.Finite,
  title: Schema.String,
  done: Schema.Boolean,
});
type Todo = typeof Todo.Type;

class TodoNotFound extends Data.TaggedError("TodoNotFound")<{
  readonly id: number;
}> {}

// Any service: an HttpClient wrapper, a database, local storage…
class TodoStore extends Context.Service<
  TodoStore,
  {
    readonly list: Effect.Effect<ReadonlyArray<Todo>>;
    readonly get: (id: number) => Effect.Effect<Todo, TodoNotFound>;
    readonly setDone: (
      id: number,
      done: boolean,
    ) => Effect.Effect<Todo, TodoNotFound>;
  }
>()("TodoStore") {}

declare module "@monarcode/effetch-query" {
  interface Register {
    readonly services: TodoStore;
  }
}

export const todos = Query.make({
  key: ["todos", "list"],
  run: TodoStore.use((store) => store.list),
  // Only for server rendering: how the value crosses to the browser.
  schema: { success: Schema.Array(Todo) },
});

export const todo = Query.family({
  key: ["todos", "detail"],
  run: (id: number) => TodoStore.use((store) => store.get(id)),
  staleTime: "1 minute",
});
// todo(1): Query<Todo, TodoNotFound>, keyed ["todos", "detail", 1]

// A query can read another one, and refetches when it changes.
export const openCount = Query.make({
  key: ["todos", "open-count"],
  run: (ctx) =>
    Effect.map(
      ctx.result(todos),
      (list) => list.filter((item) => !item.done).length,
    ),
});

export const setDone = Mutation.make({
  run: ({ id, done }: { readonly id: number; readonly done: boolean }) =>
    TodoStore.use((store) => store.setDone(id, done)),
  optimistic: ({ id, done }) =>
    Query.update(todo(id), (current) => ({ ...current, done })),
  invalidates: [todos],
});
```

- **Keys are yours to write.** A family's key is its `key` followed by the
  argument: `todo(1)` is `["todos", "detail", 1]`. Arguments are compared
  by value, so `todo(1) === todo(1)`.
- **`run` can read other queries** through `ctx.result`, as `openCount`
  does.
- **To render on the server**, give the query a `schema`. effetch's
  endpoints don't need one, since their `output` is it.
- **`InfiniteQuery.make` and `InfiniteQuery.family`** take a `run` from the
  page's param, `(args, pageParam) => Effect` for a family, with the
  [paging options](#infinite-queries).

Everything else in this guide, hooks, mutations, the cache and server
rendering, works the same.

## Server rendering

Render a page on the server with its data, then pick that data up in the
browser without fetching it again. It works with any React server renderer
(`renderToString`, `renderToPipeableStream`, a framework's), and without
React through `QueryClient.hydrate`. If you use a framework, read this
section first, then [its own](#frameworks).

### Sending the cache

Here's a component that reads the todos with `useSuspenseQuery`:

```tsx todo-list.tsx
import { useSuspenseQuery } from "@monarcode/effetch-query/react";

import { todos } from "./todos.js";

export function TodoList() {
  const { value } = useSuspenseQuery(todos());
  return (
    <ul>
      {value.map((todo) => (
        <li key={todo.id}>{todo.title}</li>
      ))}
    </ul>
  );
}
```

On the server, make a client for the request, load what the page needs,
and send `QueryClient.dehydrate`'s result with the HTML:

```tsx
import * as ManagedRuntime from "effect/ManagedRuntime";

import { Query, QueryClient } from "@monarcode/effetch-query";
import {
  HydrationBoundary,
  QueryProvider,
} from "@monarcode/effetch-query/react";
import { renderToString } from "react-dom/server";

import { ApiClientLive } from "./api.js";
import { TodoList } from "./todo-list.js";
import { todos } from "./todos.js";

// Builds your services once, for every request's client to share.
const appRuntime = ManagedRuntime.make(ApiClientLive);

export async function renderPage(): Promise<string> {
  // One client per request, so one user's data never reaches another's page.
  const client = QueryClient.make({ runtime: appRuntime });
  try {
    await client.runPromise(Query.prefetch(todos()));
    const state = QueryClient.dehydrate(client);
    const html = renderToString(
      <QueryProvider client={client}>
        <HydrationBoundary state={state}>
          <TodoList />
        </HydrationBoundary>
      </QueryProvider>,
    );
    // `<` is escaped so a value can't close the script tag.
    const json = JSON.stringify(state).replace(/</g, "\\u003c");
    return `<div id="root">${html}</div>
<script id="query-state" type="application/json">${json}</script>`;
  } finally {
    await client.dispose();
  }
}
```

- **A client per request.** It's cheap: with a `runtime`, every request's
  client shares your services. `dispose()` releases it when the request is
  done.
- **Only queries with a schema are sent.** An effetch endpoint's `output`
  is its schema; a query of your own needs a `schema`
  ([Without effetch](#without-effetch)).
- **Values carry their timestamp,** so a query is as fresh in the browser
  as it was on the server. `dehydrate` never fetches: a stale query is sent
  stale, and refetches in the browser.
- **Failures stay on the server.** A failed query is left out, so server
  errors never reach the page, and the browser fetches it again. To send
  failures, pass `failures: "include"`. An effetch `HttpError` goes without
  its headers, but with its URL and response text, so keep secrets out of
  the URLs your server calls.
- **Keys must be JSON.** A key that isn't throws `NonJsonKeyError`, and two
  queries with one key throw `DuplicateQueryKeyError`.
- `queries: ["todos"]` sends only the queries under a key, as
  `Query.invalidate` matches them.

### Loading it in the browser

Render the same tree, under a `HydrationBoundary` given what the server
sent:

```tsx
import { QueryClient } from "@monarcode/effetch-query";
import {
  HydrationBoundary,
  QueryProvider,
} from "@monarcode/effetch-query/react";
import { hydrateRoot } from "react-dom/client";

import { queryClient } from "./client.js";
import { TodoList } from "./todo-list.js";

const state = JSON.parse(
  document.getElementById("query-state")?.textContent ?? "[]",
) as QueryClient.DehydratedState;

const root = document.getElementById("root");
if (root !== null) {
  hydrateRoot(
    root,
    <QueryProvider client={queryClient}>
      <HydrationBoundary state={state}>
        <TodoList />
      </HydrationBoundary>
    </QueryProvider>,
  );
}
```

The first render shows the server's values, so it matches the server's
HTML, and nothing is fetched until they're stale. A boundary can sit
anywhere, such as one per route, given each page's state as you navigate:
a query already cached takes the new value only if it's newer.

Without React, call `QueryClient.hydrate(client, state)` before reading the
queries.

### Streaming

With `pending: "promise"`, a query the server is still loading is sent as
a promise of its result. The browser waits for it instead of fetching, and
Suspense shows the query when it lands:

```ts
import { QueryClient } from "@monarcode/effetch-query";

declare const client: QueryClient.QueryClient;

export const state = QueryClient.dehydrate(client, { pending: "promise" });
```

A promise doesn't survive `JSON.stringify`: use it where your framework
streams promises to the browser, as the frameworks below do. Keep the
client until its promises settle. On a server that answers with a streamed
`Response`, `QueryClient.disposeAfter(client, response)` disposes the
client once the body has been sent.

## Frameworks

Each framework below builds on [Server rendering](#server-rendering). The
examples use `todos` and `TodoList` from there.

### TanStack Router and Start

`connectQueryClient`, from `@monarcode/effetch-query/react/tanstack-router`,
connects a client to a TanStack Router, and so to TanStack Start, as
TanStack's `setupRouterSsrQueryIntegration` does for TanStack Query. Install
`@tanstack/react-router` (or `@tanstack/react-start`), and call it where
the router is made:

```tsx router.tsx
import * as ManagedRuntime from "effect/ManagedRuntime";

import { Query, QueryClient } from "@monarcode/effetch-query";
import { connectQueryClient } from "@monarcode/effetch-query/react/tanstack-router";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";

import { ApiClientLive } from "./api.js";
import { TodoList } from "./todo-list.js";
import { todos } from "./todos.js";

const rootRoute = createRootRouteWithContext<{
  readonly queryClient: QueryClient.QueryClient;
}>()({ component: Outlet });

const todosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  // TanStack's `ensureQueryData`: the cached value while it's fresh.
  loader: ({ context }) => context.queryClient.runPromise(Query.fetch(todos())),
  component: TodoList,
});

// Builds your services once, for every request's client to share.
const appRuntime = ManagedRuntime.make(ApiClientLive);

// Start calls `getRouter` once per request on the server, and once in the
// browser, so each request gets its own client.
export function getRouter() {
  const queryClient = QueryClient.make({ runtime: appRuntime });
  const router = createRouter({
    routeTree: rootRoute.addChildren([todosRoute]),
    context: { queryClient },
    // Loaders always run, and the queries' staleTime decides what's fetched.
    defaultPreloadStaleTime: 0,
  });
  connectQueryClient({ router, queryClient });
  return router;
}
```

- **On the server**, what the loaders loaded goes with the page, and
  queries started while rendering stream in as they start. A loader can
  start a prefetch without awaiting it,
  `void context.queryClient.runPromiseExit(Query.prefetch(query))`, so the
  page renders at once and the value follows. The client is disposed when
  the request ends.
- **In the browser**, it all loads into the client before React hydrates:
  no `HydrationBoundary`, and nothing is fetched while it's fresh.
- **Preloading** a route on hover runs its loader, and `Query.fetch`
  fetches only what's stale.

A query or mutation that dies with the router's `redirect()` navigates
there. Make the redirect inside the Effect, so each run has its own, and
use `Effect.die`, so it stays out of the error type:

```ts
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { Query } from "@monarcode/effetch-query";
import { redirect } from "@tanstack/react-router";

import { ApiClient } from "./api.js";

const User = Schema.Struct({ name: Schema.String });

export const viewer = Query.make({
  key: ["viewer"],
  run: ApiClient.use((client) => client.get("/me", { output: User })).pipe(
    Effect.catchTag("HttpError", (error) =>
      error.status === 401
        ? Effect.die(redirect({ to: "/login" }))
        : Effect.fail(error),
    ),
  ),
  schema: { success: User },
});
```

In a loader, `runPromise` rejects with the redirect and the router follows
it, on the server too. Load a query that may redirect with `Query.fetch`:
a fetch that's only prefetched leaves the redirect to its readers, which
show it as a failure instead.

| Option            | What it does                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `dehydrate`       | `queries` to send only some queries, `failures: "include"` to send failures, as `QueryClient.dehydrate`. |
| `handleRedirects` | Default `true`: follow a `redirect()` a query or mutation fails or dies with, in the browser.            |
| `wrapQueryClient` | Default `true`: wrap the router's `Wrap` in a `QueryProvider` for the client.                            |

### Next.js

The App Router needs no integration package: the core and `./react` cover
it. Make each request's client for the server components with React's
`cache()`, and dispose it with Next's `after()`:

```ts query-client.ts
import * as ManagedRuntime from "effect/ManagedRuntime";

import { QueryClient } from "@monarcode/effetch-query";
import { after } from "next/server";
import { cache } from "react";

import { ApiClientLive } from "./api.js";

// Builds your services once, for every request's client to share.
const appRuntime = ManagedRuntime.make(ApiClientLive);

// Every server component of a request gets the same client. It's disposed
// once the response is sent, streamed results included.
export const getQueryClient = cache(() => {
  const client = QueryClient.make({ runtime: appRuntime });
  after(() => client.dispose());
  return client;
});
```

Call `getQueryClient` from server components only: React's `cache()`
memoizes only while it renders them. `import "server-only"` at the top of
the file makes importing it from a client component a build error.

A server component loads what the page needs, and passes it to the client
components under a `HydrationBoundary`. `TodoList` reads a query, so it's a
client component: mark it with `"use client"`, in a file of its own:

```tsx todo-list-view.tsx
"use client";

export { TodoList } from "./todo-list.js";
```

```tsx
import { Query, QueryClient } from "@monarcode/effetch-query";
import { HydrationBoundary } from "@monarcode/effetch-query/react";

import { getQueryClient } from "./query-client.js";
import { TodoList } from "./todo-list-view.js";
import { todos } from "./todos.js";

export default async function TodosPage() {
  const client = getQueryClient();
  await client.runPromise(Query.prefetch(todos()));
  return (
    <HydrationBoundary
      state={QueryClient.dehydrate(client, { pending: "promise" })}
    >
      <TodoList />
    </HydrationBoundary>
  );
}
```

The client components get their own client from a `QueryProvider` in the
root layout. The browser keeps one for the page's lifetime; on the server,
Next renders client components for every request, so each render gets its
own:

```tsx
"use client";

import * as ManagedRuntime from "effect/ManagedRuntime";

import { QueryClient } from "@monarcode/effetch-query";
import { QueryProvider } from "@monarcode/effetch-query/react";
import { type ReactNode, useState } from "react";

import { ApiClientLive } from "./api.js";

const appRuntime = ManagedRuntime.make(ApiClientLive);
let browserClient: QueryClient.QueryClient | undefined;

const getClient = () =>
  typeof window === "undefined"
    ? QueryClient.make({ runtime: appRuntime })
    : (browserClient ??= QueryClient.make({ runtime: appRuntime }));

// The root layout renders its children inside it.
export function Providers({ children }: { readonly children: ReactNode }) {
  const [client] = useState(getClient);
  return <QueryProvider client={client}>{children}</QueryProvider>;
}
```

- **A query still loading streams in** with `pending: "promise"`: start a
  prefetch without awaiting it,
  `void client.runPromiseExit(Query.prefetch(query))`, and the page renders
  at once. `runPromiseExit` never rejects, so a prefetch cut short when the
  client is disposed isn't an unhandled rejection.
- **On client navigation**, the page's state comes with its payload, and
  the boundary loads what's newer than the browser's cache.
- **A server render's client isn't disposed:** nothing says when React is
  done with it, so it's kept until its queries' `gcTime` passes. Making it
  from a `runtime`, as here, means it never builds services of its own.
- **Call Next's `redirect()` and `notFound()` from server components.** A
  query whose run calls one, inside `Effect.suspend`, makes `runPromise`
  reject with what it throws, and Next follows it. In a client component
  the failure is a `QueryFailure`, which Next doesn't recognise.
- **Keep queries out of `"use client"` files:** a server component that
  imports from one gets references to its exports, not the queries.

In the Pages Router, make a client per request in `getServerSideProps`,
return `QueryClient.dehydrate(client)` as a prop, dispose the client, and
render the page under a `HydrationBoundary` given that prop.

### React Router

React Router's framework mode needs no integration package either. A root
middleware gives each request its own client, which loaders read from the
router's context, and `QueryClient.disposeAfter` disposes it once the
response is sent:

```ts query-context.ts
import * as ManagedRuntime from "effect/ManagedRuntime";

import { QueryClient } from "@monarcode/effetch-query";
import {
  createContext,
  data,
  type MiddlewareFunction,
  type RouterContextProvider,
} from "react-router";

import { ApiClientLive } from "./api.js";

// Builds your services once per process, for every request's client.
const appRuntime = ManagedRuntime.make(ApiClientLive);

// `null` where the middleware didn't run: React Router runs none for a URL
// no route matches.
export const queryClientContext = createContext<QueryClient.QueryClient | null>(
  null,
);

/** The request's client, in a loader or action. */
export const getQueryClient = (
  context: Readonly<RouterContextProvider>,
): QueryClient.QueryClient => {
  const client = context.get(queryClientContext);
  if (client === null) {
    throw data("app/root.tsx doesn't export queryClientMiddleware", {
      status: 500,
    });
  }
  return client;
};

// React Router resumes middleware once the page's shell is ready, while the
// body still streams, so the client is disposed once the body is sent.
export const queryClientMiddleware: MiddlewareFunction<Response> = async (
  { context },
  next,
) => {
  const client = QueryClient.make({ runtime: appRuntime });
  context.set(queryClientContext, client);
  return QueryClient.disposeAfter(client, await next());
};
```

`app/root.tsx` exports it, so it runs for every request that runs a loader:

```ts
import { queryClientMiddleware } from "./query-context.js";

export const middleware = [queryClientMiddleware];
```

A route's loader prefetches into the request's client and returns its
state, which the route hands to a `HydrationBoundary`:

```tsx
import { Query, QueryClient } from "@monarcode/effetch-query";
import { HydrationBoundary } from "@monarcode/effetch-query/react";
import { type LoaderFunctionArgs, useLoaderData } from "react-router";

import { getQueryClient } from "./query-context.js";
import { TodoList } from "./todo-list.js";
import { todos } from "./todos.js";

export async function loader({ context }: LoaderFunctionArgs) {
  const client = getQueryClient(context);
  await client.runPromise(Query.prefetch(todos()));
  return { state: QueryClient.dehydrate(client, { pending: "promise" }) };
}

export default function TodosRoute() {
  const { state } = useLoaderData<typeof loader>();
  return (
    <HydrationBoundary state={state}>
      <TodoList />
    </HydrationBoundary>
  );
}
```

The server render uses the request's client too. Reveal the entries
(`npx react-router reveal`); `entry.server.tsx`'s `handleRequest` gets the
router's context as `loadContext`. Render this where it renders
`<ServerRouter>`:

```tsx
import { QueryProvider } from "@monarcode/effetch-query/react";
import {
  type EntryContext,
  type RouterContextProvider,
  ServerRouter,
} from "react-router";

import { queryClientContext } from "./query-context.js";

export function ServerApp(props: {
  readonly request: Request;
  readonly routerContext: EntryContext;
  readonly loadContext: RouterContextProvider;
}) {
  const client = props.loadContext.get(queryClientContext);
  const router = (
    <ServerRouter context={props.routerContext} url={props.request.url} />
  );
  return client === null ? (
    router
  ) : (
    <QueryProvider client={client}>{router}</QueryProvider>
  );
}
```

In `entry.client.tsx`, the browser gets one client for the page's
lifetime:

```tsx
import { QueryProvider } from "@monarcode/effetch-query/react";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import { queryClient } from "./client.js";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <QueryProvider client={queryClient}>
        <HydratedRouter />
      </QueryProvider>
    </StrictMode>,
  );
});
```

- **A query still loading streams in:** React Router streams the promises
  in loader data. Start a prefetch without awaiting it,
  `void client.runPromiseExit(Query.prefetch(query))`, and the page renders
  at once. One still loading at the entry's `streamTimeout` is fetched in
  the browser instead.
- **On navigation**, the loaders run through a `.data` request, which
  brings the page's state the same way. Each navigation runs them again,
  with a new client, so they refetch on the server whatever the browser
  has cached; where that's too much, export `shouldRevalidate` from the
  route, or a `clientLoader` that prefetches into the browser's client.
- **Redirect from loaders.** A query whose run dies with `redirect()`, made
  inside the Effect
  (`Effect.suspend(() => Effect.die(redirect("/login")))`), makes
  `runPromise` reject with the `Response`, and the router follows it. Load
  such a query with `Query.fetch` in the loader.

## The client

| Option      | What it does                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `layer`     | Provides your registered services. Built once, when first needed.                                                          |
| `memoMap`   | The `Layer.MemoMap` to build `layer` with, to share builds with your app's `ManagedRuntime`.                               |
| `runtime`   | Instead of `layer`: a `ManagedRuntime` that provides your services. The client uses it and doesn't dispose it.             |
| `signals`   | Focus and online signals. Default: `Signals.browser` (inert without a DOM). `Signals.none` turns them off.                 |
| `queries`   | `defaults` for every query, and the `onSuccess`, `onFailure` and `onSettled` hooks.                                        |
| `mutations` | `defaults` (`retry`, `concurrent`) for every mutation, and the `onMutate`, `onSuccess`, `onFailure` and `onSettled` hooks. |

| Member                                       | What it is                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `client.runPromise`, `client.runPromiseExit` | Run an Effect with the client, your services and `Reactivity`.                               |
| `client.registry`                            | The `AtomRegistry` holding the cache, for your own atoms.                                    |
| `client.dispose()`                           | Drops the cache, interrupts running fetches and closes the layer; resolves once that's done. |
| `QueryClient.layer(options)`                 | A client as a `Layer<QueryClient>`, disposed with its scope: for Effect programs and tests.  |

**App-wide hooks** run for every query or mutation, with your services:
for logging, error reporting, or signing out when a session expires.

```ts
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import { QueryClient } from "@monarcode/effetch-query";

import { ApiClientLive } from "./api.js";

export const queryClient = QueryClient.make({
  layer: ApiClientLive,
  queries: {
    defaults: { staleTime: "30 seconds", refetchOnFocus: false },
    onFailure: ({ key, cause }) =>
      Effect.logWarning("Query failed", key, Cause.pretty(cause)),
  },
  mutations: {
    // Runs after the mutation's own onFailure.
    onFailure: ({ cause }) =>
      Effect.logError("Mutation failed", Cause.pretty(cause)),
  },
});
```

Each runs once per fetch or run, after `retry`. Interruptions, such as a
component unmounting mid-fetch, never reach them.

**Sharing your runtime.** If your app already has a `ManagedRuntime` that
provides your services, give the client that instead of a layer. It uses
the runtime's services rather than building its own, and leaves the
runtime running when it's disposed:

```ts
import * as ManagedRuntime from "effect/ManagedRuntime";

import { QueryClient } from "@monarcode/effetch-query";

import { ApiClientLive } from "./api.js";

export const appRuntime = ManagedRuntime.make(ApiClientLive);

export const queryClient = QueryClient.make({ runtime: appRuntime });
```

Clients of one runtime share its `Reactivity`, so an invalidation by any of
them, or by a service the runtime built (an SQL client, say), refetches the
matching queries of all of them. No cached values cross between clients.
When a client needs services of its own on top of the runtime's, give it a
`layer` with the runtime's `memoMap` instead: what the runtime has built is
shared, not built again.

## Testing

Swap the real `HttpClient` for a fake one, and your queries run against
it. `QueryClient.layer` gives an Effect program a client, disposed when the
program ends:

```ts
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";

import { Query, QueryClient } from "@monarcode/effetch-query";

import { ApiClient, makeApiClient } from "./api.js";
import { todo } from "./todos.js";

// Answers every request with the same todo.
const FakeHttp = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({ id: 1, title: "Write tests", done: false }),
      ),
    ),
  ),
);

const ApiClientTest = Layer.effect(ApiClient)(makeApiClient).pipe(
  Layer.provide(FakeHttp),
);

export const test = Query.fetch(todo({ params: { id: 1 } })).pipe(
  Effect.provide(QueryClient.layer({ layer: ApiClientTest })),
);
```

In React tests, render under a `QueryProvider` with a fresh client, and
dispose it after each test. To control time (`staleTime`, `refetchInterval`,
`gcTime`), fake only the timers, and leave `setImmediate` real: Effect's
scheduler runs on it.

```ts
import { vi } from "vitest";

vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
```

## Coming from TanStack Query

| TanStack Query                                        | effetch-query                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `queryOptions({ queryKey, queryFn })`                 | `api.query(endpoint)`, or `Query.make` / `Query.family({ key, run })`                        |
| `useQuery`, `useSuspenseQuery`                        | Same names; they return an `AsyncResult`                                                     |
| `useMutation`, `mutationOptions`                      | `useMutation(api.mutation(endpoint, { … }))`, or `Mutation.make`                             |
| `getQueryData`, `setQueryData`                        | `Query.get`, `Query.set` / `Query.update` (Effects); `QueryClient.get(client, query)`        |
| `mutate(variables, { onSuccess, onError })`           | `run(variables, { onSuccess, onFailure })`                                                   |
| `ensureQueryData`, `prefetchQuery`                    | `Query.fetch`, `Query.prefetch`                                                              |
| `invalidateQueries`, `refetchQueries`, `resetQueries` | `Query.invalidate`, `Query.refetch`, `Query.reset`: a query, a family or a key prefix        |
| `useQueryErrorResetBoundary`                          | `useResetQueryFailure`                                                                       |
| `focusManager`, `onlineManager`                       | The client's `signals` (`Signals.browser`, `reactNativeSignals`)                             |
| `new QueryClient({ defaultOptions })`                 | `QueryClient.make({ queries: { defaults }, mutations: { defaults } })`                       |
| `QueryCache({ onError, onSuccess, onSettled })`       | `queries.onFailure`, `queries.onSuccess`, `queries.onSettled`                                |
| `MutationCache({ onMutate, onError, … })`             | `mutations.onMutate`, `mutations.onFailure`, …                                               |
| `select`                                              | `Atom.map`, `AsyncResult.map`                                                                |
| `enabled: false`                                      | `useQuery(null)`                                                                             |
| `placeholderData: keepPreviousData`                   | `useQuery(query, { keepPrevious: true })`                                                    |
| `retry: 3`                                            | `retry: Schedule` (default none)                                                             |
| `onMutate` returning a rollback context               | `optimistic`, undone automatically                                                           |
| `dehydrate`, `hydrate`, `HydrationBoundary`           | `QueryClient.dehydrate`, `QueryClient.hydrate`, `HydrationBoundary`; queries need a `schema` |
| `setupRouterSsrQueryIntegration`                      | `connectQueryClient` (`./react/tanstack-router`)                                             |
| `useInfiniteQuery`, `fetchNextPage`                   | `api.infiniteQuery`, `useInfiniteQuery`, `InfiniteQuery.fetchNextPage`                       |
| `getNextPageParam`, `getPreviousPageParam`            | `nextPageParam`, `previousPageParam` (return `undefined` / `null` for none)                  |
| `setQueriesData`                                      | `Query.update(family, (value, args) => …)`                                                   |
| `cancelQueries`, devtools                             | Not in 0.1                                                                                   |

## Reference

### API

| Import                                           | Exports                                                                                                                                                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@monarcode/effetch-query`                       | `Query`, `InfiniteQuery`, `Mutation`, `QueryClient` and `Signals` (namespaces), `QueryFailure`, `Register`                                                                                                                               |
| `@monarcode/effetch-query/react`                 | `QueryProvider`, `useQuery`, `useSuspenseQuery`, `useInfiniteQuery`, `useSuspenseInfiniteQuery`, `useMutation`, `useRefetch`, `useQueryClient`, `useResetQueryFailure`, `HydrationBoundary`, `QueryFailure`, `MissingQueryProviderError` |
| `@monarcode/effetch-query/react-native`          | `reactNativeSignals`                                                                                                                                                                                                                     |
| `@monarcode/effetch-query/react/tanstack-router` | `connectQueryClient`                                                                                                                                                                                                                     |
| `@monarcode/effetch-query/effetch`               | `endpoints`                                                                                                                                                                                                                              |

Every export is documented in its type declarations, with an example: your
editor's hover and "Go to Definition" show it.

### Limitations

- `effect/reactivity` is marked unstable in Effect 4, so effetch-query
  follows its changes. It's tested against Effect 4.1 and the newest 4.x.
- No `cancelQueries` and no devtools in 0.1.
- `gcTime` is per query, not per client: a query's atom is shared by every
  client.

## Examples

[`examples/`](examples) has complete programs, typechecked with the
package, and the full apps tested end to end in
[`test/examples/`](test/examples):

- [`effect-only.ts`](examples/effect-only/effect-only.ts): queries, the cache
  and mutations from Effect code, with no UI.
- [`basic/`](examples/basic): the smallest React app, with dummyjson.com's
  todos and an optimistic toggle.
- [`tanstack-start/`](examples/tanstack-start): a full TanStack Start app on
  effetch endpoints: sign-in, a user's todos, a list with "Load more", a
  streamed detail page and a missing one.
- [`tanstack-start-httpclient/`](examples/tanstack-start-httpclient): the
  same app on Effect's `HttpClient`, without effetch.
- [`react-router/`](examples/react-router): the same app in React Router's
  framework mode, on effetch endpoints.

Its [README](examples/README.md) walks through each one.

## Development

You need Node 24 and pnpm 10 (`corepack enable` picks the pinned version).

```bash
pnpm install
pnpm run check
```

| Script                | What it does                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run build`      | Builds `dist/` (ESM and `.d.ts`) with `tsc`.                                                                                    |
| `pnpm test`           | Runs the tests, the type tests and the examples' tests with Vitest.                                                             |
| `pnpm run typecheck`  | Typechecks `src`, `test` and each example.                                                                                      |
| `pnpm run lint`       | Lints with oxlint (`lint:effect` runs the Effect language service).                                                             |
| `pnpm run format`     | Formats with oxfmt (`format:check` only checks).                                                                                |
| `pnpm run check:docs` | Checks every public export has a description, `@example` and `@since`, and compiles every example in the JSDoc and this README. |
| `pnpm run smoke`      | Packs the package, installs it in a fresh project, typechecks and runs consumers, and checks go-to-definition and hovers.       |
| `pnpm run check`      | All of the above, plus publint and attw. CI runs it on every pull request.                                                      |

The pre-commit hook runs `lint` and `format:check`.

## License

[MIT](LICENSE)
