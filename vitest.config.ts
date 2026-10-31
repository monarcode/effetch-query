import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// The examples import the package by name, as an app does.
		alias: [
			{
				find: /^@monarcode\/effetch-query(\/[\w-]+)?$/,
				replacement: `${import.meta.dirname}/src$1/index.ts`,
			},
		],
	},
	test: {
		include: ["test/**/*.test.{ts,tsx}", "examples/**/*.test.{ts,tsx}"],
		typecheck: {
			enabled: true,
			include: ["test/**/*.test-d.ts"],
			tsconfig: "./tsconfig.json",
		},
	},
});
