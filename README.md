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
[![types](https://img.shields.io/npm/types/@monarcode/effetch-query)](https://www.npmjs.com/package/@monarcode/effetch-query)
[![provenance](https://img.shields.io/badge/provenance-verified-brightgreen?logo=npm)](https://www.npmjs.com/package/@monarcode/effetch-query#provenance)
[![license](https://img.shields.io/npm/l/@monarcode/effetch-query)](./LICENSE)

[![React](https://img.shields.io/badge/React-20232a?logo=react&logoColor=61dafb)](https://effetch-query.pages.dev/docs/react)
[![React Native](https://img.shields.io/badge/React%20Native-20232a?logo=react&logoColor=61dafb)](https://effetch-query.pages.dev/docs/react/react-native)
[![TanStack Router](https://img.shields.io/badge/TanStack%20Router-20232a?logo=tanstack&logoColor=white)](https://effetch-query.pages.dev/docs/frameworks/tanstack-start)
[![TanStack Start](https://img.shields.io/badge/TanStack%20Start-20232a?logo=tanstack&logoColor=white)](https://effetch-query.pages.dev/docs/frameworks/tanstack-start)
[![React Router](https://img.shields.io/badge/React%20Router-20232a?logo=reactrouter&logoColor=ca4245)](https://effetch-query.pages.dev/docs/frameworks/react-router)
[![Next.js](https://img.shields.io/badge/Next.js-20232a?logo=nextdotjs&logoColor=white)](https://effetch-query.pages.dev/docs/frameworks/nextjs)
[![Effect](https://img.shields.io/badge/Effect-20232a?logo=effect&logoColor=white)](https://effect.website)

**Server state for [Effect](https://effect.website) apps, inspired by
[TanStack Query](https://tanstack.com/query).**

Most of what an app shows comes from a server: a list of todos, a profile,
the price of something. Effetch Query loads that data once, shares it
between every component that shows it, keeps it fresh in the background,
and updates it when you change something.

Everything in it is Effect. A query is an Effect that runs with your app's
services, its errors stay typed all the way to the component, and the
cache itself is something your Effect programs can read and write. It
works in React, React Native and code with no UI at all.

It's the companion to [Effetch](https://github.com/monarcode/effetch), the
typed HTTP client for Effect: Effetch makes the call, Effetch Query caches
it. It works with any Effect too.

> **Release candidate.** The API is frozen for `0.1.0`: the
> `0.1.0-rc.N` releases fix bugs and only ever add to it. Each needs the
> matching Effetch release candidate, so upgrade the two together. See the
> [release notes](./CHANGELOG.md).

## Documentation

The guides and the API reference are at
**[effetch-query.pages.dev](https://effetch-query.pages.dev/docs)**. Start with
[Getting started](https://effetch-query.pages.dev/docs/getting-started), which builds a small todo
app one piece at a time.

## Install

Install the package with Effetch and Effect:

```bash
pnpm add @monarcode/effetch-query @monarcode/effetch effect
```

For React, add `@effect/atom-react` and `react` (19):

```bash
pnpm add @effect/atom-react react
```

Effetch Query needs `effect` 4.1 or later. With Effetch, it needs Effetch
`0.1.0-rc.4` or later in 0.1. It runs in browsers, React Native (Hermes),
Node 20+, Bun and Deno. See [Installation](https://effetch-query.pages.dev/docs/installation) for
the entry points.

## Quick start

Here's a whole React app in one file. It lists the todos from an API and
toggles one when you click it:

```tsx
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schema from "effect/Schema";

import { Fetch } from "@monarcode/effetch";
import { QueryClient } from "@monarcode/effetch-query";
import { fromClient } from "@monarcode/effetch-query/effetch";
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

// Your Effetch client, as a service.
class ApiClient extends Fetch.Service<ApiClient>()("ApiClient", {
  baseUrl: "https://api.example.com",
}) {}

declare module "@monarcode/effetch-query" {
  interface Register {
    readonly services: ApiClient;
  }
}

const api = fromClient(ApiClient);

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
  layer: ApiClient.layer.pipe(Layer.provide(FetchHttpClient.layer)),
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

## Guides

- [Queries](https://effetch-query.pages.dev/docs/queries): queries from endpoints, keys, errors,
  freshness, placeholders, infinite and live queries, and queries without
  Effetch.
- [React](https://effetch-query.pages.dev/docs/react): reading queries in components, Suspense,
  refetching, atoms and React Native.
- [Mutations](https://effetch-query.pages.dev/docs/mutations): running mutations, invalidation,
  optimistic updates, entities and activity.
- [The cache](https://effetch-query.pages.dev/docs/cache): reading and writing it from Effect and
  from plain code, and switching accounts.
- [The client](https://effetch-query.pages.dev/docs/client): options, services, defaults and
  signals.
- [Server rendering](https://effetch-query.pages.dev/docs/server-rendering) and
  [frameworks](https://effetch-query.pages.dev/docs/frameworks): TanStack Router and
  Start, Next.js and React Router.
- [Testing](https://effetch-query.pages.dev/docs/testing) and
  [Coming from TanStack Query](https://effetch-query.pages.dev/docs/coming-from-tanstack-query).
- [Entry points](https://effetch-query.pages.dev/docs/reference) and
  [limitations](https://effetch-query.pages.dev/docs/reference/limitations).

## Examples

The [`examples/`](examples) folder has complete programs, typechecked with
the package. `effect-only` and the full apps are also tested, in
[`test/examples/`](test/examples). There are five:

- [`effect-only.ts`](examples/effect-only/effect-only.ts): queries, a live
  query, the cache and mutations from Effect code, with no UI.
- [`basic/`](examples/basic): the smallest React app, with dummyjson.com's
  todos and an optimistic toggle.
- [`tanstack-start/`](examples/tanstack-start): a full TanStack Start app on
  Effetch endpoints: sign-in, a user's todos, a list with "Load more", a
  streamed detail page and a missing one.
- [`tanstack-start-httpclient/`](examples/tanstack-start-httpclient): the
  same app on Effect's `HttpClient`, without Effetch.
- [`react-router/`](examples/react-router): the same app in React Router's
  framework mode, on Effetch endpoints.

[The examples README](examples/README.md) walks through each one.

## Development

To work on Effetch Query, you need Node 24 and pnpm 10 (`corepack enable`
picks the pinned version). To install the dependencies and run every
check, run:

```bash
pnpm install
pnpm run check
```

The package has the following scripts:

| Script                    | What it does                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm run build`          | Builds `dist/` (ESM and `.d.ts`) with `tsc`.                                                                                                           |
| `pnpm test`               | Runs the tests, the type tests and the examples' tests with Vitest.                                                                                    |
| `pnpm run typecheck`      | Typechecks `src`, `test` and each example.                                                                                                             |
| `pnpm run lint`           | Lints with oxlint (`lint:effect` runs the Effect language service).                                                                                    |
| `pnpm run format`         | Formats with oxfmt (`format:check` only checks).                                                                                                       |
| `pnpm run check:docs`     | Checks every public export has a description, `@example` and `@since`, and compiles every example in the JSDoc, this README and the docs site's pages. |
| `pnpm run smoke`          | Packs the package, installs it in a fresh project, typechecks and runs consumers, and checks go-to-definition and hovers.                              |
| `pnpm run check`          | All of these, plus publint and attw. CI runs it on every pull request.                                                                                 |
| `pnpm run docs:reference` | Writes the docs site's API reference pages from the JSDoc. `check:docs` fails when they're out of date.                                                |
| `pnpm run build:site`     | Builds the package, then the docs site in `site/`, prerendered to `site/dist/client`.                                                                  |

To work on the docs site, run `pnpm run build` once, then
`pnpm --dir site run dev`, which serves it at the address it prints. The
site's type hovers and type tables read the built package in `dist`.

The pre-commit hook runs `lint` and `format:check`.

## License

[MIT](LICENSE)
