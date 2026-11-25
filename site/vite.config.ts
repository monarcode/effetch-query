import { glob } from "node:fs/promises";
import { join } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { getSlugs } from "fumadocs-core/source";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite";

// Every docs page, so the prerender doesn't depend on the sidebar linking to
// each one. Read from this file's folder, wherever the build runs from.
const docsPages: { path: string }[] = [];
for await (const entry of glob("**/*.mdx", {
	cwd: join(import.meta.dirname, "content/docs"),
}))
	docsPages.push({ path: ["/docs", ...getSlugs(entry)].join("/") });
if (docsPages.length === 0)
	throw new Error("No docs pages in content/docs to prerender");

export default defineConfig({
	plugins: [
		fumadocsMdx(),
		tailwindcss(),
		tanstackStart({
			// Static files only: every page is prerendered to HTML at build time,
			// as `docs/installation.html` rather than `docs/installation/index.html`.
			// Cloudflare Pages serves the file at `/docs/installation`, the URL
			// every link uses; a folder's `index.html` would redirect it to a URL
			// with a trailing slash.
			prerender: {
				enabled: true,
				crawlLinks: true,
				autoSubfolderIndex: false,
			},
			// Routes no page links to, so the crawler doesn't find them.
			pages: [
				...docsPages,
				{ path: "/api/search" },
				// Written to `404.html` at the output's root.
				{ path: "/404" },
			],
		}),
		react(),
	],
	resolve: {
		tsconfigPaths: true,
	},
});
