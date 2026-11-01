import { reactRouter } from "@react-router/dev/vite";
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
	plugins: [reactRouter()],
});
