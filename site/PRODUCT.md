# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Effect developers with server state.** Developers building apps with
  Effect v4 whose UI shows data from a server: React, React Native, or code
  with no UI at all. No assumption that they know TanStack Query or
  Effetch. They need to see quickly what Effetch Query does, how it fits
  an Effect app, and whether to adopt it.
- **Developers who know TanStack Query.** Its model and vocabulary carry
  over, and the docs have a mapping page for them (Coming from TanStack
  Query).
- **Effetch users.** Developers who already call APIs with Effetch and now
  want those calls cached.
- **Developers wiring it up.** Reading the guides and the reference with
  their editor open.
- **AI coding assistants.** Agents that read `llms.txt`, `llms-full.txt`
  and each page's Markdown route.

## Product Purpose

The site is the documentation and landing page for
`@monarcode/effetch-query`, server state for Effect apps: cached queries,
mutations and invalidation. It loads data once, shares it between every
component that shows it, keeps it fresh in the background, and updates it
when something changes. It's built on `effect/reactivity` atoms; React
only subscribes.

Success: an Effect developer understands within the first screen that
Effetch Query is the caching model they know from TanStack Query, made of
Effect, and goes from install to a working query and mutation by following
Getting started.

## Positioning

The familiar server-state model (one fetch shared by every component,
fresh then stale, background refetch, invalidation by key, optimistic
updates) where everything is Effect. A query is an Effect that runs with
the app's services, its errors stay typed all the way to the component
(an `AsyncResult` with the full `Cause`), and the cache is something
Effect programs can read and write. A query that needs a service the app
doesn't provide doesn't compile. TanStack Query, wrapped around Effect,
can't make these claims: past the promise, errors lose their types and
queries lose the app's layers.

It's the companion to Effetch: Effetch makes the call, Effetch Query
caches it, and an endpoint's route gives the query its key. It works with
any Effect too.

## Operating Context

- Developers arrive from the npm page, the GitHub README (whose banner and
  guide links point here), Effetch's site and search.
- The other documentation surface is the editor: the package's JSDoc,
  shown in hovers and on "Go to Definition". The site's reference pages
  are generated from it, and the docs' code blocks carry Twoslash hovers
  read from the built package.
- One docs version per release line. The current line is at `/docs/…`;
  older lines are snapshots at `/docs/<line>/…`. The live site
  (https://effetch-query.monarcode.dev) deploys from the `site` branch at each
  release; `main` and pull requests deploy as previews.

## Capabilities and Constraints

- Fumadocs 16 on TanStack Start, prerendered to static files and hosted on
  Cloudflare Pages. Search per version, `llms.txt`, Markdown per page,
  sitemap.
- Every `ts` and `tsx` block on a page is compiled by the docs check, and
  the site's build fails on a type error in one. Code shown on the site
  compiles.
- Reference pages are generated from the JSDoc and not edited by hand.
- Entry points: `@monarcode/effetch-query` (`Query`, `Mutation`,
  `QueryClient`, …), `/react`, `/react-native`, `/effetch` and
  `/react/tanstack-router`.
- Runtimes: browsers, React Native (Hermes), Node.js 20+, Bun and Deno.
  Frameworks with guides: TanStack Start, React Router, Next.js.
- Needs `effect` 4.1+; with Effetch, Effetch `0.1.0-rc.4`+ in 0.1.
- Terminology: the product is **Effetch Query** and its HTTP client is
  **Effetch** in prose; `effetch-query` only as an identifier (npm name,
  repo, URLs).
- Domain: `https://effetch-query.monarcode.dev`. The Pages address,
  `https://effetch-query.pages.dev`, still serves the same site.

## Brand Commitments

- **Pitch:** "Server state for Effect apps, inspired by TanStack Query."
  The banner's line: "Effectful queries and mutations for effetch,
  inspired by TanStack Query."
- **Logo:** monarcode's lime brace-and-dot mark with the "Effetch Query"
  wordmark, as in `assets/banner.png` (source: `.docs/effetch-query-logo.svg`,
  which isn't in the repo). It is the logo in the nav and the favicon.
- **Brand colours:** lime `#D5F70D` and ink `#16171D`, shared with Effetch
  and monarcode's palette, used at their exact values.
- **Dark only.** No light mode and no theme switch.
- **Its own site, not Effetch's.** Related through the brand, but it must
  not look like Effetch's site: not its type-specimen world, its Recursive
  typeface, or its layouts with new text.
- **The docs get the new look too:** the redesign carries into the docs
  frame (sidebar, TOC, code theme) after the landing page.
- **Credit to TanStack Query** (inferred from the docs' introduction; to
  confirm). The docs thank it openly and call it the industry standard and
  the right choice for most apps. The site never disparages it.
- **Voice** (inferred from the README and docs; to confirm): plain and
  direct, written for developers. Short sentences, one idea each. Says
  what Effetch Query doesn't do as clearly as what it does.

## Evidence on Hand

- Checked code: every example in the site's pages, the README and the
  JSDoc compiles against the package (`scripts/check-docs.mjs`).
- Runnable programs in `examples/` (`effect-only`, `basic`,
  `tanstack-start`, `tanstack-start-httpclient`, `react-router`); the
  full apps are built and driven in the integration tests.
- Release status: `0.1.0` release candidate, API frozen; the changelog
  lists anything that needs a change in your code.

Absent, and not to be invented: users, adopters or company logos,
testimonials, download or adoption numbers, benchmarks, and claims of
production readiness before `0.1.0`.

## Product Principles

1. **Show the code, not the claim.** A query and a mutation are a few
   lines; the page proves the model by showing them and what they're
   typed as.
2. **Shown code compiles.** Never put code on the site that the docs check
   doesn't check.
3. **Familiar model, Effect all the way down.** Lead with what TanStack
   Query users already know, and make the difference the fact that it's
   Effect.
4. **Honest scope.** Say when TanStack Query is the better choice.
5. **Readable by people and agents.** Every page also exists as Markdown.
