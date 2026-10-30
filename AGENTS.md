# Agent instructions

`@monarcode/effetch-query`: TanStack-Query-style server state for Effect 4.
Cached queries, mutations and invalidation, built on `effect/reactivity` and
`@effect/atom-react`. Consumers import namespaces:
`import { Mutation, Query, QueryClient } from "@monarcode/effetch-query"`.

## Start here

- `.docs/DESIGN.md` is the design and the API contract. Read it before any
  work.
- `.docs/PLAN.md` is the phased plan. Tick its boxes as items land, and keep
  its **Status** line current.
- `.docs/future-plans.md` holds work after 0.1 (Solid, devtools, …). Add
  findings there as they come up.
- `.docs/` is gitignored and lives on the maintainer's machine. If it's
  missing, ask for it.

## Rules

1. **Effect v4 has changed: don't trust memory.** Before using any Effect API,
   open its source in `node_modules/effect/src/` and read the signature and
   JSDoc. This matters most for `effect/reactivity/*` (`Atom`, `AtomRegistry`,
   `AsyncResult`, `Reactivity`, `Hydration`): every export there is
   `@stability unstable`. For the React bindings, read
   `node_modules/@effect/atom-react`. Use deep namespace imports:
   `import * as Atom from "effect/reactivity/Atom"`.
2. **Verify tool flags against current docs** (tsc, vitest, oxlint, oxfmt,
   attw, publint, GitHub Actions, npm). If a flag doesn't exist, find its
   current equivalent rather than guessing.
3. **The `.d.ts` files are the documentation.** Consumers' "Go to Definition"
   lands on `.d.ts` files (no source or declaration maps are shipped). Every
   public export needs JSDoc with a description, an `@example` and
   `@since 0.1.0`. Public types are named, exported interfaces or aliases,
   not large inline conditional types.
4. **Runtime targets: browsers, React Native (Hermes/Metro), Node ≥ 20, Bun
   and Deno.** No `node:` imports, no Node globals, no `new URL()`, no
   `#private` fields. No DOM globals without a guard. The core entry point
   never imports `react` or `react-native`, and must import cleanly in React
   Server Components. The React Native entry point takes `AppState` and
   `NetInfo` as arguments instead of importing them.
5. **Server-safe and framework-agnostic** (DESIGN.md §5.8). One server process
   serves many requests, so there's no module-level mutable state: everything
   lives in a client's registry, and `dispose()` releases it. Behaviour
   belongs in the core; framework entries (`./react`, later `./solid`) only
   subscribe and wire up lifecycle. Frameworks and integrations are subpaths
   of this one package (`./<framework>`, `./<framework>/<integration>`) with
   optional peers.
6. **Never run `git commit`, `git push`, `git tag`**, or anything else that
   writes git history, unless the maintainer explicitly asks. Never commit
   `dist/`.
7. Never run `npm publish` (except `--dry-run`), `npm login`, `npm trust`,
   `gh secret`, `gh workflow run` or `gh release`, and never change repo
   settings.
8. **Ask before changing a settled decision** (DESIGN.md §2, PLAN.md
   "Settled decisions"). If the code shows a decision can't work, stop and
   explain why rather than working around it.

## Code style

- Write clean, maintainable code that reads like the code around it.
- Keep comments rare. Write one only for non-obvious behaviour, a workaround,
  or a note a future maintainer needs, and make it say why, not what.
- Document the public API in JSDoc: what it does, an `@example` that compiles
  (`check-docs` compiles every one), `@since`, and `{@link}` to related APIs
  so readers can navigate. Non-obvious behaviour, such as rollback order or
  when a hook doesn't run, belongs there too.
- `src/internal/` isn't public: document only what's non-obvious.
- Source imports use explicit `.js` extensions. Because
  `exactOptionalPropertyTypes` is on, write optional props as
  `readonly foo?: T | undefined`.
- The build is plain `tsc` (`scripts/build.mjs`), not a bundler. Bundlers
  rewrite `export * as Query` into a synthetic namespace whose name shows up
  in consumers' hovers. Stay on TypeScript 6: TypeScript 7 ships no compiler
  API, which `check-docs.mjs`, `editor-check.mjs` and the Effect language
  service need.

## Working with the maintainer

The maintainer handles commits, pull requests, CI and npm.

- Work phase by phase (PLAN.md). At each gate, stop with the working tree
  ready, a summary and a suggested Conventional Commit message.
- When a step needs the maintainer (a push, a CI run, a publish, npm
  settings, the Release workflow), stop and say exactly what to do, with the
  commands.
- Prepare version bumps and `CHANGELOG.md` entries as uncommitted edits.

## Before declaring any work done

Run `pnpm run check` and make sure it passes. It runs lint, the format check,
typecheck, the docs check (every public export has a description, `@example`
and `@since`, and every `ts` example in the JSDoc and the README compiles),
the Effect language service diagnostics, the tests (including type tests),
the build, publint, attw and the tarball smoke test.
