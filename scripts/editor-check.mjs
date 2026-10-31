#!/usr/bin/env node
import path from "node:path";

import ts from "typescript";

const dir = process.cwd();
const probe = path.join(dir, "editor.ts");
const source = `import { /*Query*/Query, /*QueryClient*/QueryClient } from "@monarcode/effetch-query";

export const key: Query./*QueryKey*/QueryKey = ["todos"];
export const make = QueryClient./*make*/make;
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
		"QueryKey",
		"Query.d.ts",
		"type QueryKey = readonly unknown[]",
		"Identifies a query in the cache",
	],
	[
		"make",
		"QueryClient.d.ts",
		"const make: (options: QueryClient.Options) => QueryClient.QueryClient",
		"Nothing is built until",
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

if (failures.length > 0) {
	console.error(failures.map((failure) => `✗ ${failure}`).join("\n"));
	process.exit(1);
}
console.log("editor: ok");
