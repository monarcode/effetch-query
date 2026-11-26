import { readFileSync } from "node:fs";
import path from "node:path";

import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";

import { Fetch } from "@monarcode/effetch";
import { fromClient } from "@monarcode/effetch-query/effetch";
import { highlightHast } from "fumadocs-core/highlight";
import type { Element, ElementContent, Root } from "hast";

import {
	markdownExamples,
	sitePages,
	type Example,
} from "../../../scripts/docs-examples.mjs";
import {
	namedExamples,
	twoslashSource,
	twoslashTransformers,
} from "./mdx-options.ts";

/*
 * What the landing page shows, read from the docs when the site builds, so
 * it can't drift from them. Its code is the docs' own examples, compiled by
 * Twoslash as the docs compile them: a type error fails the build, and
 * `check-docs` checks the same blocks. What the stage's simulation says
 * comes from those examples too, each checked here, and its key from the
 * library. `vite.config.ts` serves the result as `virtual:landing`.
 */

/** The examples the page shows, each beside the part of the story it's for. */
export type LandingCode = "stage" | "errors" | "services" | "entities" | "live";

export interface LandingPanel {
	/** The file's name, if the docs name it. */
	readonly name: string | undefined;
	/** The docs page it's from. */
	readonly page: { readonly title: string; readonly href: string };
	readonly hast: Root;
}

/** What the stage's simulation says about its code. */
export interface StageFacts {
	/** The query's key, as the library computes it: `["todos"]`. */
	readonly key: string;
	/** The request the query sends. */
	readonly request: string;
	/**
	 * The values the stage's `staleTime` can be set to, the docs' own
	 * first, each as written and in seconds.
	 */
	readonly staleTimes: readonly {
		readonly text: string;
		readonly seconds: number;
	}[];
	/** What the component renders before its first value. */
	readonly loading: string;
	/** The call that invalidates the query. */
	readonly invalidate: string;
	/** The request the component's mutation sends. */
	readonly mutation: string;
	/** The docs' other components that read the same query. */
	readonly readers: {
		readonly open: ReaderFacts;
		readonly count: ReaderFacts;
	};
}

/** A component from the docs that reads the stage's query. */
export interface ReaderFacts {
	readonly name: string;
	/** What it renders after its number: `open`, `todos`. */
	readonly label: string;
	readonly page: { readonly title: string; readonly href: string };
}

/** What the typed-errors example renders for each response. */
export interface ErrorFacts {
	readonly cases: readonly {
		readonly status: number;
		/** The error's tag; undefined for a status the endpoint doesn't name. */
		readonly tag: string | undefined;
		/** What the component renders, as the code writes it. */
		readonly renders: string;
		/** The line of the example that handles it. */
		readonly line: string;
	}[];
}

/** A query the entities section shows: how it's called, and its key. */
export interface CachedQuery {
	readonly call: string;
	readonly key: string;
}

/** What the entities section says about the docs' optimistic toggle. */
export interface EntityFacts {
	/** The entity's name, `Todos`. */
	readonly entity: string;
	readonly mutation: string;
	readonly queries: {
		readonly list: CachedQuery;
		readonly open: CachedQuery;
		readonly detail: CachedQuery;
	};
}

/** What the live section says about the docs' socket-fed query. */
export interface LiveFacts {
	readonly url: string;
	/** How long `Stream.retry` waits before subscribing again. */
	readonly retry: { readonly text: string; readonly seconds: number };
	/** The query's name, as the docs export it. */
	readonly query: string;
	/** The change tags: an upsert and a removal. */
	readonly saved: string;
	readonly deleted: string;
}

/** A step of Getting started: its heading, the file it writes, its link. */
export interface GuideStep {
	readonly n: number;
	readonly title: string;
	readonly file: string;
	readonly href: string;
}

export interface LandingData {
	readonly steps: readonly GuideStep[];
	readonly facts: StageFacts;
	readonly errors: ErrorFacts;
	readonly entities: EntityFacts;
	readonly live: LiveFacts;
	readonly code: Record<LandingCode, LandingPanel>;
}

/**
 * The page's code colours: greys, with the strings and names in paper.
 * Lime is kept for what's running.
 */
const theme = {
	name: "effetch-query-landing",
	type: "dark" as const,
	colors: { "editor.background": "#0c0d11", "editor.foreground": "#c9cbd3" },
	tokenColors: [
		{
			scope: ["comment", "punctuation.definition.comment"],
			settings: { foreground: "#6b6f7b" },
		},
		{
			scope: [
				"keyword",
				"storage",
				"storage.type",
				"storage.modifier",
				"keyword.control",
				"keyword.operator.new",
				"keyword.operator.expression",
				"variable.language",
			],
			settings: { foreground: "#8e929e" },
		},
		{
			scope: ["string", "string.template", "punctuation.definition.string"],
			settings: { foreground: "#edeee8" },
		},
		{
			scope: [
				"entity.name.function",
				"support.function",
				"meta.function-call",
			],
			settings: { foreground: "#ffffff" },
		},
		{
			scope: ["entity.name.type", "support.type", "entity.name.class"],
			settings: { foreground: "#edeee8" },
		},
		{
			scope: ["punctuation", "meta.brace", "keyword.operator"],
			settings: { foreground: "#6b6f7b" },
		},
	],
};

/** The stage's other `staleTime`s, after the docs' own. */
const STALE_TIMES = ["10 seconds", "0 seconds"];

function find(
	examples: readonly Example[],
	what: string,
	test: (example: Example) => boolean,
) {
	const found = examples.find(test);
	if (!found) throw new Error(`The landing page needs ${what} in the docs`);
	return found;
}

function match(example: Example, pattern: RegExp, what: string) {
	const found = pattern.exec(example.code);
	if (!found)
		throw new Error(
			`The landing page needs ${what} in ${example.name ?? example.file}`,
		);
	return found[1]!;
}

function expect(example: Example, text: string) {
	if (!example.code.includes(text))
		throw new Error(
			`The landing page needs ${text} in ${example.name ?? example.file}`,
		);
}

/** The docs page an example is on: its title, and its path on the site. */
function pageOf(example: Example) {
	const content = readFileSync(example.file, "utf8");
	const title = /^title: (.+)$/m.exec(content)?.[1];
	if (!title) throw new Error(`${example.file} has no title`);
	const slug = path
		.relative(sitePages, example.file)
		.replace(/\.mdx$/, "")
		.replace(/(^|\/)index$/, "");
	return { title, href: `/docs/${slug}`.replace(/\/$/, "") };
}

/**
 * The example with the given parts hidden. Twoslash still compiles hidden
 * lines, so the shown ones keep their types.
 */
function show(
	example: Example,
	parts: readonly (readonly [string, string?])[],
) {
	const { code } = example;
	const at = (text: string) => {
		const index = code.indexOf(text);
		if (index < 0)
			throw new Error(
				`The landing page needs ${text} in ${example.name ?? example.file}`,
			);
		return index;
	};
	const hide = (text: string) =>
		text
			? `// ---cut-start---\n${text.replace(/\n?$/, "\n")}// ---cut-end---\n`
			: "";
	let out = "";
	let from = 0;
	for (const [start, end] of parts) {
		const shownFrom = at(start);
		const shownTo = end
			? code.indexOf("\n", at(end) + end.length - 1) + 1
			: code.length;
		out += hide(code.slice(from, shownFrom)) + code.slice(shownFrom, shownTo);
		from = shownTo;
	}
	return { ...example, code: out + hide(code.slice(from)) };
}

function facts(
	stage: Example,
	readers: StageFacts["readers"],
	family: Example,
): StageFacts {
	const route = match(
		stage,
		/Fetch\.endpoint\("([A-Z]+ [^"]+)"/,
		"the stage's endpoint",
	);
	const staleTime = match(
		stage,
		/\{ staleTime: "([^"]+)" \},/,
		"the stage's staleTime",
	);
	expect(stage, "const result = useQuery(todos());");
	expect(stage, "const toggle = useMutation(toggleTodo);");
	expect(stage, "{ invalidates: [todos] },");
	expect(stage, "void toggle.run({");
	const mutation = match(
		stage,
		/const toggleTodo = api\.mutation\(\s*Fetch\.endpoint\("([A-Z]+ [^"]+)"/,
		"the stage's mutation",
	);
	expect(stage, '{todo.done ? "✓" : "○"} {todo.title}');
	const loading = match(
		stage,
		/onInitial: \(\) => <p>([^<]+)<\/p>/,
		"the component's onInitial",
	);
	// The status bar invalidates the whole family, as the docs say it can.
	const invalidate = readFileSync(
		path.join(sitePages, "queries/index.mdx"),
		"utf8",
	);
	if (!invalidate.includes("`Query.invalidate(todo)` reaches every"))
		throw new Error("The landing page needs Query.invalidate on a family");

	class Client extends Fetch.Service<Client>()("Client", {
		baseUrl: "https://api.example.com",
	}) {}
	// The key doesn't depend on the client, which this file doesn't
	// register, so its services aren't checked here.
	const query = fromClient(Client as never).query(
		Fetch.endpoint(route as "GET /todos", {
			output: Schema.Array(Schema.Unknown),
		}),
	);
	const key = JSON.stringify(query().key);
	// The other components read `todos.ts`'s query, which must be the
	// stage's: the same cache entry.
	const familyRoute = match(
		family,
		/listTodos = Fetch\.endpoint\("([A-Z]+ [^"]+)"/,
		"todos.ts's endpoint",
	);
	expect(family, "export const todos = api.query(listTodos);");
	const familyKey = JSON.stringify(
		fromClient(Client as never).query(
			Fetch.endpoint(familyRoute as "GET /todos", {
				output: Schema.Array(Schema.Unknown),
			}),
		)().key,
	);
	if (familyKey !== key)
		throw new Error(
			`The stage's query is ${key}, but todos.ts's is ${familyKey}`,
		);
	return {
		key,
		request: route,
		staleTimes: [staleTime, ...STALE_TIMES].map((text) => ({
			text,
			seconds: Duration.toSeconds(text as Duration.Input),
		})),
		loading,
		invalidate: "Query.invalidate(todos)",
		mutation,
		readers,
	};
}

/** A component that reads `todos()` and renders a number and a word. */
function reader(example: Example, pattern: RegExp, read: string): ReaderFacts {
	expect(example, read);
	const found = pattern.exec(example.code);
	if (!found)
		throw new Error(
			`The landing page needs ${pattern} in ${example.name ?? example.file}`,
		);
	return { name: found[1]!, label: found[2]!, page: pageOf(example) };
}

/** The key the library gives a call of an endpoint's query. */
function keyOf(route: string, call?: unknown) {
	class Client extends Fetch.Service<Client>()("Client", {
		baseUrl: "https://api.example.com",
	}) {}
	const query = fromClient(Client as never).query(
		Fetch.endpoint(route as "GET /todos", { output: Schema.Unknown }),
	) as unknown as (call?: unknown) => { readonly key: unknown };
	return JSON.stringify(query(call).key);
}

function entityFacts(example: Example, family: Example): EntityFacts {
	const entity = match(
		example,
		/Entity\.update\((\w+), Number\(params\.id\)/,
		"the optimistic Entity.update",
	);
	expect(example, "done: body.done,");
	expect(example, `onSuccess: (saved) => Entity.set(${entity}, saved),`);
	expect(example, "invalidates: [todos],");
	const mutation = match(
		example,
		/Fetch\.endpoint\("([A-Z]+ [^"]+)"/,
		"the optimistic mutation's endpoint",
	);
	const list = match(
		family,
		/listTodos = Fetch\.endpoint\("([A-Z]+ [^"]+)"/,
		"todos.ts's list endpoint",
	);
	const detail = match(
		family,
		/getTodo = Fetch\.endpoint\("([A-Z]+ [^"]+)"/,
		"todos.ts's detail endpoint",
	);
	expect(family, "export const todo = api.query(getTodo");
	// The keys below are the library's for these routes, as long as the
	// client adds no key prefix of its own.
	expect(family, "export const api = fromClient(ApiClient);");
	const open = { query: { done: false } };
	const one = { params: { id: 2 } };
	return {
		entity,
		mutation,
		queries: {
			list: { call: "todos()", key: keyOf(list) },
			open: {
				call: "todos({ query: { done: false } })",
				key: keyOf(list, open),
			},
			detail: {
				call: "todo({ params: { id: 2 } })",
				key: keyOf(detail, one),
			},
		},
	};
}

const retrySeconds = (text: string) =>
	Duration.toSeconds(text as Duration.Input);

function liveFacts(example: Example): LiveFacts {
	const retry = match(example, /Schedule\.spaced\("([^"]+)"\)/, "the retry");
	const query = match(
		example,
		/export const (\w+) = api\.query\(listTodos, \{ live: \(\) => changes \}\);/,
		"the live query's export",
	);
	if (!(retrySeconds(retry) >= 1))
		throw new Error(`The live section can't count down a retry of ${retry}`);
	return {
		query,
		url: match(example, /socketMessages\("([^"]+)"\)/, "the socket's URL"),
		retry: {
			text: retry,
			seconds: retrySeconds(retry),
		},
		saved: match(
			example,
			/TaggedStruct\("(\w+)", \{ todo: Todo \}/,
			"the upsert's tag",
		),
		deleted: match(
			example,
			/TaggedStruct\("(\w+)", \{ id: Schema\.Finite \}/,
			"the removal's tag",
		),
	};
}

/** Getting started's numbered steps, each with the first file it names. */
function guideSteps(): GuideStep[] {
	const file = path.join(sitePages, "getting-started.mdx");
	const content = readFileSync(file, "utf8");
	const steps = [...content.matchAll(/^## (\d+)\. (.+)$/gm)].map(
		(heading, i, all) => {
			const section = content.slice(heading.index, all[i + 1]?.index);
			const named = /^```tsx? ([\w.-]+\.tsx?)$/m.exec(section)?.[1];
			if (!named)
				throw new Error(
					`Getting started's step "${heading[2]}" names no file`,
				);
			// The docs' heading ids, for headings of letters, digits and spaces.
			if (!/^[A-Za-z0-9 ]+$/.test(heading[2]!))
				throw new Error(
					`The landing page can't link to Getting started's "${heading[2]}"`,
				);
			const slug = `${heading[1]}. ${heading[2]}`
				.toLowerCase()
				.replace(/[^a-z0-9 -]/g, "")
				.replace(/ /g, "-");
			return {
				n: Number(heading[1]),
				title: heading[2]!,
				file: named,
				href: `/docs/getting-started#${slug}`,
			};
		},
	);
	if (steps.length < 3)
		throw new Error(
			"The landing page needs Getting started's numbered steps",
		);
	return steps;
}

function errorFacts(example: Example): ErrorFacts {
	const statuses = /statusErrors: \{ 404: (\w+), 403: \[(\w+)\] \}/.exec(
		example.code,
	);
	if (!statuses)
		throw new Error("The landing page needs the statusErrors map");
	const handler = (tag: string) =>
		match(
			example,
			new RegExp(
				`\\.onErrorTag\\("${tag}", \\([^)]*\\) => <p>([^<]+)</p>\\)`,
			),
			`the onErrorTag for ${tag}`,
		);
	const other = match(
		example,
		/\.onError\(\(\) => <p>([^<]+)<\/p>\)/,
		"the onError fallback",
	);
	expect(example, 'Effect.catchTag("TodoNotFound"');
	return {
		cases: [
			{
				status: 404,
				tag: statuses[1],
				renders: handler(statuses[1]!),
				line: "e-404",
			},
			{
				status: 403,
				tag: statuses[2],
				renders: handler(statuses[2]!),
				line: "e-403",
			},
			{ status: 500, tag: undefined, renders: other, line: "e-other" },
		],
	};
}

const classes = (node: Element) =>
	[node.properties.class ?? node.properties.className ?? []].flat().join(" ");

/** A node's text as the page shows it, without its type hovers. */
const textOf = (node: ElementContent): string =>
	node.type === "text"
		? node.value
		: node.type === "element" && node.tagName !== "PopupContent"
			? node.children.map(textOf).join("")
			: "";

/** The code's elements, without its type hovers'. */
function* elements(node: Root | Element): Generator<Element> {
	for (const child of node.children)
		if (child.type === "element" && child.tagName !== "PopupContent") {
			yield child;
			yield* elements(child);
		}
}

/**
 * Names the lines of a panel the page lights, by text each line has, and
 * numbers every line for the page's entrance. Fails the build if the code
 * no longer has one.
 */
function tagLines(hast: Root, names: Record<string, string>) {
	const lines = [...elements(hast)].filter((node) =>
		classes(node).split(" ").includes("line"),
	);
	lines.forEach((node, i) => {
		node.properties.style = `--n: ${i}`;
	});
	for (const [name, text] of Object.entries(names)) {
		const found = lines.find((node) => textOf(node).includes(text));
		if (!found) throw new Error(`The landing page's code lost ${text}`);
		found.properties["data-line"] = name;
	}
	return hast;
}

/**
 * Tags the stage's code, and makes its `staleTime` value a control.
 */
function tagStage(hast: Root, staleTime: string) {
	tagLines(hast, {
		stale: "staleTime:",
		read: "const result",
		toggle: "const toggle",
	});
	const all = [...elements(hast)];
	const literal = `"${staleTime}"`;
	const value = all.find(
		(node) =>
			textOf(node).trim() === literal &&
			!node.children.some((child) => child.type === "element"),
	);
	if (!value) throw new Error(`The stage's code lost ${literal}`);
	// The token can carry the space before it; only the string is the control.
	const before = textOf(value).slice(0, textOf(value).indexOf(literal));
	value.children = [
		...(before ? [{ type: "text" as const, value: before }] : []),
		{
			type: "element",
			tagName: "stage-edit",
			properties: {},
			children: [{ type: "text", value: literal }],
		},
	];
	return hast;
}

/** The landing page's data; `build` is true for `vite build`. */
export async function landingData(build: boolean): Promise<LandingData> {
	const examples = markdownExamples(() => {});
	const named = namedExamples();
	const stage = find(
		examples,
		"the docs home page's example",
		(example) =>
			example.file.startsWith(sitePages) &&
			/\{ staleTime: "[^"]+" \},\n\);[\s\S]*function Todos\(\)/.test(
				example.code,
			),
	);
	const byName = (name: string) => {
		const example = named.get(name);
		if (!example) throw new Error(`The docs lost ${name}`);
		return example;
	};
	const stageFacts = facts(
		stage,
		{
			open: reader(
				find(examples, "the select example", (example) =>
					example.code.includes("select: (list) =>"),
				),
				/export function (\w+)\(\)[\s\S]*\} (\w+)<\/p>;/,
				"useQuery(todos(), {",
			),
			count: reader(
				find(examples, "the paused example", (example) =>
					example.code.includes("paused: !isFocused"),
				),
				/export function (\w+)\(\)[\s\S]*\.length\} (\w+)<\/>;/,
				"useQuery(todos(), { paused: !isFocused });",
			),
		},
		byName("todos.ts"),
	);
	const errorsExample = find(examples, "the statusErrors example", (example) =>
		example.code.includes("statusErrors: { 404: TodoNotFound"),
	);
	const optimistic = find(
		examples,
		"the optimistic entity example",
		(example) => example.code.includes("optimistic: ({ params, body }) =>"),
	);
	const panels: Record<LandingCode, Example> = {
		stage: show(stage, [
			["// A cached query", '" },\n);'],
			["function Todos()", "useMutation(toggleTodo)"],
		]),
		errors: show(errorsExample, [["const findTodo"]]),
		services: show(byName("api.ts"), [["// Sends requests"]]),
		entities: show(optimistic, [["export const toggleTodo"]]),
		live: show(byName("live-todos.ts"), [["// A change as an update"]]),
	};
	const code = Object.fromEntries(
		await Promise.all(
			Object.entries(panels).map(async ([key, example]) => {
				const hast = await highlightHast(twoslashSource(example, named), {
					lang: example.extension,
					theme,
					transformers: twoslashTransformers(build),
					meta: { __raw: "twoslash" },
				});
				const panel: LandingPanel = {
					name: example.name,
					page: pageOf(example),
					hast:
						key === "stage"
							? tagStage(hast, stageFacts.staleTimes[0]!.text)
							: tagLines(hast, LINES[key as LandingCode] ?? {}),
				};
				return [key, panel] as const;
			}),
		),
	) as Record<LandingCode, LandingPanel>;
	return {
		steps: guideSteps(),
		facts: stageFacts,
		errors: errorFacts(errorsExample),
		entities: entityFacts(optimistic, byName("todos.ts")),
		live: liveFacts(byName("live-todos.ts")),
		code,
	};
}

/** The lines each panel lights, by name: the text each line has. */
const LINES: Partial<Record<LandingCode, Record<string, string>>> = {
	errors: {
		"a-output": "output: Todo,",
		"e-status": "statusErrors:",
		"e-catch": 'catchTag("TodoNotFound"',
		read: "AsyncResult.builder(useQuery",
		"e-404": '.onErrorTag("TodoNotFound"',
		"e-403": '.onErrorTag("NotYourTodo"',
		"e-other": ".onError(",
		"a-success": ".onSuccess(",
	},
	entities: {
		optimistic: "Entity.update(",
		body: "done: body.done",
		set: "onSuccess: (saved) =>",
		invalidates: "invalidates: [todos]",
	},
	live: {
		upsert: 'return change._tag === "Saved"',
		socket: "socketMessages(",
		decode: "Stream.mapEffect(",
		apply: "Stream.map(apply)",
		retry: "Stream.retry(",
		live: "live: () => changes",
	},
	services: {
		"r-layer": "ApiClient.layer.pipe(",
		"r-http": "Layer.provide(FetchHttpClient.layer)",
		"r-services": "readonly services: ApiClient;",
	},
};
