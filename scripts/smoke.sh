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
	package/dist/effetch/index.d.ts; do
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
for optional in react @effect/atom-react @monarcode/effetch; do
	if [ -d "node_modules/$optional" ]; then
		echo "✗ $optional was installed, but it's an optional peer" >&2
		exit 1
	fi
done

cat >core.ts <<'TS'
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Query, QueryClient } from "@monarcode/effetch-query";
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

const key: Query.QueryKey = ["todos", "detail", 1];
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
await client.dispose();

if (key.length !== 3) {
	throw new Error(`Unexpected query key: ${JSON.stringify(key)}`);
}
if (greeting !== "Hello, smoke") {
	throw new Error(`Unexpected runPromise result: ${greeting}`);
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

cat >react.ts <<'TS'
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { Query, QueryClient } from "@monarcode/effetch-query";
import * as React from "@monarcode/effetch-query/react";

const expected = [
	"MissingQueryProvider",
	"QueryFailure",
	"QueryProvider",
	"useMutation",
	"useQuery",
	"useQueryClient",
	"useRefetch",
	"useResetQueryFailure",
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

console.log("react: ok");
TS

typecheck react.ts
echo "› Running react.ts"
node react.ts

echo "› Checking the editor experience (definitions, hovers)"
cp "$root/scripts/editor-check.mjs" .
node editor-check.mjs

echo "✓ Smoke test passed"
