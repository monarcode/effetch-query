import { readFileSync } from "node:fs";
import path from "node:path";

import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import type { MDXPresetOptions } from "fumadocs-mdx/config";
import { transformerTwoslash } from "fumadocs-twoslash";
import { createGenerator, remarkAutoTypeTable } from "fumadocs-typescript";
import type { Element, ElementContent, Root, RootContent } from "hast";
import ts from "typescript";

import {
	augments,
	codeBlocks,
	companions,
	markdownExamples,
	root,
	shims,
	sitePages,
	type Example,
} from "../../../scripts/docs-examples.mjs";
import { codeTheme } from "./code-theme.ts";

/*
 * How pages compile, for the build only: `vite.config.ts` hands these to
 * Fumadocs MDX as its global options. Kept out of `docs.ts`, which the
 * browser loads: TypeScript would ship to every reader.
 */

interface Node {
	type: string;
	meta?: string | null | undefined;
	children?: Node[] | undefined;
}

// A block named by its file, as in "```ts todos.ts", which the docs check
// reads as that file, with or without `no-twoslash` after it.
const fileName = /^([\w.-]+\.tsx?)(\s+no-?twoslash)?$/;

/**
 * Shows a block's file name as its title. The docs check names blocks
 * "```ts todos.ts", which Fumadocs would drop: its title is
 * `title="todos.ts"`. Readers need the name, since other pages import the
 * file (`./todos.js`).
 */
function remarkFileTitles() {
	const visit = (node: Node) => {
		const named =
			node.type === "code" && node.meta
				? fileName.exec(node.meta.trim())
				: null;
		if (named) node.meta = `title="${named[1]}"${named[2] ?? ""}`;
		node.children?.forEach(visit);
	};
	return visit;
}

/**
 * The compiler options examples are typed with: the root `tsconfig.json`'s,
 * which `check-docs` compiles them with, without `paths`. Those point at
 * `src`, and the types shown should be what readers get, the built `dist`
 * with the namespace docs the build puts back. Twoslash runs from the
 * repository, so `@monarcode/effetch-query` resolves to `dist` through the
 * package's own `exports`.
 */
function exampleCompilerOptions() {
	const file = path.join(root, "tsconfig.json");
	const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
	if (error)
		throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
	const options = { ...config.compilerOptions };
	// The language service plugin is for editors.
	delete options.paths;
	delete options.plugins;
	// The shims declare whole modules, which a file made a module by force
	// would read as augmentations of modules that don't exist.
	options.moduleDetection = "auto";
	return options as Record<string, unknown>;
}

/**
 * What to do with a type error in an example. `vite build` fails, as
 * `check-docs` would. The dev server logs it and shows the example without
 * hovers instead: a thrown error stops the server while a page is written.
 */
function twoslashErrors(build: boolean) {
	return (error: unknown, code: string) => {
		if (build) throw error;
		console.error(error);
		const start = code.indexOf(CUT);
		return start === -1 ? code : code.slice(start + CUT.length);
	};
}

// A list item, bulleted or numbered.
const LIST_ITEM = /^\s*(?:-|\d+[.)]) /;

/**
 * A hover's docs: their first paragraph, and a list after it when the
 * paragraph doesn't end a sentence, as one ending in a colon doesn't.
 */
function firstParagraph(docs: string) {
	const [first = "", next = ""] = docs.split(/\n\s*\n/);
	return !/[.!?]\s*$/.test(first) && LIST_ITEM.test(next)
		? `${first}\n\n${next}`
		: first;
}

/**
 * Formats a hover's type as fumadocs-twoslash's default does, except that a
 * namespace keeps its `namespace Query` line. The default drops it, which
 * leaves `Query` and the other namespaces without a popup.
 */
function processHoverInfo(info: string) {
	const content = info
		.replace(/^\(([\w-]+)\)\s+/gm, "")
		.replace(/\nimport .*$/, "")
		.trim();
	if (/^namespace \w+$/.test(content)) return content;
	const rest = content.replace(/^(interface|namespace) \w+$/gm, "").trim();
	if (/^[A-Z]\w*(?:<[^>]*>)?:/.test(rest)) return `type ${rest}`;
	if (/^\w*\(/.test(rest)) return `function ${rest}`;
	return rest;
}

// Tags a hover leaves out: the page around it is the example.
const PAGE_TAGS = new Set(["example", "since"]);
// Twoslash's own opt-outs.
const OPT_OUT = /(?:^|\s)no-?twoslash(?:\s|$)/;
const CUT = "// ---cut---\n";
const TYPESCRIPT = new Set(["language-ts", "language-tsx"]);
const PACKAGE = "@monarcode/effetch-query";
/** The site's own folder, which the type tables' paths start from. */
const site = path.join(root, "site");
// The hovers Twoslash's TypeScript 7 leaves untyped when a name is used in a
// type: an imported namespace (`(alias) const QueryClient: any`, or
// `const HttpClient: any` for `import * as`) and a DOM global
// (`var Promise: any`), before `processHoverInfo` tidies them.
const UNTYPED_CONST = /^(?:\(alias\) )?const (\w+): any(?:\nimport \w+)?$/;
const UNTYPED_GLOBAL = /^var \w+: any$/;

/**
 * Whether a hover is one of those. A `const` counts only when the block
 * imports its name, so a local that really is `any` keeps its hover.
 */
function untyped(hover: { text: string; target: string }, source: string) {
	if (UNTYPED_GLOBAL.test(hover.text)) return true;
	if (!UNTYPED_CONST.test(hover.text)) return false;
	const name = hover.target.replace(/[$]/g, "\\$&");
	return new RegExp(
		`import\\s+(?:type\\s+)?(?:\\*\\s+as\\s+${name}\\b|\\{[^}]*(?<![\\w$])${name}(?![\\w$])[^}]*\\})`,
	).test(source);
}

/** Every named file in the README and the pages, by name. */
export function namedExamples() {
	const named = new Map<string, Example>();
	for (const example of markdownExamples(() => {}))
		if (example.name) named.set(example.name, example);
	return named;
}

/**
 * Marks every `ts` and `tsx` block on a current page for Twoslash, unless
 * its meta says `no-twoslash`, and compiles it as `check-docs` does: with
 * the named files it imports, and those that augment `Register`, as hidden
 * files before it, so `./todos.js` resolves and its hovers show the types
 * the docs' own code gives them. Runs before `rehypeCode`, on the HTML tree,
 * so the search index and the page's Markdown keep the page as written.
 */
function rehypeExamples(build: boolean) {
	return (tree: Root, file: MdxFile) => {
		const pagePath = file.path;
		if (!pagePath?.startsWith(sitePages + path.sep)) return;
		const page = codeBlocks(
			pagePath,
			readFileSync(pagePath, "utf8").split("\n"),
			1,
			() => {},
		);
		const named = namedExamples();
		// The dev server rebuilds the page when a file it borrows changes.
		for (const other of new Set(
			page.flatMap((example) => companions(example, named)),
		))
			file.data._compiler?.addDependency(other.file);
		// The page's blocks in order, so two blocks with the same code each
		// find their own.
		let next = 0;
		visitCode(tree, (code) => {
			const meta = String(code.data?.meta ?? "");
			const source = text(code).replace(/\n$/, "");
			const found = page.findIndex(
				(candidate, index) => index >= next && candidate.code === source,
			);
			if (found === -1) {
				// It would be published unhovered, and unchecked against `dist`.
				const problem = `${path.relative(root, pagePath)}: a TypeScript block the docs check doesn't read: ${source.split("\n")[0]}`;
				if (build) throw new Error(problem);
				console.error(problem);
				return;
			}
			next = found + 1;
			const example = page[found];
			if (!example || OPT_OUT.test(meta)) return;
			code.children = [
				{ type: "text", value: twoslashSource(example, named) },
			];
			code.data = { ...code.data, meta: `${meta} twoslash`.trim() };
		});
	};
}

/**
 * An example as Twoslash compiles it, the way `check-docs` does: the named
 * files it imports, and those that augment `Register`, as hidden files
 * before it, so `./todos.js` resolves and its hovers show the types the
 * docs' own code gives them. The pages and the landing page both use it.
 */
export function twoslashSource(example: Example, named: Map<string, Example>) {
	const hidden = companions(example, named).map(
		(other) => `// @filename: ${other.name}\n${other.code}\nexport {};\n`,
	);
	const all = [example, ...companions(example, named)];
	// As `check-docs` adds them to every program.
	for (const [module, shim] of Object.entries(shims))
		hidden.push(shimFile(module, shim));
	// TypeScript resolves an augmentation's module only once a file of the
	// program imports it, which a file that only registers its services,
	// such as `api.ts`, doesn't.
	if (all.some(augments))
		hidden.push(
			`// @filename: package.ts\nimport type {} from "${PACKAGE}";\n`,
		);
	const own = example.name ?? `example.${example.extension}`;
	return [
		// Twoslash puts blocks with the same compiler options in one program,
		// where one block's `declare module` would reach the next. An export
		// condition no package has gives each block a program of its own.
		`// @customConditions: ${path.relative(root, example.file)}#${example.line}`,
		// The hidden files are `check-docs`' to report.
		"// @noErrorsCutted",
		...hidden,
		// As `check-docs` compiles it: a module, even without imports.
		`// @filename: ${own}\nexport {};`,
		CUT + example.code,
	].join("\n");
}

/**
 * A shim as a hidden file. React Native's declares its modules already;
 * Next's is a module file, which `check-docs` maps by `paths`.
 */
function shimFile(module: string, file: string) {
	const code = readFileSync(file, "utf8");
	return /\bdeclare module\b/.test(code)
		? `// @filename: ${module.replace(/\W/g, "-")}.d.ts\n${code}\n`
		: `// @filename: ${module.replace(/\W/g, "-")}.d.ts\ndeclare module "${module}" {\n${code}\n}\n`;
}

/**
 * The parts of the page's file the plugin reads. Fumadocs MDX hands its
 * compiler to plugins as `data._compiler`.
 */
interface MdxFile {
	path?: string | undefined;
	data: { _compiler?: { addDependency(file: string): void } | undefined };
}

/**
 * Calls `visit` with the `code` of each TypeScript `pre`, including those in
 * MDX components such as `<Tab>`, which aren't `element`s.
 */
function visitCode(node: Root | RootContent, visit: (code: Element) => void) {
	if (!("children" in node)) return;
	for (const child of node.children as RootContent[]) {
		const code = child.type === "element" ? child.children[0] : undefined;
		if (
			child.type === "element" &&
			child.tagName === "pre" &&
			code?.type === "element" &&
			code.tagName === "code" &&
			classes(code).some((name) => TYPESCRIPT.has(name))
		)
			visit(code);
		else visitCode(child, visit);
	}
}

function classes(node: Element) {
	const value = node.properties.className;
	return Array.isArray(value) ? value.map(String) : [];
}

function text(node: ElementContent): string {
	if (node.type === "text") return node.value;
	return "children" in node ? node.children.map(text).join("") : "";
}

/** The pages' MDX options; `build` is true for `vite build`. */
export const mdxOptions = (build: boolean): MDXPresetOptions => ({
	rehypeCodeOptions: {
		...rehypeCodeDefaultOptions,
		// The site is dark only, so both are the site's theme.
		themes: { light: codeTheme, dark: codeTheme },
		transformers: [
			...(rehypeCodeDefaultOptions.transformers ?? []),
			...twoslashTransformers(build),
		],
	},
	remarkPlugins: (plugins) => [
		remarkFileTitles,
		...plugins,
		[
			remarkAutoTypeTable,
			{
				// No cache: it's keyed by the page, not the types, so it would
				// keep showing an API that changed.
				generator: createGenerator({
					tsconfigPath: path.join(site, "tsconfig.json"),
				}),
				// A table's `path` starts from the site, where the workspace
				// link `node_modules/@monarcode/effetch-query` points at the
				// package.
				options: { basePath: site },
			},
		],
	],
	// Before `rehypeCode`, which highlights what it leaves.
	rehypePlugins: (plugins) => [[rehypeExamples, build], ...plugins],
});

/** Type hovers on an example, for the pages and the landing page. */
export const twoslashTransformers = (
	build: boolean,
): ReturnType<typeof transformerTwoslash>[] => [
	// Type hovers on every example. A type error fails the build. No
	// cache: it's keyed by the block, so it would hide a change to the
	// types.
	transformerTwoslash({
		twoslashOptions: {
			cwd: root,
			compilerOptions: exampleCompilerOptions(),
		},
		rendererRich: { processHoverInfo },
		onTwoslashError: twoslashErrors(build),
	}),
	// A hover shows a name's type and its docs' first paragraph, with
	// the tags that say how to use it, such as `@default`. The export's
	// own example and its version stay out: the page is the example,
	// and every hover ships in the page. Runs before Twoslash renders
	// its popups.
	{
		name: "hover-docs",
		tokens() {
			const nodes = this.meta.twoslash?.nodes ?? [];
			// A namespace named in a type, as `QueryClient` is in
			// `QueryClient.QueryClient`, hovers as `const QueryClient: any`
			// under Twoslash's TypeScript 7. It takes the hover the same
			// name has elsewhere in the block, or else says what it is: a
			// name that qualifies others is a namespace.
			const source = this.source;
			const known = new Map(
				nodes.flatMap((node) =>
					node.type === "hover" && !untyped(node, source)
						? [[node.target, node] as const]
						: [],
				),
			);
			for (const node of nodes) {
				if (node.type !== "hover") continue;
				const same = untyped(node, source)
					? known.get(node.target)
					: undefined;
				if (same)
					Object.assign(node, {
						text: same.text,
						docs: same.docs,
						tags: same.tags,
					});
				else if (
					untyped(node, source) &&
					new RegExp(
						`(?<![\\w$])${node.target.replace(/[$]/g, "\\$&")}\\.`,
					).test(source)
				)
					node.text = `namespace ${node.target}`;
				if (node.docs) node.docs = firstParagraph(node.docs);
				if (node.tags)
					node.tags = node.tags.filter(([name]) => !PAGE_TAGS.has(name));
			}
			// A global named in a type, such as `Promise`, has no hover to
			// borrow: it shows none rather than a wrong one.
			for (let index = nodes.length - 1; index >= 0; index--) {
				const node = nodes[index];
				if (node?.type === "hover" && untyped(node, source))
					nodes.splice(index, 1);
			}
		},
	},
];
