import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// The examples import the package by name, as an app does.
		alias: [
			{
				find: /^@monarcode\/effetch-query((?:\/[\w-]+)*)$/,
				replacement: `${import.meta.dirname}/src$1/index.ts`,
			},
		],
	},
	test: {
		include: ["test/**/*.test.{ts,tsx}"],
		// The examples link this stylesheet by its `?url`, which must be a real
		// URL for test/examples to hydrate the head as the server rendered it.
		css: { include: [/examples\/ui\/styles\.css/] },
		// test/examples/react-router hydrates a page in each test, and
		// `react-router/dom` keeps the page it hydrated in module state: inlined,
		// `vi.resetModules()` gives each test a fresh copy.
		server: { deps: { inline: ["react-router"] } },
		typecheck: {
			enabled: true,
			include: ["test/**/*.test-d.ts"],
			tsconfig: "./tsconfig.json",
		},
	},
});
