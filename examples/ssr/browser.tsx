import * as Layer from "effect/Layer";

import { QueryClient } from "@monarcode/effetch-query";
import { hydrateRoot, type Root } from "react-dom/client";

import { Page, type PageData } from "./page.js";
import { type Catalog, viewerLayer } from "./services.js";

/** Reads what the server embedded in the page. */
export const readPageData = (page: Document): PageData =>
	JSON.parse(page.getElementById("page-data")?.textContent ?? "") as PageData;

/**
 * Picks up the page the server rendered with the app's one client, loaded
 * with the server's cache: the first render matches the server's HTML, and
 * nothing is fetched while the server's values are fresh.
 */
export const hydratePage = (
	container: Element,
	data: PageData,
	catalog: Layer.Layer<Catalog>,
): { readonly client: QueryClient.QueryClient; readonly root: Root } => {
	const client = QueryClient.make({
		layer: Layer.merge(catalog, viewerLayer(data.viewer)),
	});
	const root = hydrateRoot(container, <Page client={client} data={data} />);
	return { client, root };
};
