#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
smoke="$root/.smoke"
consumer="$smoke/consumer"

cd "$root"
rm -rf "$smoke"
mkdir -p "$smoke"

echo "› Building"
pnpm run build >/dev/null

echo "› Packing"
pnpm --config.ignore-scripts=true pack --pack-destination "$smoke" >/dev/null
tarballs=("$smoke"/monarcode-effetch-query-*.tgz)
if [ "${#tarballs[@]}" -ne 1 ] || [ ! -f "${tarballs[0]}" ]; then
	echo "✗ Expected exactly one tarball in $smoke" >&2
	exit 1
fi
tarball="${tarballs[0]}"

echo "› Checking tarball contents"
contents="$(tar -tzf "$tarball")"
for required in \
	package/package.json \
	package/README.md \
	package/CHANGELOG.md \
	package/LICENSE \
	package/dist/index.js \
	package/dist/index.d.ts \
	package/dist/react/index.js \
	package/dist/react/index.d.ts \
	package/dist/react-native/index.js \
	package/dist/react-native/index.d.ts \
	package/dist/effetch/index.js \
	package/dist/effetch/index.d.ts \
	package/dist/react/tanstack-router/index.js \
	package/dist/react/tanstack-router/index.d.ts; do
	if ! grep -qx "$required" <<<"$contents"; then
		echo "✗ Missing from tarball: $required" >&2
		exit 1
	fi
done
for client_module in "$root"/dist/react/*.js; do
	if [ "$(head -n 1 "$client_module")" != '"use client";' ]; then
		echo "✗ ${client_module#"$root"/} doesn't start with \"use client\"" >&2
		exit 1
	fi
done
forbidden="$(grep -E '^package/src/|\.map$|\.test\.|\.test-d\.' <<<"$contents" || true)"
if [ -n "$forbidden" ]; then
	echo "✗ Unexpected files in tarball:" >&2
	echo "$forbidden" >&2
	exit 1
fi

dev_version() {
	node -p "require('./package.json').devDependencies['$1']"
}
effect_version="$(dev_version effect)"
typescript_version="$(dev_version typescript)"
react_version="$(dev_version react)"
react_dom_version="$(dev_version react-dom)"
react_dom_types_version="$(dev_version @types/react-dom)"
react_types_version="$(dev_version @types/react)"
atom_react_version="$(dev_version @effect/atom-react)"
effetch_version="$(dev_version @monarcode/effetch)"
scheduler_version="$(dev_version scheduler)"
tanstack_router_version="$(dev_version @tanstack/react-router)"
node_types_version="$(dev_version @types/node)"

common_options='
		"target": "ES2022",
		"lib": ["ES2022", "DOM", "ESNext.Disposable"],
		"strict": true,
		"noEmit": true,
		"skipLibCheck": false,
		"allowImportingTsExtensions": true'

typecheck() {
	local file="$1"
	for resolution in NodeNext Bundler; do
		local module="NodeNext"
		if [ "$resolution" = Bundler ]; then
			module="ESNext"
		fi
		cat >"tsconfig.$resolution.json" <<JSON
{
	"compilerOptions": {$common_options,
		"module": "$module",
		"moduleResolution": "$resolution"
	},
	"files": ["$file"]
}
JSON
		echo "› Typechecking $file ($resolution)"
		./node_modules/.bin/tsc -p "tsconfig.$resolution.json"
	done
}

echo "› Installing tarball without React (effect@$effect_version, typescript@$typescript_version)"
mkdir -p "$consumer"
cd "$consumer"
cat >package.json <<'JSON'
{ "name": "effetch-query-smoke-consumer", "private": true, "type": "module" }
JSON
npm install --silent --no-audit --no-fund --no-package-lock \
	"$tarball" "effect@$effect_version" "typescript@$typescript_version"
for optional in react @effect/atom-react @monarcode/effetch @tanstack/react-router; do
	if [ -d "node_modules/$optional" ]; then
		echo "✗ $optional was installed, but it's an optional peer" >&2
		exit 1
	fi
done

cat >core.ts <<'TS'
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { InfiniteQuery, Query, QueryClient } from "@monarcode/effetch-query";
import * as ReactNative from "@monarcode/effetch-query/react-native";

class Greeter extends Context.Service<
	Greeter,
	{ readonly greet: (name: string) => string }
>()("smoke/Greeter") {}

// Augmenting through the root re-export must reach QueryClient's `Register`.
declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: Greeter;
	}
}

const key: Query.Key = ["todos", "detail", 1];
let listening = 0;
// The React Native entry imports cleanly without react-native installed.
const signals = ReactNative.reactNativeSignals({
	AppState: {
		currentState: "active",
		addEventListener: () => {
			listening++;
			return { remove: () => listening-- };
		},
	},
	NetInfo: {
		addEventListener: () => {
			listening++;
			return () => listening--;
		},
	},
});
const client = QueryClient.make({
	layer: Layer.succeed(Greeter, { greet: (name) => `Hello, ${name}` }),
	signals,
});
await client.runPromise(
	Query.fetch(Query.make({ key: ["smoke"], run: Effect.void })),
);
const listened = listening;
const greeting = await client.runPromise(
	Greeter.useSync((greeter) => greeter.greet("smoke")),
);
const numbers = InfiniteQuery.make({
	key: ["numbers"],
	initialPageParam: 0,
	run: (page: number) => Effect.succeed([page]),
	nextPageParam: (_, __, page) => (page < 1 ? page + 1 : undefined),
});
await client.runPromise(Query.fetch(numbers));
const paged = await client.runPromise(InfiniteQuery.fetchNextPage(numbers));
let served = 0;
const count = Query.make({
	key: ["served"],
	run: Effect.sync(() => ++served),
	schema: { success: Schema.Finite },
	staleTime: "1 minute",
});
await client.runPromise(Query.prefetch(count));
const sent = JSON.parse(JSON.stringify(QueryClient.dehydrate(client)));
await client.dispose();

// The browser shows what the server sent, without fetching.
const browser = QueryClient.make({
	layer: Layer.succeed(Greeter, { greet: (name) => name }),
});
QueryClient.hydrate(browser, sent);
const hydrated = await browser.runPromise(Query.fetch(count));
await browser.dispose();

if (key.length !== 3) {
	throw new Error(`Unexpected query key: ${JSON.stringify(key)}`);
}
if (greeting !== "Hello, smoke") {
	throw new Error(`Unexpected runPromise result: ${greeting}`);
}
if (paged.pages.flat().join() !== "0,1") {
	throw new Error(`Unexpected pages: ${JSON.stringify(paged)}`);
}
if (hydrated !== 1 || served !== 1) {
	throw new Error(`Hydration: ${hydrated} shown after ${served} fetches`);
}
if (Object.keys(ReactNative).join() !== "reactNativeSignals") {
	throw new Error("Unexpected react-native exports");
}
if (listened !== 2 || listening !== 0) {
	throw new Error(`React Native listeners: ${listened} used, ${listening} left`);
}

console.log("core: ok");
TS

typecheck core.ts
echo "› Running core.ts"
node core.ts

echo "› Installing @monarcode/effetch@$effetch_version"
npm install --silent --no-audit --no-fund --no-package-lock \
	"@monarcode/effetch@$effetch_version"

cat >effetch.ts <<'TS'
import * as Fetch from "@monarcode/effetch";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { Query, QueryClient } from "@monarcode/effetch-query";
import { endpoints } from "@monarcode/effetch-query/effetch";

class Api extends Context.Service<Api, Fetch.Client<[]>>()("smoke/Api") {}

declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: Api;
	}
}

const todo = endpoints(Api).query(
	Fetch.endpoint("GET /todos/:id", {
		output: Schema.Struct({ id: Schema.Finite }),
	}),
);
const http = HttpClient.make((request, url) =>
	Effect.sync(() =>
		HttpClientResponse.fromWeb(
			request,
			Response.json({ id: Number(url.pathname.split("/")[2]) }),
		),
	),
);
const client = QueryClient.make({
	layer: Layer.effect(Api)(Fetch.make({ baseUrl: "https://api.test" })).pipe(
		Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
	),
});
const query = todo({ params: { id: 7 } });
const value = await client.runPromise(Query.fetch(query));
await client.dispose();

if (JSON.stringify(query.key) !== '["todos",7]') {
	throw new Error(`Unexpected key: ${JSON.stringify(query.key)}`);
}
if (value.id !== 7) {
	throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}

console.log("effetch: ok");
TS

typecheck effetch.ts
echo "› Running effetch.ts"
node effetch.ts

echo "› Installing React (react@$react_version, @effect/atom-react@$atom_react_version)"
npm install --silent --no-audit --no-fund --no-package-lock \
	"react@$react_version" "react-dom@$react_dom_version" \
	"@types/react@$react_types_version" "@types/react-dom@$react_dom_types_version" \
	"@effect/atom-react@$atom_react_version" "scheduler@$scheduler_version"

# React Server Components resolve packages with the `react-server`
# condition; the core must load there (Next's server components).
echo "› Running core.ts as a React Server Component would load it"
node --conditions=react-server core.ts

cat >react.ts <<'TS'
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { Query, QueryClient } from "@monarcode/effetch-query";
import * as React from "@monarcode/effetch-query/react";

const expected = [
	"HydrationBoundary",
	"MissingQueryProviderError",
	"QueryFailure",
	"QueryProvider",
	"useInfiniteQuery",
	"useMutation",
	"useQuery",
	"useQueryClient",
	"useRefetch",
	"useResetQueryFailure",
	"useSuspenseInfiniteQuery",
	"useSuspenseQuery",
];
if (Object.keys(React).sort().join() !== expected.join()) {
	throw new Error(`Unexpected react exports: ${Object.keys(React).join()}`);
}

let fetches = 0;
const greeting = Query.make({
	key: ["greeting"],
	run: Effect.sync(() => `Hello, ${++fetches}`),
});
const Greeting = () => {
	const result = React.useQuery(greeting);
	return result._tag === "Success" ? result.value : result._tag;
};
const client = QueryClient.make({ layer: Layer.empty });
const html = renderToString(
	createElement(React.QueryProvider, { client }, createElement(Greeting)),
);
await client.dispose();

// A server render reads only the cache.
if (html !== "Initial" || fetches !== 0) {
	throw new Error(`Unexpected server render: ${html} after ${fetches} fetches`);
}

let sentFetches = 0;
const sentGreeting = Query.make({
	key: ["sent"],
	run: Effect.sync(() => `Sent ${++sentFetches}`),
	schema: { success: Schema.String },
});
const SentGreeting = () => {
	const result = React.useQuery(sentGreeting);
	return result._tag === "Success" ? result.value : result._tag;
};
const server = QueryClient.make({ layer: Layer.empty });
await server.runPromise(Query.prefetch(sentGreeting));
const state = QueryClient.dehydrate(server);
await server.dispose();
const browser = QueryClient.make({ layer: Layer.empty });
const hydratedHtml = renderToString(
	createElement(
		React.QueryProvider,
		{ client: browser },
		createElement(
			React.HydrationBoundary,
			{ state },
			createElement(SentGreeting),
		),
	),
);
await browser.dispose();

// The boundary shows what the server sent, without fetching again.
if (hydratedHtml !== "Sent 1" || sentFetches !== 1) {
	throw new Error(
		`Unexpected hydration: ${hydratedHtml} after ${sentFetches} fetches`,
	);
}

console.log("react: ok");
TS

typecheck react.ts
echo "› Running react.ts"
node react.ts

# Node's types are for TanStack's server rendering, which a server imports.
echo "› Installing TanStack Router (@tanstack/react-router@$tanstack_router_version)"
npm install --silent --no-audit --no-fund --no-package-lock \
	"@tanstack/react-router@$tanstack_router_version" "@types/node@$node_types_version"

cat >tanstack-router.ts <<'TS'
/// <reference types="node" />
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
	createRootRouteWithContext,
	createRoute,
	createRouter,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import {
	createRequestHandler,
	defaultStreamHandler,
} from "@tanstack/react-router/ssr/server";
import { createElement, Fragment } from "react";

import { Query, QueryClient } from "@monarcode/effetch-query";
import { useSuspenseQuery } from "@monarcode/effetch-query/react";
import * as TanStackRouter from "@monarcode/effetch-query/react/tanstack-router";

const exported = JSON.stringify(Object.keys(TanStackRouter).sort());
if (exported !== '["connectQueryClient"]') {
	throw new Error(`Unexpected tanstack-router exports: ${exported}`);
}

let fetches = 0;
const greeting = Query.make({
	key: ["greeting"],
	run: Effect.sync(() => {
		fetches += 1;
		return "Hello from the loader";
	}),
	schema: { success: Schema.String },
	staleTime: "1 minute",
});

const rootRoute = createRootRouteWithContext<{
	readonly queryClient: QueryClient.QueryClient;
}>()({
	component: () =>
		createElement(Fragment, null, createElement(Outlet), createElement(Scripts)),
});
const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	loader: ({ context }) => context.queryClient.runPromise(Query.fetch(greeting)),
	component: () => createElement("p", null, useSuspenseQuery(greeting).value),
});

const queryClient = QueryClient.make({ layer: Layer.empty });
const response = await createRequestHandler({
	request: new Request("http://localhost/"),
	createRouter: () => {
		const router = createRouter({
			routeTree: rootRoute.addChildren([indexRoute]),
			context: { queryClient },
		});
		TanStackRouter.connectQueryClient({ router, queryClient });
		return router;
	},
})(defaultStreamHandler);
const html = await response.text();

// The page has the loader's query, and its state for the browser.
if (
	!html.includes("<p>Hello from the loader</p>") ||
	!html.includes('effetch-query:[\\"greeting\\"]') ||
	fetches !== 1
) {
	throw new Error(`Unexpected page after ${fetches} fetches: ${html}`);
}

// The request's client is disposed when the request ends.
let disposed = false;
try {
	queryClient.registry.get(greeting);
} catch {
	disposed = true;
}
if (!disposed) {
	throw new Error("The request's query client wasn't disposed");
}

console.log("tanstack-router: ok");
TS

typecheck tanstack-router.ts
echo "› Running tanstack-router.ts"
node tanstack-router.ts

echo "› Checking the editor experience (definitions, hovers)"
cp "$root/scripts/editor-check.mjs" .
node editor-check.mjs

echo "✓ Smoke test passed"
