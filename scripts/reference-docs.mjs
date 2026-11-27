#!/usr/bin/env node
// Writes the docs site's API reference from the JSDoc: a page per namespace
// and entry point, listing every export with its docs (examples aside) and,
// for an interface, a table of its properties (`ownShape` says which),
// grouped by the guide that covers it.
//
//   pnpm run docs:reference
//
// `check-docs` renders the same pages and fails when the files differ, so the
// reference can't fall behind the code. Don't edit the pages by hand.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const OUT = "site/content/docs/(latest)/reference";
/** Where the type tables read the declarations: the site's workspace link. */
const DIST = "node_modules/@monarcode/effetch-query/dist";
const PACKAGE = "@monarcode/effetch-query";

/** Each entry point's module specifier, by its source file. */
const SPECIFIERS = {
	"src/index.ts": PACKAGE,
	"src/react/index.ts": `${PACKAGE}/react`,
	"src/effetch/index.ts": `${PACKAGE}/effetch`,
	"src/react-native/index.ts": `${PACKAGE}/react-native`,
	"src/react/tanstack-router/index.ts": `${PACKAGE}/react/tanstack-router`,
};

/**
 * Each page: the module whose exports it lists, the entry point readers
 * import them from, the name they reach them through, and its groups, each
 * with the guide that covers it. Every export needs a group in `names`; one
 * without fails the render, so a new export can't be left off.
 */
const PAGES = [
	{
		slug: "core",
		title: "@monarcode/effetch-query",
		description:
			"The core entry point: its namespaces, and the two names it exports at the top level.",
		related: "the core entry point's namespaces and top-level names.",
		module: "src/index.ts",
		entry: "src/index.ts",
		intro: "`@monarcode/effetch-query` is the core entry point. It has no framework in it, so it works in React, React Native and code with no UI at all. It exports six namespaces, each with a page of its own, and two names at the top level. Import what you use:",
		importLine:
			'import {\n  Entity,\n  InfiniteQuery,\n  Mutation,\n  Query,\n  QueryClient,\n  QueryFailure,\n  Signals,\n  type Register,\n} from "@monarcode/effetch-query";',
		namespaces: true,
		groups: [
			[
				"Register your services",
				[
					"Register your services",
					"/docs/getting-started#1-describe-your-api",
				],
			],
			[
				"Suspense and error boundaries",
				["Suspense and error boundaries", "/docs/react/suspense"],
			],
		],
		names: {
			Register: "Register your services",
			QueryFailure: "Suspense and error boundaries",
		},
	},
	{
		slug: "query",
		title: "Query",
		description:
			"Every member of the Query namespace: defining queries, keys and targets, streams, and reading and writing the cache from Effect.",
		related: "defining queries, keys and targets, and the cache from Effect.",
		module: "src/Query.ts",
		entry: "src/index.ts",
		qualifier: "Query",
		importLine: 'import { Query } from "@monarcode/effetch-query";',
		intro: "`Query` defines queries, and reads and writes the cache from Effect. Import it from the core entry point:",
		first: ["make", "family", "Query"],
		groups: [
			[
				"Define queries",
				["Define queries", "/docs/getting-started#3-define-your-queries"],
			],
			["Queries", ["Queries", "/docs/queries/without-effetch"]],
			["Query options", ["Query options", "/docs/queries/options"]],
			[
				"Keep copies in sync",
				["Keep copies in sync", "/docs/cache/entity-sync"],
			],
			["Query keys", ["Query keys", "/docs/queries/keys"]],
			[
				"Queries that read other queries",
				["Queries that read other queries", "/docs/queries/dependent"],
			],
			["Send the cache", ["Send the cache", "/docs/server-rendering"]],
			[
				"Queries from a stream",
				["Queries from a stream", "/docs/queries/streams"],
			],
			[
				"Use the cache from Effect",
				["Use the cache from Effect", "/docs/cache"],
			],
			["Targets", ["Targets", "/docs/queries/keys#targets"]],
		],
		names: {
			make: "Define queries",
			MakeOptions: "Define queries",
			family: "Define queries",
			FamilyOptions: "Define queries",
			Family: "Define queries",
			Query: "Queries",
			Options: "Query options",
			EntitiesOptions: "Keep copies in sync",
			Key: "Query keys",
			RunContext: "Queries that read other queries",
			Schema: "Send the cache",
			stream: "Queries from a stream",
			MakeStreamOptions: "Queries from a stream",
			streamFamily: "Queries from a stream",
			StreamFamilyOptions: "Queries from a stream",
			StreamOptions: "Queries from a stream",
			fetch: "Use the cache from Effect",
			prefetch: "Use the cache from Effect",
			get: "Use the cache from Effect",
			set: "Use the cache from Effect",
			update: "Use the cache from Effect",
			invalidate: "Use the cache from Effect",
			refetch: "Use the cache from Effect",
			reset: "Use the cache from Effect",
			clear: "Use the cache from Effect",
			Target: "Targets",
			group: "Targets",
			Group: "Targets",
			GroupTargets: "Targets",
			KeyHoldsTargetError: "Targets",
			TypeId: "Queries",
			isQuery: "Queries",
		},
	},
	{
		slug: "infinite-query",
		title: "InfiniteQuery",
		description:
			"Every member of the InfiniteQuery namespace: queries that load a list one page at a time.",
		related: "queries that load a list one page at a time.",
		module: "src/InfiniteQuery.ts",
		entry: "src/index.ts",
		qualifier: "InfiniteQuery",
		importLine: 'import { InfiniteQuery } from "@monarcode/effetch-query";',
		intro: "`InfiniteQuery` defines queries that load a list one page at a time, and loads more pages. Import it from the core entry point:",
		first: ["make", "family"],
		groups: [
			["Infinite queries", ["Infinite queries", "/docs/queries/infinite"]],
			["Load more", ["Load more", "/docs/queries/infinite#load-more"]],
			["Send the cache", ["Send the cache", "/docs/server-rendering"]],
		],
		names: {
			make: "Infinite queries",
			MakeOptions: "Infinite queries",
			family: "Infinite queries",
			FamilyOptions: "Infinite queries",
			Family: "Infinite queries",
			InfiniteQuery: "Infinite queries",
			InfiniteData: "Infinite queries",
			PageOptions: "Infinite queries",
			PageParamFunction: "Infinite queries",
			fetchNextPage: "Load more",
			fetchPreviousPage: "Load more",
			Schema: "Send the cache",
			TypeId: "Infinite queries",
			isInfiniteQuery: "Infinite queries",
		},
	},
	{
		slug: "mutation",
		title: "Mutation",
		description:
			"Every member of the Mutation namespace: defining and running mutations.",
		related: "defining and running mutations.",
		module: "src/Mutation.ts",
		entry: "src/index.ts",
		qualifier: "Mutation",
		importLine: 'import { Mutation } from "@monarcode/effetch-query";',
		intro: "`Mutation` defines mutations, and runs them from Effect. Import it from the core entry point:",
		first: ["make"],
		groups: [
			["Define a mutation", ["Define a mutation", "/docs/mutations"]],
			["Mutation options", ["Mutation options", "/docs/mutations/options"]],
			["Run a mutation", ["Run a mutation", "/docs/mutations/run"]],
		],
		names: {
			make: "Define a mutation",
			MakeOptions: "Mutation options",
			Mutation: "Define a mutation",
			run: "Run a mutation",
			TypeId: "Define a mutation",
			isMutation: "Define a mutation",
		},
	},
	{
		slug: "entity",
		title: "Entity",
		description:
			"Every member of the Entity namespace: records whose cached copies a write updates everywhere.",
		related: "records whose every cached copy a write updates.",
		module: "src/Entity.ts",
		entry: "src/index.ts",
		qualifier: "Entity",
		importLine: 'import { Entity } from "@monarcode/effetch-query";',
		intro: "`Entity` describes a record that can sit in many queries at once, and writes every cached copy of it. Import it from the core entry point:",
		first: ["make"],
		groups: [["Entities", ["Entities", "/docs/cache/entities"]]],
		names: {
			make: "Entities",
			MakeOptions: "Entities",
			Entity: "Entities",
			update: "Entities",
			set: "Entities",
			remove: "Entities",
			get: "Entities",
			TypeId: "Entities",
			isEntity: "Entities",
		},
	},
	{
		slug: "query-client",
		title: "QueryClient",
		description:
			"Every member of the QueryClient namespace: the client, its options and hooks, and sending the cache from a server.",
		related: "the client, its options and hooks, and server rendering.",
		module: "src/QueryClient.ts",
		entry: "src/index.ts",
		qualifier: "QueryClient",
		importLine: 'import { QueryClient } from "@monarcode/effetch-query";',
		intro: "`QueryClient` makes the client that holds the cache and runs your queries, and sends that cache from a server. Import it from the core entry point:",
		first: ["make", "QueryClient"],
		groups: [
			["The client", ["The client", "/docs/client"]],
			[
				"Defaults and app-wide hooks",
				["Defaults and app-wide hooks", "/docs/client/defaults"],
			],
			[
				"Keep copies in sync",
				["Keep copies in sync", "/docs/cache/entity-sync"],
			],
			[
				"Use the cache outside Effect",
				[
					"Use the cache outside Effect",
					"/docs/cache#read-and-write-outside-effect",
				],
			],
			["Send the cache", ["Send the cache", "/docs/server-rendering"]],
			[
				"Load the cache in the browser",
				[
					"Load the cache in the browser",
					"/docs/server-rendering#3-load-the-cache-in-the-browser",
				],
			],
			[
				"Client members",
				["Client members", "/docs/client#dispose-a-client"],
			],
		],
		names: {
			make: "The client",
			layer: "The client",
			QueryClient: "The client",
			Options: "The client",
			LayerOptions: "The client",
			RuntimeOptions: "The client",
			CommonOptions: "The client",
			OptionalOptions: "The client",
			QueriesOptions: "Defaults and app-wide hooks",
			QueryDefaults: "Defaults and app-wide hooks",
			QuerySucceeded: "Defaults and app-wide hooks",
			QueryFailed: "Defaults and app-wide hooks",
			QuerySettled: "Defaults and app-wide hooks",
			MutationsOptions: "Defaults and app-wide hooks",
			MutationDefaults: "Defaults and app-wide hooks",
			EntitiesOptions: "Keep copies in sync",
			MutationStarted: "Defaults and app-wide hooks",
			MutationSucceeded: "Defaults and app-wide hooks",
			MutationFailed: "Defaults and app-wide hooks",
			MutationSettled: "Defaults and app-wide hooks",
			Hook: "Defaults and app-wide hooks",
			Register: "The client",
			Services: "The client",
			Requirements: "The client",
			get: "Use the cache outside Effect",
			dehydrate: "Send the cache",
			DehydrateOptions: "Send the cache",
			DehydratedState: "Send the cache",
			hydrate: "Load the cache in the browser",
			NonJsonKeyError: "Send the cache",
			DuplicateQueryKeyError: "Send the cache",
			disposeAfter: "Client members",
		},
	},
	{
		slug: "signals",
		title: "Signals",
		description:
			"Every member of the Signals namespace: where a client hears about focus and reconnects.",
		related: "where a client hears about focus and reconnects.",
		module: "src/Signals.ts",
		entry: "src/index.ts",
		qualifier: "Signals",
		importLine: 'import { Signals } from "@monarcode/effetch-query";',
		intro: "`Signals` tells a client when the app regains focus or the device comes back online. Import it from the core entry point:",
		groups: [
			[
				"Focus and online signals",
				[
					"Focus and online signals",
					"/docs/client#focus-and-online-signals",
				],
			],
		],
		names: {
			Signals: "Focus and online signals",
			browser: "Focus and online signals",
			none: "Focus and online signals",
		},
	},
	{
		slug: "react",
		title: "@monarcode/effetch-query/react",
		description:
			"Every export of the React entry point: the provider, the hooks and the boundaries.",
		related: "the provider, the hooks and the boundaries.",
		module: "src/react/index.ts",
		entry: "src/react/index.ts",
		intro: "`@monarcode/effetch-query/react` exports the provider, the hooks and the boundaries. Import what you use:",
		first: ["QueryProvider", "useQueryState", "UseQueryStateResult"],
		groups: [
			[
				"Provide the client",
				["Provide the client", "/docs/getting-started#4-show-a-query"],
			],
			[
				"Sign out and switch accounts",
				["Sign out and switch accounts", "/docs/cache/accounts"],
			],
			["Read a query", ["Read a query", "/docs/react"]],
			[
				"Select part of a value",
				["Select part of a value", "/docs/react#select-part-of-a-value"],
			],
			[
				"Read a query as an object",
				["Read a query as an object", "/docs/react/as-object"],
			],
			[
				"Read many queries",
				["Read many queries", "/docs/react#read-several-queries"],
			],
			[
				"Suspense and error boundaries",
				["Suspense and error boundaries", "/docs/react/suspense"],
			],
			["Refetch on demand", ["Refetch on demand", "/docs/react/refetch"]],
			["Load more", ["Load more", "/docs/queries/infinite#load-more"]],
			["Run a mutation", ["Run a mutation", "/docs/mutations/run"]],
			["Show activity", ["Show activity", "/docs/mutations/activity"]],
			[
				"Load the cache in the browser",
				[
					"Load the cache in the browser",
					"/docs/server-rendering#3-load-the-cache-in-the-browser",
				],
			],
		],
		names: {
			QueryProvider: "Provide the client",
			QueryProviderProps: "Provide the client",
			OwnedQueryProviderProps: "Sign out and switch accounts",
			useQueryClient: "Read a query",
			MissingQueryProviderError: "Read a query",
			useQuery: "Read a query",
			UseQueryOptions: "Read a query",
			UseQuerySelectOptions: "Select part of a value",
			useQueryState: "Read a query as an object",
			UseQueryStateResult: "Read a query as an object",
			UseQueryStatePending: "Read a query as an object",
			UseQueryStateSuccess: "Read a query as an object",
			UseQueryStateFailure: "Read a query as an object",
			useSuspenseQueryState: "Read a query as an object",
			UseSuspenseQueryStateResult: "Read a query as an object",
			UseSuspenseQueryStateFailure: "Read a query as an object",
			useInfiniteQueryState: "Read a query as an object",
			UseInfiniteQueryStateResult: "Read a query as an object",
			useSuspenseInfiniteQueryState: "Read a query as an object",
			UseSuspenseInfiniteQueryStateResult: "Read a query as an object",
			useQueriesState: "Read a query as an object",
			UseQueriesStateResult: "Read a query as an object",
			UseQueriesStateEntry: "Read a query as an object",
			useQueries: "Read many queries",
			UseQueriesOptions: "Read many queries",
			UseQueriesResult: "Read many queries",
			UseQueriesEntry: "Read many queries",
			useSuspenseQuery: "Suspense and error boundaries",
			UseSuspenseQueryOptions: "Suspense and error boundaries",
			QueryBoundary: "Suspense and error boundaries",
			QueryBoundaryProps: "Suspense and error boundaries",
			QueryBoundaryFailureProps: "Suspense and error boundaries",
			useResetQueryFailure: "Suspense and error boundaries",
			QueryFailure: "Suspense and error boundaries",
			useRefetch: "Refetch on demand",
			UseRefetchResult: "Refetch on demand",
			useInfiniteQuery: "Load more",
			UseInfiniteQueryResult: "Load more",
			useSuspenseInfiniteQuery: "Load more",
			UseSuspenseInfiniteQueryResult: "Load more",
			InfinitePageControls: "Load more",
			useMutation: "Run a mutation",
			UseMutationResult: "Run a mutation",
			UseMutationRunOptions: "Run a mutation",
			useMutationState: "Show activity",
			UseMutationStateRun: "Show activity",
			useIsFetching: "Show activity",
			useIsMutating: "Show activity",
			HydrationBoundary: "Load the cache in the browser",
			HydrationBoundaryProps: "Load the cache in the browser",
		},
	},
	{
		slug: "effetch",
		title: "@monarcode/effetch-query/effetch",
		description:
			"Every export of the Effetch entry point: queries and mutations from Effetch endpoints.",
		related: "queries and mutations from Effetch endpoints.",
		module: "src/effetch/index.ts",
		entry: "src/effetch/index.ts",
		intro: "`@monarcode/effetch-query/effetch` turns Effetch endpoints into queries and mutations. Import what you use:",
		first: ["fromClient"],
		groups: [
			[
				"Queries from endpoints",
				["Queries from endpoints", "/docs/queries"],
			],
			["Query keys", ["Query keys", "/docs/queries/keys"]],
			["Query errors", ["Query errors", "/docs/queries/errors"]],
			["Errors by status", ["Errors by status", "/docs/queries/errors"]],
			[
				"Queries from a stream",
				["Queries from a stream", "/docs/queries/streams"],
			],
			["Infinite queries", ["Infinite queries", "/docs/queries/infinite"]],
			["Define a mutation", ["Define a mutation", "/docs/mutations"]],
		],
		names: {
			fromClient: "Queries from endpoints",
			EndpointsOptions: "Queries from endpoints",
			Endpoints: "Queries from endpoints",
			endpoints: "Queries from endpoints",
			EndpointQuery: "Queries from endpoints",
			EndpointQueryOptions: "Queries from endpoints",
			EndpointQueryValue: "Queries from endpoints",
			EndpointQueryCallError: "Queries from endpoints",
			EndpointQueryOptionsFor: "Queries from endpoints",
			EndpointQueryArgs: "Queries from endpoints",
			EndpointQueryError: "Query keys",
			RegisteredSchema: "Queries from endpoints",
			KeyQuerySchema: "Query keys",
			ErrorSchema: "Query errors",
			RegisteredStatusErrors: "Errors by status",
			EndpointStreamOptions: "Queries from a stream",
			EndpointInfiniteQuery: "Infinite queries",
			EndpointInfiniteQueryOptions: "Infinite queries",
			EndpointPageField: "Infinite queries",
			EndpointMutationOptions: "Define a mutation",
			EndpointVariables: "Define a mutation",
		},
	},
	{
		slug: "react-native",
		title: "@monarcode/effetch-query/react-native",
		description:
			"Every export of the React Native entry point: focus and online signals from React Native's modules.",
		related: "focus and online signals for React Native.",
		module: "src/react-native/index.ts",
		entry: "src/react-native/index.ts",
		intro: "`@monarcode/effetch-query/react-native` builds a client's signals from React Native's own modules, which you pass in. Import what you use:",
		groups: [["React Native", ["React Native", "/docs/react/react-native"]]],
		names: {
			reactNativeSignals: "React Native",
			ReactNativeSignalsOptions: "React Native",
			AppStateLike: "React Native",
			NetInfoLike: "React Native",
		},
	},
	{
		slug: "tanstack-router",
		title: "@monarcode/effetch-query/react/tanstack-router",
		description:
			"Every export of the TanStack Router entry point: connecting a client to a router, and so to TanStack Start.",
		related: "connecting a client to TanStack Router and Start.",
		module: "src/react/tanstack-router/index.ts",
		entry: "src/react/tanstack-router/index.ts",
		intro: "`@monarcode/effetch-query/react/tanstack-router` connects a query client to a TanStack Router, and so to TanStack Start. Import what you use:",
		groups: [
			[
				"TanStack Router and Start",
				["TanStack Router and Start", "/docs/frameworks/tanstack-start"],
			],
		],
		names: {
			connectQueryClient: "TanStack Router and Start",
			ConnectQueryClientOptions: "TanStack Router and Start",
			ConnectDehydrateOptions: "TanStack Router and Start",
		},
	},
];

/**
 * The reference: its pages by path from the repository root, formatted as
 * Oxfmt writes them, and every export they list, as `entry:name`, such as
 * `src/index.ts:Query.make` or `src/react/index.ts:useQuery`. `program` must
 * cover each page's module; one is created when it's left out.
 */
/** The generated pages' slugs, in sidebar order. */
export const referenceSlugs = PAGES.map((page) => page.slug);

export function renderReference(program = createProgram()) {
	const checker = program.getTypeChecker();
	const pages = PAGES.map((page) => collect(page, program, checker));
	// Every entry for a symbol, for the JSDoc's links: a symbol some entry
	// points export twice, such as `QueryFailure`, links to the page it's
	// read on, or else to its first page.
	const targets = new Map();
	for (const page of pages)
		for (const entry of page.entries) {
			const list = targets.get(entry.symbol) ?? [];
			list.push({ page: page.slug, entry });
			targets.set(entry.symbol, list);
		}
	const files = new Map();
	const names = [];
	for (const page of pages) {
		files.set(
			`${OUT}/${page.slug}.mdx`,
			format(render(page, checker, targets)),
		);
		names.push(...page.entries.map((entry) => `${page.entry}:${entry.name}`));
	}
	return { files, names };
}

/** Options and props interfaces get a table even when they extend another package's. */
const OPTIONS_NAME = /(?:Options|Props)$/;

/** A page's entries, each with its symbol, group, anchor and declaration. */
function collect(page, program, checker) {
	const file = program.getSourceFile(path.join(root, page.module));
	if (!file)
		throw new Error(`reference-docs: ${page.module} isn't in the program`);
	const prefix = page.qualifier ? `${page.qualifier}.` : "";
	const entries = [];
	const exports = checker
		.getExportsOfModule(checker.getSymbolAtLocation(file))
		.filter(
			(exported) =>
				!exported.declarations?.some((node) => ts.isNamespaceExport(node)),
		)
		.sort(byName);
	for (const exported of exports) {
		const symbol = resolve(exported, checker);
		const declaration = documented(symbol);
		const source = path
			.relative(root, declaration.getSourceFile().fileName)
			.split(path.sep)
			.join("/");
		const group = Object.hasOwn(page.names, exported.name)
			? page.names[exported.name]
			: undefined;
		if (!group)
			throw new Error(
				`reference-docs: no group for ${prefix}${exported.name} (${source}). Add it to the "${page.slug}" page in scripts/reference-docs.mjs.`,
			);
		if (!page.groups.some(([title]) => title === group))
			throw new Error(
				`reference-docs: ${prefix}${exported.name} is in the "${group}" group, which the "${page.slug}" page doesn't have`,
			);
		const shape = typeDocs(symbol, declaration);
		entries.push({
			deprecated: ts
				.getJSDocTags(declaration)
				.some((tag) => tag.tagName.text === "deprecated"),
			shape,
			name: `${prefix}${exported.name}`,
			short: exported.name,
			symbol,
			declaration,
			group,
			value: Boolean(symbol.flags & ts.SymbolFlags.Value),
			table:
				(ts.isInterfaceDeclaration(declaration) &&
					OPTIONS_NAME.test(exported.name)) ||
				[declaration, shape].some(
					(node) =>
						node &&
						ts.isInterfaceDeclaration(node) &&
						hasDocs(node) &&
						node.members.length > 0 &&
						ownShape(node, checker),
				),
			source,
		});
	}
	for (const name of Object.keys(page.names))
		if (!entries.some((entry) => entry.short === name))
			throw new Error(
				`reference-docs: the "${page.slug}" page groups ${name}, which ${page.module} doesn't export`,
			);
	// Anchors: the name in lower case. A type that shares its name with a
	// value, as `Query` does with `query`, gets `-type`.
	const values = new Set(
		entries
			.filter((entry) => entry.value)
			.map((entry) => entry.short.toLowerCase()),
	);
	const ids = new Set(page.groups.map(([title]) => slug(title)));
	ids.add("namespaces");
	for (const entry of entries) {
		const id = entry.short.toLowerCase();
		entry.id = !entry.value && values.has(id) ? `${id}-type` : id;
		if (ids.has(entry.id))
			throw new Error(
				`reference-docs: two headings on ${page.slug} have the ID "${entry.id}"`,
			);
		ids.add(entry.id);
	}
	const used = new Set(entries.map((entry) => entry.group));
	for (const [title] of page.groups)
		if (!used.has(title))
			throw new Error(
				`reference-docs: the "${title}" group on ${page.slug} is empty`,
			);
	return { ...page, entries };
}

function render(page, checker, targets) {
	const importLine =
		page.importLine ??
		`import { ${page.entries
			.filter((entry) => entry.value && !entry.deprecated)
			.map((entry) => entry.short)
			.join(", ")} } from "${SPECIFIERS[page.entry]}";`;
	let body = `---
title: ${JSON.stringify(page.title)}
description: ${JSON.stringify(page.description)}
---

{/* Written by scripts/reference-docs.mjs from the JSDoc. Run \`pnpm run docs:reference\` after changing it; don't edit this page. */}

${page.intro}

\`\`\`ts
${importLine}
\`\`\`
`;
	if (page.namespaces) {
		body += `\n## Namespaces [#namespaces]\n\n`;
		for (const other of PAGES)
			if (other.qualifier)
				body += `- [\`${other.qualifier}\`](/docs/reference/${other.slug}): ${other.related}\n`;
	}
	body += `
${page.namespaces ? "Its two top-level names follow" : "Its exports follow"}, grouped by the guide that covers them, each with its
docs. Your editor shows the same docs, with an example, when you hover the
name.
`;
	for (const [title, [guide, guideUrl]] of page.groups) {
		body += `\n## ${title} [#${slug(title)}]\n\nGuide: [${guideTitle(guideUrl, guide)}](${guideUrl}).\n`;
		const first = (entry) => {
			const index = (page.first ?? []).indexOf(entry.short);
			return index === -1 ? Infinity : index;
		};
		const entries = page.entries
			.filter((entry) => entry.group === title)
			.sort(
				(a, b) =>
					first(a) - first(b) ||
					Number(b.value) - Number(a.value) ||
					byName(a, b),
			);
		for (const entry of entries) {
			body += `\n### ${entry.name} [#${entry.id}]\n\n${docsOf(entry, page, checker, targets)}\n`;
			if (entry.table) {
				const declared = entry.source
					.replace(/^src\//, "")
					.replace(/\.tsx?$/, ".d.ts");
				body += `\n<auto-type-table path="${DIST}/${declared}" name="${entry.short}" />\n`;
			}
		}
	}
	return body;
}

// A list item, bulleted or numbered.
const LIST_ITEM = /^\s*(?:-|\d+[.)]) /;

/**
 * An entry's docs without their examples, which the hover shows. For a name
 * that's both a type and a value, such as `QueryClient`, the type's docs
 * come first: they say what the thing is, and the value's what it's for.
 * A link to an export on the reference becomes a link to its entry; others
 * become code.
 */
function docsOf(entry, page, checker, targets) {
	const parts = [];
	if (entry.shape)
		parts.push(...blocksOf(entry.shape, page, checker, targets));
	parts.push(...blocksOf(entry.declaration, page, checker, targets));
	const doc = jsDoc(entry.declaration);
	const deprecated = doc?.tags?.find(
		(tag) => tag.tagName.text === "deprecated",
	);
	if (deprecated) {
		const note = commentText(
			deprecated.comment,
			page,
			checker,
			targets,
		).trim();
		parts.unshift(`**Deprecated.**${note ? ` ${note}` : ""}`);
	}
	return parts.map(toMarkdown).join("\n\n");
}

/** A declaration's JSDoc paragraphs and lists, without code blocks. */
function blocksOf(node, page, checker, targets) {
	const text = commentText(jsDoc(node)?.comment, page, checker, targets);
	return text
		.replace(/```[\s\S]*?```/g, "")
		.trim()
		.split(/\n\s*\n/)
		.filter((block) => block.trim() !== "");
}

function jsDoc(node) {
	return ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1);
}

/**
 * Whether an interface extends nothing from another package. A table of one
 * that does, such as `Query` extending Effect's `Atom.Writable`, lists that
 * package's internals as if they were this one's API.
 */
function ownShape(node, checker, seen = new Set()) {
	if (seen.has(node)) return true;
	seen.add(node);
	return (node.heritageClauses ?? []).every((clause) =>
		clause.types.every((type) => {
			const base = checker.getSymbolAtLocation(type.expression);
			return (base ? (resolve(base, checker).declarations ?? []) : []).every(
				(declaration) =>
					!declaration
						.getSourceFile()
						.fileName.includes("/node_modules/") &&
					(!ts.isInterfaceDeclaration(declaration) ||
						ownShape(declaration, checker, seen)),
			);
		}),
	);
}

function hasDocs(node) {
	return Boolean(ts.getTextOfJSDocComment(jsDoc(node)?.comment)?.trim());
}

/**
 * The documented interface of a name that's also a value,
 * such as the `QueryClient` interface beside its service tag.
 */
function typeDocs(symbol, declaration) {
	if (!(symbol.flags & ts.SymbolFlags.Value)) return undefined;
	return (symbol.declarations ?? []).find(
		(node) =>
			node !== declaration &&
			ts.isInterfaceDeclaration(node) &&
			hasDocs(node),
	);
}

/**
 * A guide link's text: the title of the page it points to, or the heading
 * its anchor names. A link to a page or heading that doesn't exist fails
 * the render.
 */
function guideTitle(url, fallback) {
	const [route, anchor] = url.replace(/^\/docs\/?/, "").split("#");
	const pages = path.join(root, "site/content/docs/(latest)");
	const file = [`${route}.mdx`, `${route}/index.mdx`, "index.mdx"]
		.slice(0, route ? 2 : 3)
		.map((candidate) => path.join(pages, candidate))
		.find((candidate) => existsSync(candidate));
	if (!file) {
		if (!existsSync(pages)) return fallback;
		throw new Error(
			`reference-docs: a guide link points to ${url}, which isn't a page`,
		);
	}
	const content = readFileSync(file, "utf8");
	if (!anchor) {
		const title = /^title: (.+)$/m.exec(content)?.[1];
		if (!title) throw new Error(`reference-docs: ${url} has no title`);
		return title.replace(/^"(.*)"$/, "$1");
	}
	for (const [, text] of content.matchAll(/^#{2,4} (.+)$/gm)) {
		const plain = text.replace(/`/g, "").trim();
		const id = plain
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s-]/gu, "")
			.replace(/\s/g, "-");
		if (id === anchor) return plain;
	}
	throw new Error(
		`reference-docs: a guide link points to ${url}, which has no such heading`,
	);
}

/** A JSDoc comment's text, its `{@link}`s as Markdown links. */
function commentText(comment, page, checker, targets) {
	let text = "";
	for (const part of typeof comment === "string"
		? [{ text: comment }]
		: (comment ?? [])) {
		if (
			ts.isJSDocLink(part) ||
			ts.isJSDocLinkCode(part) ||
			ts.isJSDocLinkPlain(part)
		) {
			text += link(part, page, checker, targets);
		} else text += part.text;
	}
	return text;
}

/**
 * A `{@link}` as Markdown, labelled as the JSDoc writes it, so the sentence
 * around it still reads ("a `Query`"). A URL stays a link.
 */
function link(part, page, checker, targets) {
	const written = part.name?.getText() ?? "";
	const url = /^https?$/.test(written) && part.text.startsWith("://");
	if (url) {
		const [address, ...words] = `${written}${part.text}`.trim().split(/\s+/);
		const label = words.join(" ").replace(/^\|\s*/, "");
		return `[${label || address}](${address})`;
	}
	const label = part.text.replace(/^\s*\|?\s*/, "").trim() || written;
	const symbol = part.name && checker.getSymbolAtLocation(part.name);
	const found = symbol && targets.get(resolve(symbol, checker));
	const target =
		found?.find((candidate) => candidate.page === page.slug) ?? found?.[0];
	if (!target) return `\`${label}\``;
	// On another page, a bare `make` could be any namespace's.
	const shown =
		target.page !== page.slug && label === target.entry.short
			? target.entry.name
			: label;
	const href =
		target.page === page.slug
			? `#${target.entry.id}`
			: `/docs/reference/${target.page}#${target.entry.id}`;
	return `[\`${shown}\`](${href})`;
}

/** One block of JSDoc text as Markdown: list items keep their own lines. */
function toMarkdown(block) {
	const lines = [];
	for (const line of block.split("\n").map((part) => part.trim())) {
		if (lines.length === 0 || LIST_ITEM.test(line)) lines.push(line);
		else lines[lines.length - 1] += ` ${line}`;
	}
	return lines.map(escapeMdx).join("\n");
}

/** Escapes what MDX would read as JSX or an expression, outside code spans. */
function escapeMdx(text) {
	return text
		.split(/(`[^`]*`)/)
		.map((part, index) =>
			index % 2 ? part : part.replace(/[{}<>]/g, (char) => `\\${char}`),
		)
		.join("");
}

function resolve(symbol, checker) {
	return symbol.flags & ts.SymbolFlags.Alias
		? checker.getAliasedSymbol(symbol)
		: symbol;
}

/**
 * The declaration that carries the docs: an overload's, not its body's, and
 * for a name that's both a value and a type, such as `TypeId`, the value's,
 * which the entry's heading names.
 */
function documented(symbol) {
	const all = symbol.declarations ?? [];
	const values = all.filter(
		(node) =>
			!ts.isTypeAliasDeclaration(node) && !ts.isInterfaceDeclaration(node),
	);
	const declarations =
		symbol.flags & ts.SymbolFlags.Value && values.length > 0 ? values : all;
	const described = declarations.find((node) =>
		ts
			.getJSDocCommentsAndTags(node)
			.some(
				(doc) =>
					ts.isJSDoc(doc) && ts.getTextOfJSDocComment(doc.comment)?.trim(),
			),
	);
	const declaration = described ?? declarations[0];
	if (!declaration)
		throw new Error(`reference-docs: ${symbol.name} has no declaration`);
	return declaration;
}

function byName(a, b) {
	const name = (item) => item.short ?? item.name;
	return (
		name(a).localeCompare(name(b), "en", { sensitivity: "base" }) ||
		name(a).localeCompare(name(b))
	);
}

function slug(title) {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

/** The page as Oxfmt writes it, so `format:check` passes on what's written. */
function format(text) {
	return execFileSync(
		path.join(root, "node_modules", ".bin", "oxfmt"),
		["--stdin-filepath=reference.mdx"],
		{ cwd: root, input: text, encoding: "utf8" },
	);
}

function createProgram() {
	return ts.createProgram(
		PAGES.map((page) => path.join(root, page.module)),
		{
			strict: true,
			noEmit: true,
			jsx: ts.JsxEmit.ReactJSX,
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			target: ts.ScriptTarget.ES2022,
			skipLibCheck: true,
		},
	);
}

const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked === realpathSync(fileURLToPath(import.meta.url))) {
	const { files } = renderReference();
	for (const [file, body] of files) writeFileSync(path.join(root, file), body);
	console.log(`✓ wrote ${files.size} reference pages to ${OUT}`);
}
