import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { getSlugs } from "fumadocs-core/source";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig, type Plugin } from "vite";

import { landingData } from "./src/lib/landing-data.ts";
import { mdxOptions } from "./src/lib/mdx-options.ts";

// Every docs page, so the prerender doesn't depend on the sidebar linking to
// each one: an older line's pages only the version dropdown links to. Read
// from this file's folder, wherever the build runs from.
const docsPages: { path: string }[] = [];
for await (const entry of glob("**/*.mdx", {
	cwd: join(import.meta.dirname, "content/docs"),
}))
	docsPages.push({ path: ["/docs", ...getSlugs(entry)].join("/") });
if (docsPages.length === 0)
	throw new Error("No docs pages in content/docs to prerender");

// The package's version, which names the current docs in the version dropdown.
const { version } = JSON.parse(
	readFileSync(join(import.meta.dirname, "../package.json"), "utf8"),
) as { version: string };

// The live site, or, on a Cloudflare Pages preview (`main` and pull
// requests), the preview's own address, so its Markdown links stay on it.
const PRODUCTION = "https://effetch-query.pages.dev";
const preview =
	process.env.CF_PAGES_BRANCH && process.env.CF_PAGES_BRANCH !== "site";
const siteUrl = (preview && process.env.CF_PAGES_URL) || PRODUCTION;

/**
 * The landing page's code and the scene's labels, read from the docs'
 * examples as `virtual:landing`. Computed once per build or dev server.
 */
function landing(build: boolean): Plugin {
	const id = "virtual:landing";
	let module: Promise<string> | undefined;
	return {
		name: "effetch-query-landing",
		resolveId: (source) => (source === id ? `\0${id}` : undefined),
		load(resolved) {
			if (resolved !== `\0${id}`) return;
			module ??= landingData(build).then(
				(data) => `export default ${JSON.stringify(data)};`,
			);
			return module;
		},
	};
}

export default defineConfig(({ command }) => ({
	define: {
		__PACKAGE_VERSION__: JSON.stringify(version),
		__SOURCE_REF__: JSON.stringify(process.env.CF_PAGES_COMMIT_SHA || "main"),
		__SITE_URL__: JSON.stringify(siteUrl),
	},
	plugins: [
		// The pages' MDX options run here, in the build, never in the browser.
		fumadocsMdx({
			globalOptions: { mdxOptions: mdxOptions(command === "build") },
		}),
		landing(command === "build"),
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
				// A link to a heading on another page is that page again.
				filter: ({ path }) => !path.includes("#"),
			},
			// Routes no page links to, so the crawler doesn't find them.
			pages: [
				...docsPages,
				{ path: "/api/search" },
				{ path: "/llms.txt" },
				{ path: "/llms-full.txt" },
				{ path: "/robots.txt" },
				{ path: "/sitemap.xml" },
				// Written to `404.html` at the output's root.
				{ path: "/404" },
			],
		}),
		react(),
	],
	resolve: {
		tsconfigPaths: true,
	},
	// TypeScript locates its own files from where it's installed, so it and
	// Twoslash stay out of the server bundle.
	ssr: {
		external: ["fumadocs-twoslash", "typescript"],
	},
}));
