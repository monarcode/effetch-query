<h1>
  <img
    src="https://github.com/monarcode/effetch-query/raw/main/assets/banner.png"
    alt="Effetch Query: effectful queries and mutations for Effect 4, inspired by TanStack Query"
    width="100%"
  />
</h1>

[![npm](https://img.shields.io/npm/v/@monarcode/effetch-query)](https://www.npmjs.com/package/@monarcode/effetch-query)
[![CI](https://github.com/monarcode/effetch-query/actions/workflows/ci.yml/badge.svg)](https://github.com/monarcode/effetch-query/actions/workflows/ci.yml)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@monarcode/effetch-query)](https://bundlephobia.com/package/@monarcode/effetch-query)

**Server state for [Effect](https://effect.website), the TanStack Query way.**
Turn any Effect into a cached query. Use it from React, refetch it when the
app comes back into focus, update it optimistically from a mutation, and
invalidate it by key. Errors and services stay typed from the definition to
the component.

Built on Effect 4's `effect/reactivity` (atoms) and `@effect/atom-react`. A
sibling of [`@monarcode/effetch`](https://github.com/monarcode/effetch), whose
endpoints turn into queries and mutations in one line.

> **Alpha.** effetch-query is in its `0.1.0-alpha.N` series: the API can
> still change before `0.1.0-rc.0`. Server rendering, hydration and infinite
> queries land during the alpha series.

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
- [React](#react)
  - [The provider](#the-provider)
  - [Reading queries](#reading-queries)
  - [Suspense and error boundaries](#suspense-and-error-boundaries)
  - [Running mutations](#running-mutations)
  - [Pull to refresh](#pull-to-refresh)
  - [Atoms](#atoms)
- [React Native](#react-native)
- [With effetch](#with-effetch)
- [The client](#the-client)
  - [Client options](#client-options)
  - [App-wide hooks](#app-wide-hooks)
  - [Sharing layers with your runtime](#sharing-layers-with-your-runtime)
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
- **Optimistic updates that undo themselves.** Writes made in a mutation's
  `optimistic` step are rolled back if it fails.
- **Typed services.** You declare your services once. A query that needs a
  service you haven't registered is a compile error where it's defined, not
  a runtime one.
- **Effect first, React second.** Everything works from Effect code (`Query.fetch`,
  `Mutation.run`, `Query.invalidate`); the React hooks only subscribe.
- **Server-safe.** No global state: each client owns its cache and its
  layer, so one server process can make one per request.

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

export class TodoNotFound extends Data.TaggedError("TodoNotFound")<{
  readonly id: number;
}> {}

export class TodoApi extends Context.Service<
  TodoApi,
  {
    readonly list: (filter: TodoFilter) => Effect.Effect<ReadonlyArray<Todo>>;
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

On a server, make one per request and `dispose()` it when the request ends.
[The client](#the-client) has every option.

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
    Query.update(todo(current.id), (cached) => ({
      ...cached,
      done: !cached.done,
    })),
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
objects): server rendering will send them to the browser.

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
| `Query.invalidate(target)` | Marks queries stale: those in use refetch now, the rest when next used.                        |
| `Query.refetch(target)`    | Refetches the queries in use, and completes when they've settled.                              |
| `Query.reset(target)`      | Drops the values; queries in use fetch again.                                                  |

A **target** is a query (`todo(1)`), a family (`todos`: all its queries) or a
key (`["todos"]`: every query whose key starts with it).

## Mutations

A mutation is a change to server state: `run` makes it, and the options say
what to update afterwards. `toggleTodo` in [`todos.ts`](#defining-queries):

1. runs `optimistic`, which flips the cached todo before the request,
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
- Pass `headers` and `plugins` as options of `query` and `mutation`, as with
  `client.bind`.

## The client

### Client options

| Option      | What it does                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `layer`     | Provides your registered services. Built once, when first needed.                                                          |
| `memoMap`   | A `Layer.MemoMap` to share layer builds with your app's `ManagedRuntime`.                                                  |
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

### Sharing layers with your runtime

If your app also has a `ManagedRuntime` for the same layer, pass its
`memoMap`, so each layer is built once and shared:

```ts
import * as ManagedRuntime from "effect/ManagedRuntime";

import { QueryClient } from "@monarcode/effetch-query";

import { TodoApiLive } from "./todo-api.js";

export const appRuntime = ManagedRuntime.make(TodoApiLive);

export const queryClient = QueryClient.make({
  layer: TodoApiLive,
  memoMap: appRuntime.memoMap,
});
```

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

| TanStack Query                                        | effetch-query                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `queryOptions({ queryKey, queryFn })`                 | `Query.make` / `Query.family({ key, run })`                                           |
| `useQuery`, `useSuspenseQuery`                        | Same names; they return an `AsyncResult`                                              |
| `useMutation`, `mutationOptions`                      | `useMutation(Mutation.make({ … }))`                                                   |
| `getQueryData`, `setQueryData`                        | `Query.get`, `Query.set` / `Query.update` (Effects)                                   |
| `ensureQueryData`, `prefetchQuery`                    | `Query.fetch`, `Query.prefetch`                                                       |
| `invalidateQueries`, `refetchQueries`, `resetQueries` | `Query.invalidate`, `Query.refetch`, `Query.reset`: a query, a family or a key prefix |
| `useQueryErrorResetBoundary`                          | `useResetQueryFailure`                                                                |
| `focusManager`, `onlineManager`                       | The client's `signals` (`Signals.browser`, `reactNativeSignals`)                      |
| `new QueryClient({ defaultOptions })`                 | `QueryClient.make({ queries: { defaults }, mutations: { defaults } })`                |
| `QueryCache({ onError, onSuccess, onSettled })`       | `queries.onFailure`, `queries.onSuccess`, `queries.onSettled`                         |
| `MutationCache({ onMutate, onError, … })`             | `mutations.onMutate`, `mutations.onFailure`, …                                        |
| `select`                                              | `Atom.map`, `AsyncResult.map`                                                         |
| `enabled: false`                                      | `useQuery(null)`                                                                      |
| `placeholderData: keepPreviousData`                   | `useQuery(query, { keepPrevious: true })`                                             |
| `retry: 3`                                            | `retry: Schedule` (default none)                                                      |
| `onMutate` returning a rollback context               | `optimistic`, undone automatically                                                    |
| `dehydrate`, `hydrate`, `HydrationBoundary`           | Coming during the alpha series                                                        |
| `useInfiniteQuery`                                    | Coming during the alpha series                                                        |
| `cancelQueries`, devtools                             | Not in 0.1                                                                            |

## Reference

### API

| Import                                  | Exports                                                                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@monarcode/effetch-query`              | `Query`, `Mutation`, `QueryClient` and `Signals` (namespaces), `QueryFailure`, `Register`                                                                      |
| `@monarcode/effetch-query/react`        | `QueryProvider`, `useQuery`, `useSuspenseQuery`, `useMutation`, `useRefetch`, `useQueryClient`, `useResetQueryFailure`, `QueryFailure`, `MissingQueryProvider` |
| `@monarcode/effetch-query/react-native` | `reactNativeSignals`                                                                                                                                           |
| `@monarcode/effetch-query/effetch`      | `endpoints`                                                                                                                                                    |

Every export is documented in its type declarations, with an example: your
editor's hover and "Go to Definition" show it.

### Limitations

- `effect/reactivity` is marked unstable in Effect 4, so effetch-query
  follows its changes. It's tested against Effect 4.1 and the newest 4.x.
- No server rendering or hydration yet, and no infinite queries: both land
  during the alpha series.
- No `cancelQueries` and no devtools in 0.1.
- `gcTime` is per query, not per client: a query's atom is shared by every
  client.

## Examples

[`examples/`](examples) has complete programs, typechecked and tested with
the package:

- [`effect-only.ts`](examples/effect-only/effect-only.ts): queries, the cache
  and mutations from Effect code, with no UI.
- [`todos/`](examples/todos): a React app over effetch endpoints: a list, a
  detail view, an optimistic toggle, a missing todo with a retry button and
  a refresh button, with tests that drive it.

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
