#!/usr/bin/env node
import path from "node:path";

import ts from "typescript";

const dir = process.cwd();
const probe = path.join(dir, "editor.ts");
const source = `import * as Effect from "effect/Effect";

import { /*Query*/Query, /*QueryClient*/QueryClient } from "@monarcode/effetch-query";
import { /*endpoints*/endpoints } from "@monarcode/effetch-query/effetch";
import { /*useQuery*/useQuery } from "@monarcode/effetch-query/react";
import { /*reactNativeSignals*/reactNativeSignals } from "@monarcode/effetch-query/react-native";
import { /*connectQueryClient*/connectQueryClient } from "@monarcode/effetch-query/react/tanstack-router";

export const key: Query./*Key*/Key = ["todos"];
export const make = QueryClient./*make*/make;
const greeting = Query.make({ key: ["greeting"], run: Effect.succeed("hello") });
export const read = () => {
	const /*result*/result = useQuery(greeting);
	return result;
};
export { connectQueryClient, endpoints, reactNativeSignals };
`;

const config = ts.getParsedCommandLineOfConfigFile(
	path.join(dir, "tsconfig.NodeNext.json"),
	{},
	{ ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
);
const read = (fileName) =>
	fileName === probe ? source : ts.sys.readFile(fileName);

const service = ts.createLanguageService(
	{
		getScriptFileNames: () => [probe],
		getScriptVersion: () => "1",
		getScriptSnapshot: (fileName) => {
			const text = read(fileName);
			return text === undefined
				? undefined
				: ts.ScriptSnapshot.fromString(text);
		},
		getCurrentDirectory: () => dir,
		getCompilationSettings: () => config.options,
		getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
		fileExists: (fileName) =>
			fileName === probe || ts.sys.fileExists(fileName),
		readFile: read,
		readDirectory: ts.sys.readDirectory,
		directoryExists: ts.sys.directoryExists,
		getDirectories: ts.sys.getDirectories,
	},
	ts.createDocumentRegistry(),
);

const at = (marker) => {
	const index = source.indexOf(`/*${marker}*/`);
	if (index === -1) {
		throw new Error(`No marker ${marker}`);
	}
	return index + marker.length + 4;
};

const failures = [];
const expect = (ok, message) => {
	if (!ok) {
		failures.push(message);
	}
};

const dist = path.join(
	dir,
	"node_modules",
	"@monarcode",
	"effetch-query",
	"dist",
);

// TypeScript doesn't show the JSDoc of `export * as Query` in hovers, so a
// namespace is only checked for where go-to-definition lands.
for (const [marker, file] of [
	["Query", "Query.d.ts"],
	["QueryClient", "QueryClient.d.ts"],
]) {
	const definitions = service.getDefinitionAtPosition(probe, at(marker)) ?? [];
	const targets = definitions.map((definition) =>
		path.relative(dist, definition.fileName),
	);
	expect(
		targets.includes(file),
		`Go to definition on ${marker} lands on ${targets.join(", ") || "nothing"}, not dist/${file}`,
	);
}

// [marker, the .d.ts that go-to-definition lands on, the start of the hover's
// signature, the start of its docs]
for (const [marker, file, signature, docs] of [
	[
		"Key",
		"Query.d.ts",
		"type Key = readonly unknown[]",
		"Identifies a query in the cache",
	],
	[
		"make",
		"QueryClient.d.ts",
		"const make: (options: QueryClient.Options) => QueryClient.QueryClient",
		"Nothing is built until",
	],
	[
		"useQuery",
		"react/hooks.d.ts",
		"(alias) const useQuery: <A, E>(",
		"Reads a query and keeps it up to date",
	],
	[
		"reactNativeSignals",
		"react-native/index.d.ts",
		"(alias) const reactNativeSignals: (",
		"Signals for React Native",
	],
	[
		"endpoints",
		"effetch/index.d.ts",
		"(alias) const endpoints: <",
		"Turns `Fetch.endpoint` definitions into queries",
	],
	[
		"connectQueryClient",
		"react/tanstack-router/index.d.ts",
		"(alias) const connectQueryClient: (",
		"Connects a query client to a TanStack Router",
	],
]) {
	const definitions = service.getDefinitionAtPosition(probe, at(marker)) ?? [];
	const targets = definitions.map((definition) =>
		path.relative(dist, definition.fileName),
	);
	expect(
		targets.includes(file),
		`Go to definition on ${marker} lands on ${targets.join(", ") || "nothing"}, not dist/${file}`,
	);
	const info = service.getQuickInfoAtPosition(probe, at(marker));
	const display = ts.displayPartsToString(info?.displayParts);
	const documentation = ts.displayPartsToString(info?.documentation);
	const tags = (info?.tags ?? []).map((tag) => tag.name);
	expect(
		display.startsWith(signature),
		`Hover on ${marker} shows ${JSON.stringify(display)}, not ${JSON.stringify(signature)}`,
	);
	expect(
		documentation.includes(docs),
		`Hover on ${marker} doesn't show its docs: ${JSON.stringify(documentation.slice(0, 80))}`,
	);
	expect(
		tags.includes("example") && tags.includes("since"),
		`Hover on ${marker} lacks @example or @since: ${tags.join(", ")}`,
	);
}

// What a component reads is an AsyncResult of the query's types.
const result = ts.displayPartsToString(
	service.getQuickInfoAtPosition(probe, at("result"))?.displayParts,
);
expect(
	result === "const result: AsyncResult<string, never>",
	`Hover on useQuery's result shows ${JSON.stringify(result)}`,
);

if (failures.length > 0) {
	console.error(failures.map((failure) => `✗ ${failure}`).join("\n"));
	process.exit(1);
}
console.log("editor: ok");
