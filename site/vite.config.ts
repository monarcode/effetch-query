import { readFileSync } from "node:fs";
import { glob, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { getSlugs } from "fumadocs-core/source";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig, type Plugin } from "vite";

import { landingData } from "./src/lib/landing-data.ts";
import { mdxOptions } from "./src/lib/mdx-options.ts";
import {
	HOME_IMAGE_PATH,
	IMAGE_AS_BASE64,
	pageImagePath,
	TOUCH_ICON_PATH,
} from "./src/lib/og.ts";

const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// The link-preview images and the home-screen icon. The prerender writes
// each response as text, which would corrupt a PNG, so it asks for the
// image as base64 and this writes the bytes over the text it saved.
const imagePrerender = {
	headers: { [IMAGE_AS_BASE64]: "true" },
	onSuccess: async ({
		page,
		html,
	}: {
		page: { path: string };
		html: string;
	}) => {
		const file = join(import.meta.dirname, "dist/client", page.path);
		// The text must be where the prerender saved it, or the site would
		// ship base64 as the image.
		const saved = await readFile(file, "utf8").catch(() => undefined);
		if (saved !== html)
			throw new Error(
				`The prerender didn't save ${page.path} in dist/client, so its image can't be written`,
			);
		const image = Buffer.from(html, "base64");
		// A route that answered with bytes rather than base64 decodes to
		// noise without an error, so check it's a PNG.
		if (!image.subarray(0, 8).equals(PNG_SIGNATURE))
			throw new Error(
				`${page.path} didn't come back as a base64 PNG, so its image can't be written`,
			);
		await writeFile(file, image);
	},
};

// Every docs page, so the prerender doesn't depend on the sidebar linking to
// each one: an older line's pages only the version dropdown links to. Read
// from this file's folder, wherever the build runs from. Each page's image
// too, which only a meta tag names, and the crawler doesn't follow it.
const docsPages: { path: string; prerender?: typeof imagePrerender }[] = [];
for await (const entry of glob("**/*.mdx", {
	cwd: join(import.meta.dirname, "content/docs"),
})) {
	const slugs = getSlugs(entry);
	docsPages.push({ path: ["/docs", ...slugs].join("/") });
	docsPages.push({ path: pageImagePath(slugs), prerender: imagePrerender });
}
if (docsPages.length === 0)
	throw new Error("No docs pages in content/docs to prerender");

// The package's version, which names the current docs in the version dropdown.
const { version } = JSON.parse(
	readFileSync(join(import.meta.dirname, "../package.json"), "utf8"),
) as { version: string };

// The live site, or, on a Cloudflare Pages preview (`main` and pull
// requests), the preview's own address, so its Markdown links stay on it.
const PRODUCTION = "https://effetch-query.monarcode.dev";
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
				{ path: HOME_IMAGE_PATH, prerender: imagePrerender },
				{ path: TOUCH_ICON_PATH, prerender: imagePrerender },
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
