import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	resolve: {
		// The package from source, as the rest of the repo's examples use it.
		alias: [
			{
				find: /^@monarcode\/effetch-query((?:\/[\w-]+)*)$/,
				replacement: `${import.meta.dirname}/../../src$1/index.ts`,
			},
		],
	},
	plugins: [
		tanstackStart({
			// Error components stay in their route's chunk. The tests hydrate
			// the server's pages with the routes from source, which aren't
			// split, and a split error component adds a Suspense boundary.
			router: { codeSplittingOptions: { defaultBehavior: [["component"]] } },
		}),
		viteReact(),
	],
});
