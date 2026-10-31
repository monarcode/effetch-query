# Examples

Complete programs using effetch-query. Each one is typechecked
(`pnpm run typecheck`) and tested (`pnpm test`) with the package, so they
always match the current API. Each folder has its own `tsconfig.json`,
because each registers its own services (`Register`).

| Example                       | What it shows                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`effect-only/`](effect-only) | Queries, the cache and a mutation from Effect code, with no UI: what's cached, what's refetched, what's written. |
| [`todos/`](todos)             | A React app over effetch endpoints: a list, a detail, an optimistic toggle, a missing todo and a refresh button. |

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
  definitions into `todos`, `todo` and `toggleTodo`. The toggle updates the
  list and the detail optimistically, writes the server's todo when it
  succeeds, and invalidates the list.
- **[`App.tsx`](todos/App.tsx)**:
  - the list reads `todos()` with `useQuery`, and refreshes it with
    `useRefetch` (a `RefreshControl` in React Native);
  - each item toggles with its own `useMutation`, and shows when its save
    failed;
  - the detail reads `todo({ params: { id } })` with `useSuspenseQuery`. A
    missing todo reaches an error boundary as a `QueryFailure`, whose
    "Try again" button refetches it with `useResetQueryFailure`.
- **[`App.test.tsx`](todos/App.test.tsx)** renders the app over
  [`fake-api.ts`](todos/fake-api.ts), which can hold responses and fail the
  next request. It checks the toggle shows before the server answers, that a
  rejected toggle is undone, that a missing todo can be retried once it
  exists, and that a refresh shows the server's latest list.

To run it against a real server, serve `main.tsx` with any bundler (Vite,
for example) and an API at `https://todos.example`, or change `baseUrl` in
`api.ts`.
