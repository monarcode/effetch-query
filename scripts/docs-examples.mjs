// The examples in the README and the docs site's pages, and how they
// compile. `check-docs.mjs` type-checks them, and the site's type hovers
// compile each block with the same files, so the two never disagree on what
// an example's imports are.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "..");

/**
 * The docs site's current pages. Older release lines will be snapshots of
 * released docs, so they aren't checked against the current API.
 */
export const sitePages = path.join(root, "site", "content", "docs", "(latest)");

/** The README, then the site's current pages, in path order. */
export const markdownFiles = () => [
	...["README.md"]
		.map((file) => path.join(root, file))
		.filter((file) => existsSync(file)),
	...(existsSync(sitePages)
		? readdirSync(sitePages, { recursive: true, encoding: "utf8" })
				.filter((file) => file.endsWith(".mdx"))
				.sort()
				.map((file) => path.join(sitePages, file))
		: []),
];

/**
 * Declarations for modules the examples import but the repository doesn't
 * install, by module name: React Native and NetInfo, for the
 * `./react-native` examples, and the part of Next.js the Next.js page uses.
 */
export const shims = {
	"react-native": path.join(root, "test/types/react-native-modules.d.ts"),
	"next/server": path.join(root, "scripts/docs-types/next-server.d.ts"),
};

// A fence can name its block, as in "```ts todos.ts": the block is then that
// file, which other blocks import as "./todos.js", the way an app's files
// import each other. `no-twoslash` after it turns the site's hovers off.
const opening = /^```(tsx?)(?:\s+([\w.-]+\.tsx?))?(?:\s+no-?twoslash)?$/;
// Any fence: three or more backticks or tildes, then its info string. It may
// follow a list marker, as in "1. ```ts".
const fenceOpen = /^(?:(?:[-*+]|\d+[.)])\s+)*((`{3,}|~{3,}).*)$/;
// A fence in a quote, whose lines would carry the `>` into the example.
const quotedFence = /^(?:>\s*)+(?:`{3}|~{3})/;
// A TypeScript fence `opening` can't read, such as ```typescript, ~~~ts or
// ```ts title="api.ts": its example would go unchecked, so it fails instead.
const typeScriptInfo = /^\s*(?:ts|tsx|typescript|mts|cts)(?![\w-])/i;

/**
 * The ```ts and ```tsx blocks in `lines`, which start at `firstLine` of
 * `file`. Other fences are skipped whole, so a fence shown inside one isn't
 * read as an example. `report` hears of a fence that could hide an example.
 */
export function codeBlocks(file, lines, firstLine, report) {
	const relative = path.relative(root, file);
	const blocks = [];
	let block;
	lines.forEach((line, index) => {
		const fence = line.trim();
		const at = `${relative}:${firstLine + index}`;
		if (block === undefined) {
			if (quotedFence.test(fence)) {
				report(`${at}: move the code block out of the quote`);
				return;
			}
			const fenced = fenceOpen.exec(fence);
			if (fenced === null) return;
			const [, opener, ticks] = fenced;
			// CommonMark strips up to the fence's indentation from its lines,
			// as in a list item, and so does the site.
			const indent = line.indexOf(ticks);
			const info = opener.slice(ticks.length);
			const open = opening.exec(opener);
			if (open === null && typeScriptInfo.test(info)) {
				report(
					`${at}: fence TypeScript examples as \`\`\`ts or \`\`\`tsx, optionally with a file name (\`\`\`ts todos.ts)`,
				);
			}
			block = {
				at,
				ticks,
				indent,
				example: open !== null,
				file,
				line: firstLine + index + 1,
				extension: open?.[1],
				name: open?.[2],
				code: [],
			};
		} else if (
			fence[0] === block.ticks[0] &&
			new RegExp(`^\\${fence[0]}{${block.ticks.length},}$`).test(fence)
		) {
			if (block.example) {
				blocks.push({
					file: block.file,
					line: block.line,
					extension: block.extension,
					name: block.name,
					code: block.code.join("\n"),
				});
			}
			block = undefined;
		} else {
			block.code.push(line.replace(new RegExp(`^ {0,${block.indent}}`), ""));
		}
	});
	if (block !== undefined) {
		report(`${block.at}: code block isn't closed`);
	}
	return blocks;
}

/** The examples in the README and the site's pages. */
export const markdownExamples = (report) =>
	markdownFiles().flatMap((file) =>
		codeBlocks(file, readFileSync(file, "utf8").split("\n"), 1, report),
	);

/**
 * Whether an example augments a module (`declare module`, of `Register`
 * say, or `declare global`), which applies to every file in its program.
 */
export const augments = (example) =>
	/\bdeclare\s+(?:module|global)\b/.test(example.code);

/**
 * Whether an example is a named file, or imports one. Those compile in one
 * program, with the named files' augmentations; the rest compile without.
 */
export const usesNamed = (example) =>
	example.name !== undefined || /from\s+["']\.\//.test(example.code);

/** The named files an example imports, as `./todos.js` names `todos.ts`. */
const importsOf = (example, named) =>
	[...example.code.matchAll(/from\s+["']\.\/([\w.-]+)\.js["']/g)].flatMap(
		([, base]) =>
			[`${base}.ts`, `${base}.tsx`].filter((name) => named.has(name)),
	);

/**
 * The other named files `example` compiles with, as `check-docs` compiles
 * it, for a reader of its types: the files it imports, theirs in turn, and
 * every named file that augments a module, since an augmentation reaches
 * the whole program. None for an example that doesn't use named files.
 * `named` maps each name to its example.
 */
export function companions(example, named) {
	if (!usesNamed(example)) return [];
	const found = new Set();
	const visit = (name) => {
		if (found.has(name)) return;
		found.add(name);
		importsOf(named.get(name), named).forEach(visit);
	};
	importsOf(example, named).forEach(visit);
	for (const [name, other] of named) if (augments(other)) visit(name);
	found.delete(example.name);
	return [...found].map((name) => named.get(name));
}
