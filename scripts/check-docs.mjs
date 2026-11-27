#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import {
	augments,
	codeBlocks,
	markdownExamples,
	root,
	shims,
	sitePages,
	usesNamed,
} from "./docs-examples.mjs";
import { referenceSlugs, renderReference } from "./reference-docs.mjs";

const entries = [
	"src/index.ts",
	"src/react/index.ts",
	"src/react-native/index.ts",
	"src/effetch/index.ts",
	"src/react/tanstack-router/index.ts",
].map((file) => path.join(root, file));
// Every other page would be published unchecked, so it fails instead. A
// release line's snapshot (`0.1/`) is the exception, once there is one.
const siteContent = path.join(root, "site", "content", "docs");
const uncheckedPages = existsSync(siteContent)
	? readdirSync(siteContent, { recursive: true, encoding: "utf8" }).filter(
			(file) =>
				file.endsWith(".mdx") &&
				!/^(?:\(latest\)|\d+\.\d+)[\\/]/.test(file),
		)
	: [];
const relative = (file) => path.relative(root, file);
const parsed = ts.getParsedCommandLineOfConfigFile(
	path.join(root, "tsconfig.json"),
	{},
	{
		...ts.sys,
		onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
			throw new Error(
				ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
			);
		},
	},
);
const options = {
	...parsed.options,
	noEmit: true,
	plugins: [],
	paths: {
		...parsed.options.paths,
		// The Next.js page's examples; Next isn't a dependency.
		"next/server": [shims["next/server"]],
		"next/navigation": [shims["next/navigation"]],
	},
};
const problems = [];
for (const file of uncheckedPages) {
	problems.push(
		`${relative(path.join(siteContent, file))}: move the page into (latest), whose examples the check compiles`,
	);
}
if (!existsSync(sitePages)) {
	problems.push(
		`${relative(sitePages)}: missing, so its pages went unchecked`,
	);
}

const program = ts.createProgram(entries, options);
const checker = program.getTypeChecker();

const locate = (node) => {
	const file = node.getSourceFile();
	const { line } = file.getLineAndCharacterOfPosition(node.getStart());
	return `${relative(file.fileName)}:${line + 1}`;
};

const docOf = (node) => {
	const doc = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1);
	const tags = new Map(
		(doc?.tags ?? []).map((tag) => [
			tag.tagName.text,
			ts.getTextOfJSDocComment(tag.comment)?.trim() ?? "",
		]),
	);
	return {
		description: Boolean(ts.getTextOfJSDocComment(doc?.comment)?.trim()),
		tags,
	};
};

const requireFull = (name, node) => {
	const { description, tags } = docOf(node);
	const missing = [
		description ? undefined : "a description",
		tags.has("example") ? undefined : "@example",
		/^\d+\.\d+\.\d+$/.test(tags.get("since") ?? "") ? undefined : "@since",
	].filter(Boolean);
	if (missing.length > 0) {
		problems.push(`${locate(node)}: ${name} needs ${missing.join(", ")}`);
	}
};

const requireDescription = (name, node) => {
	if (!docOf(node).description) {
		problems.push(`${locate(node)}: ${name} needs a description`);
	}
};

const checkMembers = (name, node) => {
	for (const member of node.members) {
		if (
			ts.isConstructorDeclaration(member) ||
			ts.isCallSignatureDeclaration(member) ||
			ts.isIndexSignatureDeclaration(member) ||
			member.name === undefined
		) {
			continue;
		}
		requireDescription(`${name}.${member.name.getText()}`, member);
	}
};

const isImplementation = (node) =>
	(ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
	node.body !== undefined &&
	checker.getSymbolAtLocation(node.name)?.declarations?.length > 1;

const checkDeclaration = (name, node) => {
	if (isImplementation(node)) {
		return;
	}
	requireFull(name, node);
	if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
		checkMembers(name, node);
	}
	if (
		ts.isModuleDeclaration(node) &&
		node.body &&
		ts.isModuleBlock(node.body)
	) {
		for (const statement of node.body.statements) {
			const exported = statement.modifiers?.some(
				(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
			);
			if (exported && statement.name) {
				checkDeclaration(`${name}.${statement.name.getText()}`, statement);
			}
		}
	}
};

// `export * as Query from "./Query.js"` documents the namespace on the export
// statement; its members are checked like any other export.
const requireNamespace = (name, node) => {
	const { description, tags } = docOf(node);
	const missing = [
		description ? undefined : "a description",
		/^\d+\.\d+\.\d+$/.test(tags.get("since") ?? "") ? undefined : "@since",
	].filter(Boolean);
	if (missing.length > 0) {
		problems.push(`${locate(node)}: ${name} needs ${missing.join(", ")}`);
	}
};

let exportCount = 0;
// Every export the walk below checks, as `entry:name` with the name readers
// use, such as `src/index.ts:Query.make` or `src/react/index.ts:useQuery`.
// The reference must list each one, on its entry point's pages.
const documented = new Set();
const checkExports = (prefix, moduleSymbol, entry) => {
	for (const exported of checker.getExportsOfModule(moduleSymbol)) {
		const name = `${prefix}${exported.name}`;
		const symbol =
			exported.flags & ts.SymbolFlags.Alias
				? checker.getAliasedSymbol(exported)
				: exported;
		const namespace = exported.declarations?.find(ts.isNamespaceExport);
		if (namespace !== undefined) {
			requireNamespace(name, namespace.parent);
			checkExports(`${name}.`, symbol, entry);
			continue;
		}
		exportCount += 1;
		documented.add(
			`${path.relative(root, entry).split(path.sep).join("/")}:${name}`,
		);
		for (const declaration of symbol.declarations ?? []) {
			checkDeclaration(name, declaration);
		}
	}
};
for (const entry of entries) {
	const moduleSymbol = checker.getSymbolAtLocation(
		program.getSourceFile(entry),
	);
	if (moduleSymbol !== undefined) {
		checkExports("", moduleSymbol, entry);
	}
}

// The reference pages are what `scripts/reference-docs.mjs` renders from the
// JSDoc, so they can't fall behind it, and they list every export.
let reference = { files: new Map(), names: [...documented] };
try {
	reference = renderReference(program);
} catch (error) {
	problems.push(error instanceof Error ? error.message : String(error));
}
for (const [file, body] of reference.files) {
	const onDisk = path.join(root, file);
	if (!existsSync(onDisk) || readFileSync(onDisk, "utf8") !== body) {
		problems.push(
			`${file}: out of date with the JSDoc. Run \`pnpm run docs:reference\`.`,
		);
	}
}
// The reference folder holds the generated pages and two written ones, and
// its sidebar lists each: a page renamed or dropped from the generator
// would otherwise stay published, and a new one would be missing.
const referenceDir = path.join(sitePages, "reference");
const referencePages = new Set(["index", "limitations", ...referenceSlugs]);
if (existsSync(referenceDir)) {
	for (const file of readdirSync(referenceDir)) {
		const slug = file.replace(/\.mdx$/, "");
		if (file.endsWith(".mdx") && !referencePages.has(slug)) {
			problems.push(
				`${relative(path.join(referenceDir, file))}: not a page scripts/reference-docs.mjs writes; delete it, or add it to PAGES`,
			);
		}
	}
	const metaFile = path.join(referenceDir, "meta.json");
	let sidebar;
	try {
		// Separators ("---Title---") group the pages; they aren't pages.
		sidebar = JSON.parse(readFileSync(metaFile, "utf8")).pages.filter(
			(page) => !page.startsWith("---"),
		);
	} catch {
		// Reported below, with the pages it should list.
	}
	if (JSON.stringify(sidebar) !== JSON.stringify([...referencePages])) {
		problems.push(
			`${relative(metaFile)}: its pages should be ${JSON.stringify([...referencePages])}`,
		);
	}
}
const listed = new Set(reference.names);
for (const name of documented) {
	if (!listed.has(name)) {
		problems.push(`${name} is missing from the API reference`);
	}
}
for (const name of listed) {
	if (!documented.has(name)) {
		problems.push(`the API reference lists ${name}, which isn't exported`);
	}
}

const examples = [];
const publicSources = program
	.getSourceFiles()
	.filter(
		(file) =>
			file.fileName.startsWith(path.join(root, "src")) &&
			!file.fileName.includes(`${path.sep}internal${path.sep}`),
	);
for (const source of publicSources) {
	const text = source.text;
	for (const comment of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
		const firstLine = text.slice(0, comment.index).split("\n").length;
		const lines = comment[0]
			.split("\n")
			.map((line) => line.replace(/^\s*\*\s?/, ""));
		examples.push(
			...codeBlocks(source.fileName, lines, firstLine, (problem) =>
				problems.push(problem),
			),
		);
	}
}
examples.push(...markdownExamples((problem) => problems.push(problem)));

const virtual = new Map();
examples.forEach((example, index) => {
	const fileName = path.join(
		root,
		".docs-check",
		example.name ?? `example-${index}.${example.extension}`,
	);
	const taken = virtual.get(fileName);
	if (taken === undefined) {
		virtual.set(fileName, example);
	} else {
		problems.push(
			`${relative(example.file)}:${example.line}: another block is named ${example.name} (${relative(taken.file)}:${taken.line})`,
		);
	}
});
const host = ts.createCompilerHost(options);
const getSourceFile = host.getSourceFile.bind(host);
// Examples compile in several programs (below); the cache parses the library
// and its dependencies once for all of them.
const sourceFiles = new Map();
host.getSourceFile = (fileName, languageVersion, ...rest) => {
	const example = virtual.get(fileName);
	if (example === undefined) {
		if (!sourceFiles.has(fileName)) {
			sourceFiles.set(
				fileName,
				getSourceFile(fileName, languageVersion, ...rest),
			);
		}
		return sourceFiles.get(fileName);
	}
	return ts.createSourceFile(
		fileName,
		`${example.code}\nexport {};\n`,
		languageVersion,
		true,
	);
};
const fileExists = host.fileExists.bind(host);
host.fileExists = (fileName) => virtual.has(fileName) || fileExists(fileName);
const directoryExists = host.directoryExists?.bind(host);
host.directoryExists = (directory) =>
	directory === path.join(root, ".docs-check") ||
	(directoryExists?.(directory) ?? true);

// An augmentation applies to every file in a program, so each example that
// has one compiles on its own. Named files and the examples that import them
// share one program, with the named files' augmentations. The rest share
// another.
const fileNames = [...virtual.keys()];
const named = fileNames.filter((fileName) => usesNamed(virtual.get(fileName)));
for (const fileName of named) {
	const example = virtual.get(fileName);
	if (example.name === undefined && augments(example)) {
		problems.push(
			`${relative(example.file)}:${example.line}: imports a named block and augments a module, which would change the named blocks' types; name it, or drop one of the two`,
		);
	}
}
const unnamed = fileNames.filter(
	(fileName) => !usesNamed(virtual.get(fileName)),
);
const groups = [
	named,
	unnamed.filter((fileName) => !augments(virtual.get(fileName))),
	...unnamed
		.filter((fileName) => augments(virtual.get(fileName)))
		.map((fileName) => [fileName]),
].filter((group) => group.length > 0);
for (const group of groups) {
	const examplesProgram = ts.createProgram(
		[...group, shims["react-native"]],
		options,
		host,
	);
	for (const diagnostic of ts.getPreEmitDiagnostics(examplesProgram)) {
		const example = diagnostic.file && virtual.get(diagnostic.file.fileName);
		if (!example) {
			continue;
		}
		const { line } = diagnostic.file.getLineAndCharacterOfPosition(
			diagnostic.start ?? 0,
		);
		const message = ts.flattenDiagnosticMessageText(
			diagnostic.messageText,
			"\n",
		);
		problems.push(
			`${relative(example.file)}:${example.line + line}: example doesn't compile: TS${diagnostic.code} ${message}`,
		);
	}
}

if (problems.length > 0) {
	console.error(problems.map((problem) => `✗ ${problem}`).join("\n"));
	process.exit(1);
}
console.log(
	`✓ ${exportCount} exports documented, ${examples.length} examples compile`,
);
