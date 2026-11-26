/**
 * The site's code colours, on the home page and in the docs: greys, with
 * the strings and names in paper. Lime is kept for what's running
 * (DESIGN.md).
 */
export const codeTheme = {
	name: "effetch-query",
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
