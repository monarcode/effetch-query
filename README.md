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

**Server state for [Effect](https://effect.website), the TanStack Query way.**
Turn any Effect into a cached query. Use it from React, refetch it when the
app comes back into focus, update it optimistically from a mutation, and
invalidate it by key. Errors and services stay typed from the definition to
the component.

Built on Effect 4's `effect/reactivity` (atoms) and `@effect/atom-react`. A
sibling of [`@monarcode/effetch`](https://github.com/monarcode/effetch), whose
endpoints turn into queries and mutations in one line.

> **Alpha.** effetch-query is in its `0.1.0-alpha.N` series: the API can
> still change before `0.1.0-rc.0`.

## Contents

- [Why effetch-query](#why-effetch-query)
  - [At a glance](#at-a-glance)
  - [What you get](#what-you-get)
- [Getting started](#getting-started)
  - [Install](#install)
  - [Your services](#your-services)
  - [Registering your services](#registering-your-services)
  - [A client](#a-client)
- [Queries](#queries)
  - [Defining queries](#defining-queries)
  - [Keys](#keys)
  - [Query options](#query-options)
  - [Freshness and refetching](#freshness-and-refetching)
- [Using the cache from Effect](#using-the-cache-from-effect)
- [Mutations](#mutations)
  - [Optimistic updates](#optimistic-updates)
  - [Mutation options](#mutation-options)
- [Infinite queries](#infinite-queries)
  - [Defining infinite queries](#defining-infinite-queries)
  - [Fetching pages](#fetching-pages)
  - [Infinite query options](#infinite-query-options)
- [React](#react)
  - [The provider](#the-provider)
  - [Reading queries](#reading-queries)
  - [Suspense and error boundaries](#suspense-and-error-boundaries)
  - [Running mutations](#running-mutations)
  - [Load more](#load-more)
  - [Pull to refresh](#pull-to-refresh)
  - [Atoms](#atoms)
- [React Native](#react-native)
- [With effetch](#with-effetch)
- [Server rendering](#server-rendering)
  - [Sending the cache](#sending-the-cache)
  - [Loading it in the browser](#loading-it-in-the-browser)
  - [Streaming](#streaming)
- [TanStack Router and Start](#tanstack-router-and-start)
- [Next.js](#nextjs)
- [The client](#the-client)
  - [Client options](#client-options)
  - [App-wide hooks](#app-wide-hooks)
  - [Sharing your runtime](#sharing-your-runtime)
- [Testing](#testing)
- [Coming from TanStack Query](#coming-from-tanstack-query)
- [Reference](#reference)
- [Examples](#examples)
- [Development](#development)
- [License](#license)

## Why effetch-query

Effect already describes a request well: its error type, the services it
needs, how to retry it. What it doesn't have is a cache that a UI reads
from: one fetch shared by every component that shows the same data, kept
fresh in the background, written to optimistically and invalidated after a
change. effetch-query adds that, with TanStack Query's model and Effect's
types.

### At a glance

```tsx
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { Mutation, Query } from "@monarcode/effetch-query";
import { useMutation, useQuery } from "@monarcode/effetch-query/react";

interface Todo {
  readonly id: number;
  readonly title: string;
  readonly done: boolean;
}

class TodoApi extends Context.Service<
  TodoApi,
  {
    readonly list: Effect.Effect<ReadonlyArray<Todo>>;
    readonly toggle: (todo: Todo) => Effect.Effect<Todo>;
  }
>()("TodoApi") {}

declare module "@monarcode/effetch-query" {
  interface Register {
    readonly services: TodoApi;
  }
}

// A cached query: any Effect, run with your services.
const todos = Query.make({
  key: ["todos"],
  run: TodoApi.use((api) => api.list),
  staleTime: "1 minute",
});

// A mutation that refetches the list once it succeeds.
const toggleTodo = Mutation.make({
  run: (todo: Todo) => TodoApi.use((api) => api.toggle(todo)),
  invalidates: [todos],
});

export function Todos() {
  const result = useQuery(todos);
  const toggle = useMutation(toggleTodo);

  return AsyncResult.match(result, {
    onInitial: () => <p>Loading…</p>,
    onFailure: () => <p>Couldn't load your todos.</p>,
    onSuccess: ({ value }) => (
      <ul>
        {value.map((todo) => (
          <li key={todo.id} onClick={() => void toggle.run(todo)}>
            {todo.done ? "✓" : "○"} {todo.title}
          </li>
        ))}
      </ul>
    ),
  });
}
```

### What you get

- **Any Effect is a query.** A query runs with your app's services, so it
  can call an HTTP client, a database or another query. Its error type
  reaches the component as is.
- **One fetch per key.** Components showing the same query share one fetch
  and one cached value. A query nobody uses is dropped after `gcTime`.
- **Fresh in the background.** Stale queries refetch when a component starts
  using them, when the app comes back into focus and when the device comes
  back online, on the web and in React Native.
- **Precise invalidation.** Invalidate one query, a family of queries, or
  every key under a prefix such as `["todos"]`.
- **Infinite queries.** "Load more" lists and infinite scroll, with cursors
  that stay consistent when the list changes underneath.
- **Optimistic updates that undo themselves.** Writes made in a mutation's
  `optimistic` step are rolled back if it fails.
- **Typed services.** You declare your services once. A query that needs a
  service you haven't registered is a compile error where it's defined, not
  a runtime one.
- **Effect first, React second.** Everything works from Effect code (`Query.fetch`,
  `Mutation.run`, `Query.invalidate`); the React hooks only subscribe.
- **Server rendering.** Render with data on the server, then pick up its
  cache in the browser, streamed or not. No global state: each client owns
  its cache and its layer, so one server process can make one per request.

## Getting started

### Install

```bash
pnpm add @monarcode/effetch-query effect
```

For React, add `@effect/atom-react` and `react` (19). For the effetch
adapter, add `@monarcode/effetch`. They're optional peer dependencies: the
core never imports them.

```bash
pnpm add @effect/atom-react react
pnpm add @monarcode/effetch
```

effetch-query needs `effect` 4.1 or later. It runs in browsers, React Native
(Hermes), Node 20+, Bun and Deno.

### Your services

Queries and mutations are Effects that use your app's services. The examples
in this guide use one, `TodoApi`:

```ts todo-api.ts
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";

export interface Todo {
  readonly id: number;
  readonly title: string;
  readonly done: boolean;
}

export interface TodoFilter {
  readonly done?: boolean | undefined;
}

export interface TodoPage {
  readonly todos: ReadonlyArray<Todo>;
  /** Where the next page starts, or null on the last page. */
  readonly nextCursor: number | null;
}

export class TodoNotFound extends Data.TaggedError("TodoNotFound")<{
  readonly id: number;
}> {}

export class TodoApi extends Context.Service<
  TodoApi,
  {
    readonly list: (filter: TodoFilter) => Effect.Effect<ReadonlyArray<Todo>>;
    readonly page: (
      filter: TodoFilter,
      cursor: number,
    ) => Effect.Effect<TodoPage>;
    readonly get: (id: number) => Effect.Effect<Todo, TodoNotFound>;
    readonly update: (
      id: number,
      patch: { readonly done: boolean },
    ) => Effect.Effect<Todo, TodoNotFound>;
  }
>()("TodoApi") {}

// Built over effetch, HttpClient, a database client: whatever your app uses.
export declare const TodoApiLive: Layer.Layer<TodoApi>;
```

### Registering your services

Tell effetch-query which services your queries run with, once, in any file
of your app:

```ts query-services.ts
import type { TodoApi } from "./todo-api.js";

declare module "@monarcode/effetch-query" {
  interface Register {
    readonly services: TodoApi;
  }
}
```

With several services, use a union (`TodoApi | UserApi`), or derive it from
the layer that provides them: `Layer.Success<typeof AppLayer>`.

From then on:

- A query or mutation that needs a service outside `Register["services"]`
  is a compile error where it's defined.
- A client must be given a layer that provides exactly those services.
- Definitions import only effetch-query and the services they use, never
  your app's runtime, so they can live next to the code that uses them.

Without the declaration, no services are registered, and any query that
needs one doesn't compile.

### A client

The client holds the cache and builds your layer, once, when a query first
needs it. Make one for your app:

```ts client.ts
import { QueryClient } from "@monarcode/effetch-query";

import { TodoApiLive } from "./todo-api.js";

export const queryClient = QueryClient.make({
  layer: TodoApiLive,
  queries: {
    defaults: { staleTime: "30 seconds" },
  },
});
```

On a server, make one per request and `dispose()` it when the request ends
([Server rendering](#server-rendering)). [The client](#the-client) has
every option.

## Queries

### Defining queries

`Query.make` defines one query. `Query.family` defines one query per
argument, such as a todo's id; arguments are compared by value, so
`todo(1) === todo(1)`.

```ts todos.ts
import * as Effect from "effect/Effect";

import { Mutation, Query } from "@monarcode/effetch-query";

import { type Todo, TodoApi, type TodoFilter } from "./todo-api.js";

export const todos = Query.family({
  key: ["todos", "list"],
  run: (filter: TodoFilter) => TodoApi.use((api) => api.list(filter)),
});
// todos({ done: false }): Query<ReadonlyArray<Todo>, never>

export const todo = Query.family({
  key: ["todos", "detail"],
  run: (id: number) => TodoApi.use((api) => api.get(id)),
  staleTime: "1 minute",
});
// todo(1): Query<Todo, TodoNotFound>

// A query can read another one: it refetches when that one changes.
export const openCount = Query.make({
  key: ["todos", "open-count"],
  run: (ctx) =>
    Effect.map(ctx.result(todos({ done: false })), (open) => open.length),
});

export const toggleTodo = Mutation.make({
  run: (current: Todo) =>
    TodoApi.use((api) => api.update(current.id, { done: !current.done })),
  optimistic: (current) =>
    Effect.andThen(
      Query.update(todo(current.id), (cached) => ({
        ...cached,
        done: !cached.done,
      })),
      // Every cached list, whatever its filter.
      Query.update(todos, (list) =>
        list.map((item) =>
          item.id === current.id ? { ...item, done: !item.done } : item,
        ),
      ),
    ),
  onSuccess: (updated) => Query.set(todo(updated.id), updated),
  invalidates: [todos],
});
```

Define queries at module level, like the schemas they return. A query is an
atom: it holds no data itself, and works with every client.

### Keys

A key is an array, and identifies a query in the cache. A family's key is
its `key` followed by the argument: `todos({ done: false })` is
`["todos", "list", { done: false }]`.

Keys are hierarchical. Invalidating `["todos"]` reaches every key that starts
with it, so put the broadest segment first. Segments are compared by value
(`Equal.equals`), so plain objects and arrays match by structure. Keep them
JSON-compatible (strings, numbers, booleans, `null`, arrays and plain
objects): [server rendering](#server-rendering) sends them to the browser.

### Query options

| Option               | Default    | What it does                                                                     |
| -------------------- | ---------- | -------------------------------------------------------------------------------- |
| `key`                | (required) | The key, or a family's root key.                                                 |
| `run`                | (required) | The Effect, or `(ctx) => Effect`; for a family, `(args, ctx) => Effect`.         |
| `staleTime`          | `0`        | How long a value counts as fresh (a `Duration.Input`, such as `"1 minute"`).     |
| `gcTime`             | 5 minutes  | How long a query nobody uses keeps its value.                                    |
| `retry`              | none       | A `Schedule` to retry failed fetches with.                                       |
| `refetchOnMount`     | `true`     | Refetch a stale query when a component starts using it.                          |
| `retryOnMount`       | `true`     | Refetch a failed query when a component starts using it.                         |
| `refetchOnFocus`     | `true`     | Refetch stale queries in use when the app comes back into focus.                 |
| `refetchOnReconnect` | `true`     | Refetch stale queries in use when the device comes back online.                  |
| `refetchInterval`    | none       | Refetch on this interval while the query is in use.                              |
| `reactivityKeys`     | none       | Also refetch when these `Reactivity` keys are invalidated (`effect/reactivity`). |

All but `key`, `run`, `gcTime` and `reactivityKeys` can be set for every
query with the client's `queries.defaults`; a query's own options win.

`retry` defaults to none, unlike TanStack Query's three retries: if your HTTP
client retries already (effetch has a retry plugin), the query shouldn't
retry again.

### Freshness and refetching

A query's value is fresh for `staleTime` after its fetch, then stale. A
stale value is still shown; it's refetched in the background when:

- a component starts using the query (`refetchOnMount`),
- the app comes back into focus (`refetchOnFocus`), or the device comes back
  online (`refetchOnReconnect`), for queries in use,
- it's invalidated, or its `refetchInterval` comes round.

While it refetches, the query keeps its value with `waiting: true`. A query
that failed is refetched when a component starts using it again
(`retryOnMount`).

## Using the cache from Effect

Every cache operation is an Effect that needs the `QueryClient` service.
Inside a query's `run` and a mutation's callbacks it's already there;
elsewhere, run the Effect with the client:

```ts
import * as Effect from "effect/Effect";

import { Query } from "@monarcode/effetch-query";

import { queryClient } from "./client.js";
import { todo, todos } from "./todos.js";

const openTodo = (id: number) =>
  Effect.gen(function* () {
    // The cached value if it's fresh, otherwise a fetch.
    const current = yield* Query.fetch(todo(id));
    // Warm the cache for the next screen, without waiting.
    yield* Query.prefetch(todos({ done: current.done }));
    return current;
  });

// In a router loader, an event handler, a test…
export const loadTodo = (id: number) => queryClient.runPromise(openTodo(id));

export const refreshAll = () =>
  queryClient.runPromise(Query.invalidate(["todos"]));
```

| Function                   | What it does                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `Query.fetch(query)`       | The value if fresh, otherwise a fetch. Joins a fetch already running. Fails as the query does. |
| `Query.prefetch(query)`    | Fetches if not fresh, and ignores the result.                                                  |
| `Query.get(query)`         | The cached value as an `Option`. Never fetches.                                                |
| `Query.set(query, value)`  | Writes a value, fresh as if just fetched (the client's hooks don't run).                       |
| `Query.update(query, f)`   | Writes `f(value)`; does nothing without a value.                                               |
| `Query.update(family, f)`  | Writes `f(value, args)` to every cached member of a family (TanStack's `setQueriesData`).      |
| `Query.invalidate(target)` | Marks queries stale: those in use refetch now, the rest when next used.                        |
| `Query.refetch(target)`    | Refetches the queries in use, and completes when they've settled.                              |
| `Query.reset(target)`      | Drops the values; queries in use fetch again.                                                  |

A **target** is a query (`todo(1)`), a family (`todos`: all its queries) or a
key (`["todos"]`: every query whose key starts with it).

## Mutations

A mutation is a change to server state: `run` makes it, and the options say
what to update afterwards. `toggleTodo` in [`todos.ts`](#defining-queries):

1. runs `optimistic`, which flips the cached todo, and the todo in every
   cached list, before the request,
2. runs `run`, the request,
3. on success, runs `onSuccess`, which writes the server's todo to the cache,
4. then invalidates `todos`, so every todo list refetches.

Run it from Effect code with `Mutation.run`, or from a component with
[`useMutation`](#running-mutations):

```ts
import { Mutation } from "@monarcode/effetch-query";

import { queryClient } from "./client.js";
import type { Todo } from "./todo-api.js";
import { toggleTodo } from "./todos.js";

export const toggle = (todo: Todo) =>
  queryClient.runPromise(Mutation.run(toggleTodo, todo));
```

A mutation invalidates nothing unless you say so: `invalidates` takes
targets, or a function of the result and the variables that returns them.

### Optimistic updates

`optimistic` runs before `run`, with the variables. Every `Query.set` and
`Query.update` it makes is recorded; if the mutation fails, they're undone,
newest first, before `onFailure` runs. A written value shows until the
next fetch settles, including while that fetch runs, so the old value never
flashes back in the meantime.

`Query.update` on a family writes every member that has a value, such as
each filter's list, and gives `f` the member's argument too. It writes only
that family's own queries, not every key under its prefix, and creates
none. Each member's write is undone on its own.

### Mutation options

| Option        | What it does                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------- |
| `run`         | `(variables) => Effect`: the change.                                                         |
| `optimistic`  | `(variables) => Effect`: cache writes to show right away, undone if the mutation fails.      |
| `onSuccess`   | `(value, variables) => Effect`, after a success.                                             |
| `onFailure`   | `(cause, variables) => Effect`, after a failure and the rollback.                            |
| `onSettled`   | `(exit, variables) => Effect`, after either.                                                 |
| `invalidates` | Targets to invalidate after `onSuccess`, or `(value, variables) => targets`.                 |
| `retry`       | A `Schedule` to retry `run` with. Default: the client's `mutations.defaults`, else none.     |
| `concurrent`  | `false`: within one `useMutation`, a new run interrupts the one in progress. Default `true`. |

The callbacks run with your services, and with `QueryClient`, so they can use
the cache.

## Infinite queries

An infinite query loads a list one page at a time, for "load more" buttons
and infinite scroll, as TanStack's `useInfiniteQuery`. Its value is every
page loaded so far, with the param each was fetched with:
`{ pages, pageParams }`.

### Defining infinite queries

`InfiniteQuery.make` and `InfiniteQuery.family` take a query's options, plus
where pages start and how to find the next one:

```ts todo-pages.ts
import { InfiniteQuery } from "@monarcode/effetch-query";

import { TodoApi, type TodoFilter } from "./todo-api.js";

export const todoPages = InfiniteQuery.family({
  key: ["todos", "pages"],
  initialPageParam: 0,
  run: (filter: TodoFilter, cursor) =>
    TodoApi.use((api) => api.page(filter, cursor)),
  // undefined or null: there's no next page.
  nextPageParam: (lastPage) => lastPage.nextCursor,
  staleTime: "1 minute",
});
// todoPages({ done: false }):
//   InfiniteQuery<TodoPage, never, number>, keyed ["todos", "pages", { done: false }]
```

An infinite query **is** a query, of `InfiniteData<TodoPage, number>`: the
cache API, invalidation, the client's defaults and `useQuery` work on it as
on any other. Invalidating `["todos"]` reaches it too.

### Fetching pages

The first fetch loads one page, from `initialPageParam`.
`InfiniteQuery.fetchNextPage` appends the page after the last one, and
`fetchPreviousPage` prepends the one before the first (with
`previousPageParam`):

```ts
import * as Effect from "effect/Effect";

import { InfiniteQuery } from "@monarcode/effetch-query";

import { queryClient } from "./client.js";
import { todoPages } from "./todo-pages.js";

export const loadMore = () =>
  queryClient.runPromise(
    Effect.map(InfiniteQuery.fetchNextPage(todoPages({})), (data) =>
      data.pages.flatMap((page) => page.todos),
    ),
  );
```

- On the last page (`nextPageParam` gives `undefined` or `null`), it
  returns the pages without fetching.
- While a next page is being fetched, a second call joins that fetch; while
  the query refetches, it waits, then fetches its page. Before the first
  page has loaded, it joins that first fetch.
- A write made while the page loads (an optimistic update, say) stays: the
  page is added to the pages shown when it lands.
- A page that fails keeps the loaded pages: the query becomes a `Failure`
  whose `previousSuccess` holds them, and `fetchNextPage` fails with the
  error.

A **refetch** (invalidation, focus, reconnect, a stale mount) fetches as
many pages as are loaded, one after the other, and shows them together. The
first starts from its stored param, and each later one from `nextPageParam`
of the page before it, so a list that changed underneath doesn't show
duplicates or gaps.

### Infinite query options

| Option              | What it does                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `run`               | `(pageParam, ctx) => Effect`; for a family, `(args, pageParam, ctx) => Effect`: one page.                                |
| `initialPageParam`  | The first page's param. Its type is the page param's type.                                                               |
| `nextPageParam`     | `(lastPage, pages, lastPageParam, pageParams) => param`: the next page's param, or `undefined` / `null` for none.        |
| `previousPageParam` | The same, from the first page: the previous page's. Without it, there's no previous page.                                |
| `maxPages`          | The most pages to keep. Past it, a page is dropped from the far end; give `previousPageParam` too, so it can load again. |
| the rest            | As for [queries](#query-options): `key`, `staleTime`, `retry` (for each page), `refetchOnFocus`, …                       |

To change pages in a mutation's `optimistic`, `Query.update` the whole
value: `Query.update(todoPages, (data) => ({ ...data, pages: … }))` writes
every cached member, and is undone like any other write.

## React

### The provider

Give the client to your app with `QueryProvider`:

```tsx App.tsx
import { QueryProvider } from "@monarcode/effetch-query/react";
import type * as React from "react";

import { queryClient } from "./client.js";

export function App({ children }: { readonly children: React.ReactNode }) {
  return <QueryProvider client={queryClient}>{children}</QueryProvider>;
}
```

### Reading queries

`useQuery` returns the query's `AsyncResult`: `Initial` before its first
value, `Success` with a value, or `Failure` with a `Cause`. Each has
`waiting`, true while a fetch runs.

```tsx
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { useQuery } from "@monarcode/effetch-query/react";

import { todo } from "./todos.js";

export function TodoTitle({ id }: { readonly id: number | null }) {
  // null: no query, nothing fetched (TanStack's `enabled: false`).
  const result = useQuery(id === null ? null : todo(id), {
    // Keep showing the last todo while the next one loads.
    keepPrevious: true,
  });

  return AsyncResult.matchWithError(result, {
    onInitial: () => <p>Loading…</p>,
    onError: (error) => <p>No todo {error.id}.</p>,
    onDefect: () => <p>Something went wrong.</p>,
    onSuccess: ({ value, waiting }) => (
      <h1 style={{ opacity: waiting ? 0.5 : 1 }}>{value.title}</h1>
    ),
  });
}
```

`error` is a `TodoNotFound`: the query's error type, as defined.

### Suspense and error boundaries

`useSuspenseQuery` suspends until the query has a value, and returns a
`Success`. A failure with no value to show is thrown to the nearest error
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
  const { value } = useSuspenseQuery(todo(id));
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

### Running mutations

`useMutation` gives a component its own state for a mutation: two components
using `toggleTodo` never share a pending or failed state.

```tsx
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { useMutation } from "@monarcode/effetch-query/react";

import type { Todo } from "./todo-api.js";
import { toggleTodo } from "./todos.js";

export function ToggleButton({ todo }: { readonly todo: Todo }) {
  const { result, run, reset } = useMutation(toggleTodo);

  return (
    <button
      disabled={result.waiting}
      onClick={async () => {
        const exit = await run(todo);
        if (Exit.isFailure(exit)) {
          setTimeout(reset, 3000);
        }
      }}
    >
      {AsyncResult.isFailure(result) ? "Failed" : todo.done ? "Undo" : "Done"}
    </button>
  );
}
```

`run` returns a `Promise` of the `Exit`, and never rejects. A run carries on
when the component unmounts, so its `onSuccess` and `invalidates` still
happen.

### Load more

`useInfiniteQuery` reads an infinite query as `useQuery` does, with controls
for the next and previous pages. `useSuspenseInfiniteQuery` suspends only
until the first page:

```tsx
import { useSuspenseInfiniteQuery } from "@monarcode/effetch-query/react";

import { todoPages } from "./todo-pages.js";

export function OpenTodos() {
  const { result, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useSuspenseInfiniteQuery(todoPages({ done: false }));

  return (
    <>
      <ul>
        {result.value.pages
          .flatMap((page) => page.todos)
          .map((todo) => (
            <li key={todo.id}>{todo.title}</li>
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
// React Native: <FlatList onEndReached={() => {
//   if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
// }} … />
```

The loaded pages stay shown while the next one loads: `isFetchingNextPage`
tells a page fetch from a refetch of every page. `fetchNextPage` returns a
`Promise` that never rejects: a failed page shows in `result`, which keeps
the pages. In React Native, call it from `FlatList`'s `onEndReached`.

### Pull to refresh

A query's `waiting` is also true for background refetches, which shouldn't
show a spinner. `useRefetch` refetches a target on demand, with a flag for
that refetch only:

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

Queries are atoms, and `QueryProvider` provides the client's registry to
`@effect/atom-react`, so its hooks share the cache. Derive values with
`Atom.map` (TanStack's `select`):

```tsx
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { todos } from "./todos.js";

const openTitles = Atom.map(
  todos({ done: false }),
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

Without a DOM there's no focus or online event, so pass React Native's to
the client with `reactNativeSignals`:

```ts
import { QueryClient } from "@monarcode/effetch-query";
import { reactNativeSignals } from "@monarcode/effetch-query/react-native";
import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";

import { TodoApiLive } from "./todo-api.js";

export const queryClient = QueryClient.make({
  layer: TodoApiLive,
  signals: reactNativeSignals({ AppState, NetInfo }),
});
```

Focus is the app coming back to the foreground, and online follows NetInfo's
`isConnected`. The package doesn't depend on `react-native` or NetInfo: it
takes them as arguments. Pull to refresh is [`useRefetch`](#pull-to-refresh).

With a Hermes older than its 2026 releases, `FinalizationRegistry` is
missing, so a family keeps a small definition (about 2 KB) for every
argument it has seen, for the app's lifetime. Cached values are still
dropped after `gcTime`; this only matters for a family with many thousands
of arguments in one session, such as one keyed by free-text search.

## With effetch

`@monarcode/effetch-query/effetch` turns
[effetch](https://github.com/monarcode/effetch) endpoints into queries and
mutations. Give `endpoints` the service that holds your effetch client:

```ts
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";

import * as Fetch from "@monarcode/effetch";
import { Query } from "@monarcode/effetch-query";
import { endpoints } from "@monarcode/effetch-query/effetch";

const ApiError = Schema.Struct({ message: Schema.String });

class AppApi extends Context.Service<
  AppApi,
  Fetch.Client<[], typeof ApiError>
>()("AppApi") {}

declare module "@monarcode/effetch-query" {
  interface Register {
    readonly services: AppApi;
  }
}

const Todo = Schema.Struct({
  id: Schema.Finite,
  title: Schema.String,
  done: Schema.Boolean,
});

const api = endpoints(AppApi, { defaultError: ApiError });

export const todo = api.query(
  Fetch.endpoint("GET /todos/:id", { output: Todo }),
  { staleTime: "1 minute" },
);
// todo({ params: { id: 1 } }): Query<Todo, NetworkError | DecodeError
//   | HttpError.With<{ message: string }>>, keyed ["todos", 1]

export const todos = api.query(
  Fetch.endpoint("GET /todos", { output: Schema.Array(Todo) }),
);
// todos({ query: { done: false } }): keyed ["todos", { done: false }]

export const toggleTodo = api.mutation(
  Fetch.endpoint("PATCH /todos/:id", {
    input: Schema.Struct({ done: Schema.Boolean }),
    output: Todo,
  }),
  { invalidates: [["todos"]] },
);
// run with { params: { id: 1 }, body: { done: true } }

export const todoPages = api.infiniteQuery(
  Fetch.endpoint("GET /todos", {
    output: Schema.Struct({
      todos: Schema.Array(Todo),
      nextCursor: Schema.NullOr(Schema.String),
    }),
  }),
  {
    // Each page's param is sent as ?cursor=…, and left out of the key.
    pageParam: "cursor",
    initialPageParam: null as string | null,
    nextPageParam: (lastPage) => lastPage.nextCursor,
  },
);
// todoPages({ query: { done: false } }): keyed ["todos", { done: false }]

export const refreshTodo = Query.refetch(todo);
```

- **Keys come from the route:** the path with its params filled in, then the
  query object. Invalidating `["todos"]` reaches every todos endpoint.
  `endpoints(Client, { key: ["wallet"] })` puts a prefix before every key,
  for a second backend with the same paths.
- **As a target, an endpoint query matches its own queries only:**
  `Query.refetch(todo)` doesn't refetch `GET /todos` or `GET /todos/:id/comments`.
- **Errors are typed from the endpoint and the client:** `HttpError` with the
  decoded error body, `DecodeError` when there's an `output`, `NetworkError`,
  and your plugins' errors.
- **`query` takes endpoints without a body** (`GET`, `HEAD`, `OPTIONS`,
  `TRACE`); everything else is a `mutation`, whose variables are the call's
  options. A mutation invalidates nothing unless you say so.
- **`infiniteQuery` pages through an endpoint without a body:**
  `pageParam` names the query field each page's param is sent in.
- **Endpoint queries render on the server** with no `schema` to write,
  when the endpoint has an `output`: it encodes the value, and effetch's
  errors are sent with `failures: "include"`: an `HttpError` without its
  headers, but with its request URL and response text, so keep secrets out
  of the URLs your server calls. A query that failed with a plugin's error
  isn't sent.
- Pass `headers` and `plugins` as options of `query`, `infiniteQuery` and
  `mutation`, as with `client.bind`.

## Server rendering

Render a page on the server with its data, then pick it up in the browser
without fetching that data again. It works with any React server renderer
(`renderToString`, `renderToPipeableStream`, a framework's), and without
React through `QueryClient.hydrate`.

### Sending the cache

A query crosses from server to browser when it has a `schema`: it encodes
the value for the page and decodes it in the browser. Give it a
`staleTime` too, so the browser doesn't refetch what the server just
loaded:

```tsx todo-list.tsx
import * as Schema from "effect/Schema";

import { Query } from "@monarcode/effetch-query";
import { useSuspenseQuery } from "@monarcode/effetch-query/react";

import { TodoApi } from "./todo-api.js";

const Todo = Schema.Struct({
  id: Schema.Finite,
  title: Schema.String,
  done: Schema.Boolean,
});

export const todoList = Query.make({
  key: ["todos", "list"],
  run: TodoApi.use((api) => api.list({})),
  schema: { success: Schema.Array(Todo) },
  staleTime: "1 minute",
});

export function TodoList() {
  const { value } = useSuspenseQuery(todoList);
  return (
    <ul>
      {value.map((todo) => (
        <li key={todo.id}>{todo.title}</li>
      ))}
    </ul>
  );
}
```

On the server, make a client per request, load what the page needs, and
send `QueryClient.dehydrate`'s result with the HTML:

```tsx
import * as ManagedRuntime from "effect/ManagedRuntime";

import { Query, QueryClient } from "@monarcode/effetch-query";
import {
  HydrationBoundary,
  QueryProvider,
} from "@monarcode/effetch-query/react";
import { renderToString } from "react-dom/server";

import { TodoApiLive } from "./todo-api.js";
import { TodoList, todoList } from "./todo-list.js";

// Builds your services once per process, for every request's client.
const appRuntime = ManagedRuntime.make(TodoApiLive);

export async function renderPage(): Promise<string> {
  // One client per request, so one user's data never reaches another's page.
  const client = QueryClient.make({ runtime: appRuntime });
  try {
    await client.runPromise(Query.prefetch(todoList));
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

- **Only queries with a `schema` are sent.** An effetch endpoint with an
  `output` needs none: its `output` is its schema
  ([With effetch](#with-effetch)).
- **Values are sent with their timestamp,** so a query is as fresh in the
  browser as it was on the server. `dehydrate` never fetches: a stale query
  is sent stale, and refetches in the browser.
- **Keys must be JSON**, as [Keys](#keys) says. A key that isn't throws
  `NonJsonKey`, and two queries with one key throw `DuplicateQueryKey`.
- **Failures stay on the server.** A failed query is left out and fetched
  again in the browser, so server errors never reach the page. To send
  them, pass `failures: "include"` and give the query a `schema.error`.
- `queries: ["todos"]` sends only the queries under a key prefix, as
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

import { TodoApiLive } from "./todo-api.js";
import { TodoList } from "./todo-list.js";

const state = JSON.parse(
  document.getElementById("query-state")?.textContent ?? "[]",
) as QueryClient.DehydratedState;

const queryClient = QueryClient.make({ layer: TodoApiLive });

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
anywhere in the tree, such as one per route, given each page's state as
you navigate: a query already cached takes the new value only if it's
newer, after React commits the page that brought it.

Without React, call `QueryClient.hydrate(client, state)` before reading the
queries.

### Streaming

With `pending: "promise"`, a query the server is still loading is sent as
a promise of its result. The browser waits for that promise instead of
fetching, and Suspense shows the query when it arrives:

```ts
import { QueryClient } from "@monarcode/effetch-query";

declare const client: QueryClient.QueryClient;

export const state = QueryClient.dehydrate(client, { pending: "promise" });
```

A promise doesn't survive `JSON.stringify`: use it where your framework
sends promises to the browser, such as React Server Components' props.
Dispose the client once its promises settle; a promise still pending at
`dispose()` resolves to nothing, and the browser fetches that query.

## TanStack Router and Start

`connectQueryClient` from `@monarcode/effetch-query/react/tanstack-router`
connects a client to a TanStack Router, and so to TanStack Start, as
TanStack's `setupRouterSsrQueryIntegration` does for TanStack Query. Install
`@tanstack/react-router` (or `@tanstack/react-start`) alongside, and call it
where the router is made:

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

import { TodoApiLive } from "./todo-api.js";
import { TodoList, todoList } from "./todo-list.js";

const rootRoute = createRootRouteWithContext<{
  readonly queryClient: QueryClient.QueryClient;
}>()({ component: Outlet });

const todosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  // TanStack's `ensureQueryData`: the cached value while it's fresh.
  loader: ({ context }) =>
    context.queryClient.runPromise(Query.fetch(todoList)),
  component: TodoList,
});

// Builds your app's layer (TodoApiLive here, or all your services merged)
// once per process, for every request's client to share.
const appRuntime = ManagedRuntime.make(TodoApiLive);

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

- **On the server**, what the loaders loaded goes with the page. Queries
  started while rendering follow as they start, those still loading as
  promises the browser waits for: an unawaited
  `void context.queryClient.runPromise(Query.prefetch(query))` in a loader
  lets the page render at once, and the value streams in. The client is
  disposed when the request ends.
- **Your app's layer is built once per process** when every request's
  client uses one `ManagedRuntime`. A client given a `layer` instead
  builds it per request (a database pool, say) and releases it when the
  client is disposed.
- **In the browser**, it all loads into the client before React hydrates:
  no `HydrationBoundary`, and nothing is fetched while it's fresh. Only
  queries with a `schema` cross ([Server rendering](#server-rendering)).
- **Preloading** a route on hover runs its loader, and `Query.fetch` fetches
  only what's stale. With the router's default `defaultPreloadStaleTime`,
  the router would skip loaders for 30 seconds on its own.

A query or mutation that fails or dies with the router's `redirect()`
navigates there in the browser. Use `Effect.die`, so the redirect stays out
of the error type, and make it inside the Effect, so each run has its own:
the router resolves a redirect in place. In a loader, `runPromise` rejects
with it, and the router follows it, on the server too. A fetch an Effect
awaits is left to that Effect, so a preload drops the redirect, as the
router does, and a query only prefetched fails in its readers instead: load
a query that may redirect with `Query.fetch`.

```ts
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { Query } from "@monarcode/effetch-query";
import { redirect } from "@tanstack/react-router";

declare const signedInUser: Effect.Effect<string | null>;

export const viewer = Query.make({
  key: ["viewer"],
  run: Effect.flatMap(signedInUser, (name) =>
    name === null
      ? Effect.die(redirect({ to: "/login" }))
      : Effect.succeed(name),
  ),
  schema: { success: Schema.String },
});
```

| Option            | What it does                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `dehydrate`       | `queries` to send only some queries, `failures: "include"` to send failures, as `QueryClient.dehydrate`. |
| `handleRedirects` | Default `true`: follow a `redirect()` a query or mutation fails or dies with, in the browser.            |
| `wrapQueryClient` | Default `true`: wrap the router's `Wrap` in a `QueryProvider` for the client.                            |

## Next.js

The App Router needs no integration package: the core and `./react` cover
it, as TanStack Query's do. Make each request's client for the server
components with React's `cache()`, and dispose it with Next's `after()`:

```ts query-client.ts
import * as ManagedRuntime from "effect/ManagedRuntime";

import { QueryClient } from "@monarcode/effetch-query";
import { after } from "next/server";
import { cache } from "react";

import { TodoApiLive } from "./todo-api.js";

// Builds your services once per process, for every request's client.
const appRuntime = ManagedRuntime.make(TodoApiLive);

// Every server component of a request gets the same client. It's disposed
// once the response is sent, streamed results included, or after an error,
// `redirect()` or `notFound()`.
export const getQueryClient = cache(() => {
  const client = QueryClient.make({ runtime: appRuntime });
  after(() => client.dispose());
  return client;
});
```

Disposing matters more than with TanStack Query: a client holds a
registry, the fetches it's running and, given a `layer` rather than a
`runtime`, the services it built, and `dispose()` releases them. Call
`getQueryClient` from server components only: React's `cache()` memoizes
only while it renders them, so a Route Handler or Server Action gets a new
client on every call. `import "server-only"` at the top of the file makes
importing it from a client component a build error.

A server component loads what the page needs and passes it to the client
components under a `HydrationBoundary`. Client components are the ones in
a `"use client"` file, such as this one, which marks `TodoList` from
[Sending the cache](#sending-the-cache):

```tsx todo-list-view.tsx
"use client";

export { TodoList } from "./todo-list.js";
```

```tsx
import { Query, QueryClient } from "@monarcode/effetch-query";
import { HydrationBoundary } from "@monarcode/effetch-query/react";

import { getQueryClient } from "./query-client.js";
import { TodoList } from "./todo-list-view.js";
import { todoList } from "./todo-list.js";

export default async function TodosPage() {
  const client = getQueryClient();
  await client.runPromise(Query.prefetch(todoList));
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
root layout. The browser keeps one for the page's lifetime, but Next
renders client components on the server too, for every request, so there
each render gets its own:

```tsx
"use client";

import * as ManagedRuntime from "effect/ManagedRuntime";

import { QueryClient } from "@monarcode/effetch-query";
import { QueryProvider } from "@monarcode/effetch-query/react";
import { type ReactNode, useState } from "react";

import { TodoApiLive } from "./todo-api.js";

const appRuntime = ManagedRuntime.make(TodoApiLive);
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

- **A server render's client isn't disposed:** nothing says when React is
  done with it, so it's kept until its queries' `gcTime` passes. Make it
  from a `runtime`, as here, so it never builds your services itself.
- **A query still loading crosses as a promise** with
  `pending: "promise"`, and the client components' readers suspend until
  it lands. Start a prefetch without awaiting it,
  `void client.runPromise(Query.prefetch(query))`, and the page renders at
  once while the value streams in.
- **On client navigation**, the page's state comes with its payload, and
  the boundary loads what's newer than the browser's cache. Only queries
  with a `schema` cross ([Server rendering](#server-rendering)).
- **Next's `redirect()` and `notFound()` throw.** A query whose run calls
  one, inside `Effect.suspend`, dies with what it throws: in a server
  component, `runPromise` rejects with it, and Next follows it. In a
  client component, `useSuspenseQuery` rethrows it, as it does any error
  with a string `digest`, so Next's boundaries handle it there too.
- **Keep queries out of `"use client"` files:** a server component that
  imports from one gets references to its exports, not the queries.

The Pages Router has no server components: make a client per request in
`getServerSideProps`, return `QueryClient.dehydrate(client)` as a prop,
dispose the client, and render the page under a `HydrationBoundary` given
that prop, as [Server rendering](#server-rendering) does.

## The client

### Client options

| Option      | What it does                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `layer`     | Provides your registered services. Built once, when first needed.                                                          |
| `memoMap`   | The `Layer.MemoMap` to build `layer` with, to share builds with your app's `ManagedRuntime`.                               |
| `runtime`   | Instead of `layer`: a `ManagedRuntime` that provides your services. The client uses them and doesn't dispose it.           |
| `signals`   | Focus and online signals. Default: `Signals.browser` (inert without a DOM). `Signals.none` turns them off.                 |
| `queries`   | `defaults` for every query, and the `onSuccess`, `onFailure` and `onSettled` hooks.                                        |
| `mutations` | `defaults` (`retry`, `concurrent`) for every mutation, and the `onMutate`, `onSuccess`, `onFailure` and `onSettled` hooks. |

| Member                                       | What it is                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `client.runPromise`, `client.runPromiseExit` | Run an Effect that needs `QueryClient`, your services and `Reactivity`.                      |
| `client.registry`                            | The `AtomRegistry` holding the cache, for your own atoms.                                    |
| `client.dispose()`                           | Drops the cache, interrupts running fetches and closes the layer; resolves once that's done. |
| `QueryClient.layer(options)`                 | A client as a `Layer<QueryClient>`, disposed with its scope: for Effect programs and tests.  |

### App-wide hooks

The client's hooks run for every query or mutation, with your services. Use
them for logging, error reporting, or signing out when a session expires:

```ts
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import { QueryClient } from "@monarcode/effetch-query";

import { TodoApiLive } from "./todo-api.js";

export const queryClient = QueryClient.make({
  layer: TodoApiLive,
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

### Sharing your runtime

If your app has a `ManagedRuntime` that provides your services, give it to
the client in place of a layer. The client uses the runtime's services
rather than building its own, and leaves the runtime running when it's
disposed, so every client of one runtime, such as one per request on a
server, shares one build:

```ts
import * as ManagedRuntime from "effect/ManagedRuntime";

import { QueryClient } from "@monarcode/effetch-query";

import { TodoApiLive } from "./todo-api.js";

export const appRuntime = ManagedRuntime.make(TodoApiLive);

export const queryClient = QueryClient.make({ runtime: appRuntime });
```

The clients share the runtime's `Reactivity`, so an invalidation by any of
them, or by a service the runtime built (an SQL client, say), refetches
the matching queries of all of them. No cached values cross between
clients.

When a client needs services of its own on top of the runtime's, such as
the viewer of one request, give it a `layer` with the runtime's `memoMap`
instead: layers the runtime has already built are shared rather than built
again. The [SSR example](examples/ssr/server.tsx) does this.

## Testing

Give a test client a layer of fakes. `QueryClient.layer` makes one for an
Effect program, disposed when the program ends:

```ts
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Query, QueryClient } from "@monarcode/effetch-query";

import { TodoApi } from "./todo-api.js";
import { todo } from "./todos.js";

const first = { id: 1, title: "Write tests", done: false };

const TodoApiTest = Layer.succeed(TodoApi, {
  list: () => Effect.succeed([first]),
  page: () => Effect.succeed({ todos: [first], nextCursor: null }),
  get: () => Effect.succeed(first),
  update: (_, patch) => Effect.succeed({ ...first, ...patch }),
});

export const test = Query.fetch(todo(1)).pipe(
  Effect.provide(QueryClient.layer({ layer: TodoApiTest })),
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
| `queryOptions({ queryKey, queryFn })`                 | `Query.make` / `Query.family({ key, run })`                                                  |
| `useQuery`, `useSuspenseQuery`                        | Same names; they return an `AsyncResult`                                                     |
| `useMutation`, `mutationOptions`                      | `useMutation(Mutation.make({ … }))`                                                          |
| `getQueryData`, `setQueryData`                        | `Query.get`, `Query.set` / `Query.update` (Effects)                                          |
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
| `useInfiniteQuery`, `fetchNextPage`                   | `InfiniteQuery.family`, `useInfiniteQuery`, `InfiniteQuery.fetchNextPage`                    |
| `getNextPageParam`, `getPreviousPageParam`            | `nextPageParam`, `previousPageParam` (return `undefined` / `null` for none)                  |
| `setQueriesData`                                      | `Query.update(family, (value, args) => …)`                                                   |
| `cancelQueries`, devtools                             | Not in 0.1                                                                                   |

## Reference

### API

| Import                                           | Exports                                                                                                                                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@monarcode/effetch-query`                       | `Query`, `InfiniteQuery`, `Mutation`, `QueryClient` and `Signals` (namespaces), `QueryFailure`, `Register`                                                                                                                          |
| `@monarcode/effetch-query/react`                 | `QueryProvider`, `useQuery`, `useSuspenseQuery`, `useInfiniteQuery`, `useSuspenseInfiniteQuery`, `useMutation`, `useRefetch`, `useQueryClient`, `useResetQueryFailure`, `HydrationBoundary`, `QueryFailure`, `MissingQueryProvider` |
| `@monarcode/effetch-query/react-native`          | `reactNativeSignals`                                                                                                                                                                                                                |
| `@monarcode/effetch-query/react/tanstack-router` | `connectQueryClient`                                                                                                                                                                                                                |
| `@monarcode/effetch-query/effetch`               | `endpoints`                                                                                                                                                                                                                         |

Every export is documented in its type declarations, with an example: your
editor's hover and "Go to Definition" show it.

### Limitations

- `effect/reactivity` is marked unstable in Effect 4, so effetch-query
  follows its changes. It's tested against Effect 4.1 and the newest 4.x.
- No `cancelQueries` and no devtools in 0.1.
- `gcTime` is per query, not per client: a query's atom is shared by every
  client.

## Examples

[`examples/`](examples) has complete programs, typechecked and tested with
the package:

- [`effect-only.ts`](examples/effect-only/effect-only.ts): queries, the cache
  and mutations from Effect code, with no UI.
- [`todos/`](examples/todos): a React app over effetch endpoints: a list
  with "load more", a detail view, an optimistic toggle that updates every
  page, a missing todo with a retry button and a refresh button, with tests
  that drive it.
- [`ssr/`](examples/ssr): a page rendered on the server with a client per
  request, then hydrated in the browser without a fetch.
- [`tanstack-start/`](examples/tanstack-start): a TanStack Start app with
  loaders, a streamed detail page and a redirect, built and served by its
  tests, then hydrated without a fetch.

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
