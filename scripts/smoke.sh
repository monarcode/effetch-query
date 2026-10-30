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
	package/dist/react-native/index.d.ts; do
	if ! grep -qx "$required" <<<"$contents"; then
		echo "✗ Missing from tarball: $required" >&2
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
react_types_version="$(dev_version @types/react)"
atom_react_version="$(dev_version @effect/atom-react)"
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
for optional in react @effect/atom-react; do
	if [ -d "node_modules/$optional" ]; then
		echo "✗ $optional was installed, but it's an optional peer" >&2
		exit 1
	fi
done

cat >core.ts <<'TS'
import { Query } from "@monarcode/effetch-query";
import * as ReactNative from "@monarcode/effetch-query/react-native";

const key: Query.QueryKey = ["todos", "detail", 1];

if (key.length !== 3 || Object.keys(ReactNative).length !== 0) {
	throw new Error("Unexpected core or react-native exports");
}

console.log("core: ok");
TS

typecheck core.ts
echo "› Running core.ts"
node core.ts

echo "› Installing React (react@$react_version, @effect/atom-react@$atom_react_version)"
npm install --silent --no-audit --no-fund --no-package-lock \
	"react@$react_version" "@types/react@$react_types_version" \
	"@effect/atom-react@$atom_react_version" "scheduler@$scheduler_version"

cat >react.ts <<'TS'
import * as React from "@monarcode/effetch-query/react";

if (Object.keys(React).length !== 0) {
	throw new Error("Unexpected react exports");
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
