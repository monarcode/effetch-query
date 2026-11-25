// The types of `docs-examples.mjs`, which the docs site imports.

/** A ```ts or ```tsx block in the README or a page. */
export interface Example {
	/** The absolute path of the document it's in. */
	file: string;
	/** Its first line of code in the document, from 1. */
	line: number;
	extension: "ts" | "tsx";
	/** Its file name, as in "```ts todos.ts", if it has one. */
	name: string | undefined;
	code: string;
}

export const root: string;
export const sitePages: string;
export const shims: Record<string, string>;
export function markdownFiles(): string[];
export function codeBlocks(
	file: string,
	lines: string[],
	firstLine: number,
	report: (problem: string) => void,
): Example[];
export function markdownExamples(report: (problem: string) => void): Example[];
export function augments(example: Example): boolean;
export function usesNamed(example: Example): boolean;
export function companions(
	example: Example,
	named: Map<string, Example>,
): Example[];
