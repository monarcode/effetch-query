import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { staticFunctionMiddleware } from "@tanstack/start-static-server-functions";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { Callout } from "fumadocs-ui/components/callout";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
	MarkdownCopyButton,
	ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { Suspense, use } from "react";

import { useMDXComponents } from "@/components/mdx";
import { SidebarFooter } from "@/components/sidebar-footer";
import { docs } from "@/lib/docs";
import { baseOptions } from "@/lib/layout.shared";
import {
	getPageMarkdownUrl,
	gitConfig,
	LATEST,
	latestLabel,
	pageHead,
	SITE_URL,
	versionOfPath,
	websiteNode,
} from "@/lib/shared";
// Used only by the server function's handler, which the client build drops.
import { pageFolders, source } from "@/lib/source";

export const Route = createFileRoute("/docs/$")({
	component: Page,
	loader: async ({ params }) => {
		const slugs = params._splat?.split("/") ?? [];
		const data = await pageData(slugs);
		await docs.getPage(data.path)?.preload();
		return data;
	},
	head: ({ loaderData }) => {
		if (!loaderData) return {};
		const { title, description, url, markdownUrl, folders, older } =
			loaderData;
		const head = pageHead({
			title: `${title} | Effetch Query`,
			description,
			path: url,
			type: "article",
			markdown: markdownUrl,
			jsonLd: [
				{
					"@context": "https://schema.org",
					"@type": "TechArticle",
					headline: title,
					description,
					url: SITE_URL + url,
					inLanguage: "en",
					// Whole, since a reader may take one page at a time.
					isPartOf: websiteNode(),
				},
				// Search results show the trail. An older line's pages aren't
				// indexed, and their trail would start in the current docs.
				...(older
					? []
					: [
							{
								"@context": "https://schema.org",
								"@type": "BreadcrumbList",
								itemListElement: [
									{ name: "Docs", url: "/docs" },
									...folders,
									{ name: title, url },
								]
									// The first page's own crumb would repeat Docs.
									.filter(
										(crumb, i, all) =>
											all.findIndex((c) => c.url === crumb.url) ===
											i,
									)
									.map((crumb, i) => ({
										"@type": "ListItem",
										position: i + 1,
										name: crumb.name,
										item: SITE_URL + crumb.url,
									})),
							},
						]),
			],
		});
		// Older lines stay out of search engines, which send readers to the
		// current docs instead.
		return older
			? {
					...head,
					meta: [...head.meta, { name: "robots", content: "noindex" }],
				}
			: head;
	},
});

/**
 * In the browser, a page's data is a JSON file. A missing page has none, so
 * the host answers with its 404 page, which fails to parse.
 */
async function pageData(slugs: string[]) {
	try {
		return await loader({ data: slugs });
	} catch (error) {
		if (error instanceof SyntaxError) throw notFound();
		throw error;
	}
}

const loader = createServerFn({ method: "GET" })
	.validator((slugs: string[]) => slugs)
	.middleware([staticFunctionMiddleware])
	.handler(async ({ data: slugs }) => {
		const page = source.getPage(slugs);
		if (!page) throw notFound();
		const version = versionOfPath(page.path);
		const older =
			version === LATEST
				? undefined
				: {
						version,
						// The same page in the current line, or its first page.
						latestUrl: source.getPage(slugs.slice(1))?.url ?? "/docs",
					};
		return {
			path: page.path,
			url: page.url,
			folders: pageFolders(page.url),
			title: page.data.title ?? "",
			description: page.data.description ?? "",
			markdownUrl: getPageMarkdownUrl(page).url,
			pageTree: await source.serializePageTree(source.getPageTree()),
			older,
		};
	});

type Older = { version: string; latestUrl: string } | undefined;

function Content({
	path,
	markdownUrl,
	older,
}: {
	path: string;
	markdownUrl: string;
	older: Older;
}) {
	const page = docs.getPage(path);
	if (!page) throw new Error(`unknown page: ${path}`);

	const { toc } = use(page.load());
	const MDX = page.body;

	return (
		<DocsPage toc={toc}>
			{older && (
				<Callout type="warn" title="An older release">
					These docs are for Effetch Query {older.version}. The latest is{" "}
					{latestLabel()}:{" "}
					<Link to={older.latestUrl}>read this page there</Link>.
				</Callout>
			)}
			<DocsTitle>{page.title}</DocsTitle>
			<DocsDescription>{page.description}</DocsDescription>
			<div className="flex flex-row flex-wrap items-center gap-2 border-b pb-6">
				<MarkdownCopyButton markdownUrl={markdownUrl} />
				<ViewOptionsPopover
					markdownUrl={markdownUrl}
					githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.ref}/site/content/docs/${encodeURI(path)}`}
				/>
			</div>
			<DocsBody>
				<MDX components={useMDXComponents()} />
			</DocsBody>
		</DocsPage>
	);
}

function Page() {
	const { pageTree, path, markdownUrl, older } = useFumadocsLoader(
		Route.useLoaderData(),
	);

	return (
		<DocsLayout
			{...baseOptions()}
			// The sidebar's footer links to GitHub with the rest.
			githubUrl={undefined}
			tree={pageTree}
			sidebar={{ footer: <SidebarFooter /> }}
		>
			{/* For the prerender's crawler, which then writes every `.md` file. */}
			<Link to={markdownUrl} hidden />
			<Suspense>
				<Content path={path} markdownUrl={markdownUrl} older={older} />
			</Suspense>
		</DocsLayout>
	);
}
