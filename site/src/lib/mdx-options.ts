import type { MDXPresetOptions } from "fumadocs-mdx/config";

/*
 * How pages compile, for the build only: `vite.config.ts` hands these to
 * Fumadocs MDX as its global options. Kept out of `docs.ts`, which the
 * browser loads.
 */

interface Node {
	type: string;
	meta?: string | null | undefined;
	children?: Node[] | undefined;
}

// A block named by its file, as in "```ts todos.ts", which the docs check
// reads as that file.
const fileName = /^[\w.-]+\.tsx?$/;

/**
 * Shows a block's file name as its title. The docs check names blocks
 * "```ts todos.ts", which Fumadocs would drop: its title is
 * `title="todos.ts"`. Readers need the name, since other pages import the
 * file (`./todos.js`).
 */
function remarkFileTitles() {
	const visit = (node: Node) => {
		if (node.type === "code" && node.meta && fileName.test(node.meta.trim()))
			node.meta = `title="${node.meta.trim()}"`;
		node.children?.forEach(visit);
	};
	return visit;
}

/** The pages' MDX options. */
export const mdxOptions: MDXPresetOptions = {
	remarkPlugins: (plugins) => [remarkFileTitles, ...plugins],
};
