import { createFileRoute } from "@tanstack/react-router";
import type { Folder, Node } from "fumadocs-core/page-tree";

import { gitConfig, SITE_URL } from "@/lib/shared";
import { currentFolder, docsLlms } from "@/lib/source";

const GITHUB = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

/**
 * The docs in the sidebar's order, one H2 section per folder, as llms.txt
 * sections its links. The pages before the first folder are the place to
 * start; a page after it is a section of its own, as is a separator.
 */
function sections(folder: Folder): string[] {
	const lines = ["", "## Get started", ""];
	const nodes: Node[] = folder.index ? [folder.index] : [];
	let started = false;
	for (const node of [...nodes, ...folder.children]) {
		if (node.type === "separator") {
			lines.push("", `## ${String(node.name)}`, "");
			started = true;
			continue;
		}
		if (node.type === "folder" || started) {
			started = true;
			if (lines.at(-1) !== "") lines.push("");
			const children =
				node.type === "folder"
					? [...(node.index ? [node.index] : []), ...node.children]
					: [node];
			lines.push(`## ${String(node.name)}`, "");
			for (const child of children) lines.push(docsLlms.indexNode(child));
			lines.push("");
			continue;
		}
		lines.push(docsLlms.indexNode(node));
	}
	return lines;
}

export const Route = createFileRoute("/llms.txt")({
	server: {
		handlers: {
			GET: () =>
				new Response(
					[
						"# Effetch Query",
						"",
						"> Server state for Effect apps, inspired by TanStack Query. Effetch Query loads data once, shares it between every component that shows it, keeps it fresh in the background, and updates it when you change something. A query is an Effect that runs with your app's services, its errors stay typed all the way to the component, and the cache is something your Effect programs can read and write. It works in React, React Native and code with no UI at all.",
						"",
						`Each link in the sections up to Optional is a page as Markdown, in the order the docs read. [llms-full.txt](${SITE_URL}/llms-full.txt) has every page in one file. They cover the newest release of \`@monarcode/effetch-query\`.`,
						...sections(currentFolder()),
						"## Optional",
						"",
						`- [Changelog](https://raw.githubusercontent.com/${gitConfig.user}/${gitConfig.repo}/${gitConfig.ref}/CHANGELOG.md): What changed in each release, and what to change in your code, as Markdown.`,
						`- [Source on GitHub](${GITHUB}): The package's source, its tests and runnable examples.`,
						"- [Package on npm](https://www.npmjs.com/package/@monarcode/effetch-query): The published versions of `@monarcode/effetch-query`.",
						"- [Effetch](https://effetch.pages.dev/llms.txt): The typed HTTP client for Effect that Effetch Query pairs with, as its own llms.txt.",
						"",
					].join("\n"),
					{ headers: { "Content-Type": "text/plain; charset=utf-8" } },
				),
		},
	},
});
