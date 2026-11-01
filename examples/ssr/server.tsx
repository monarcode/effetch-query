import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { Query, QueryClient } from "@monarcode/effetch-query";
import { renderToString } from "react-dom/server";

import { greeting, products } from "./app.js";
import { Page, type PageData } from "./page.js";
import { type Catalog, viewerLayer } from "./services.js";

/**
 * The page renderer for one server process. Each request gets its own
 * client, so one viewer's data never reaches another's page. The process's
 * runtime builds the catalog (a database pool, say) once, and every
 * request's client shares it through the runtime's memo map.
 */
export const makeRenderer = (catalog: Layer.Layer<Catalog>) => {
	const appRuntime = ManagedRuntime.make(catalog);
	const render = async (viewer: string): Promise<string> => {
		// Built by the runtime before any client, so it outlives each request.
		await appRuntime.context();
		const client = QueryClient.make({
			layer: Layer.merge(catalog, viewerLayer(viewer)),
			memoMap: appRuntime.memoMap,
		});
		try {
			await client.runPromise(
				Effect.all([Query.prefetch(products), Query.prefetch(greeting)], {
					concurrency: "unbounded",
				}),
			);
			const data: PageData = {
				viewer,
				state: QueryClient.dehydrate(client),
			};
			const html = renderToString(<Page client={client} data={data} />);
			return document(html, data);
		} finally {
			await client.dispose();
		}
	};
	return { render, dispose: appRuntime.dispose };
};

// `<` is escaped so a value can't close the script tag.
const document = (html: string, data: PageData) => `<!doctype html>
<html>
	<body>
		<div id="root">${html}</div>
		<script id="page-data" type="application/json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
		<script type="module" src="/main.js"></script>
	</body>
</html>`;
