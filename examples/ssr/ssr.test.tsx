// @vitest-environment happy-dom
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { QueryClient } from "@monarcode/effetch-query";
import { act, cleanup, screen } from "@testing-library/react";
import type { Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { hydratePage, readPageData } from "./browser.js";
import { makeRenderer } from "./server.js";
import { Catalog, type Product } from "./services.js";

const pages: Array<{
	readonly client: QueryClient.QueryClient;
	readonly root: Root;
}> = [];

const renderers: Array<ReturnType<typeof makeRenderer>> = [];

afterEach(async () => {
	for (const page of pages.splice(0)) {
		act(() => page.root.unmount());
		await page.client.dispose();
	}
	await Promise.all(renderers.splice(0).map((renderer) => renderer.dispose()));
	cleanup();
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

/** A catalog that counts its reads. */
const countedCatalog = (products: ReadonlyArray<Product>) => {
	const reads = { count: 0 };
	const layer = Layer.succeed(Catalog, {
		list: Effect.sync(() => {
			reads.count += 1;
			return products;
		}),
	});
	return { reads, layer };
};

const products: ReadonlyArray<Product> = [
	{ id: 1, name: "Kettle", price: 2500 },
	{ id: 2, name: "Teapot", price: 1850 },
];

const parse = (html: string) =>
	new DOMParser().parseFromString(html, "text/html");

/**
 * Loads the server's document into the page, as a browser would, but for
 * the script that loads the browser entry: the test is that entry.
 */
const load = (html: string) => {
	document.body.replaceChildren(
		...parse(html).body.querySelectorAll("#root, #page-data"),
	);
};

const serve = (catalog: Layer.Layer<Catalog>) => {
	const renderer = makeRenderer(catalog);
	renderers.push(renderer);
	return renderer.render;
};

const hydrate = async (catalog: Layer.Layer<Catalog>) => {
	const container = document.getElementById("root");
	expect(container).not.toBeNull();
	const page = hydratePage(
		container as Element,
		readPageData(document),
		catalog,
	);
	pages.push(page);
	await act(async () => {});
	return page;
};

it("renders the page on the server with its data", async () => {
	const render = serve(countedCatalog(products).layer);

	const html = await render("Ada");

	expect(html).toContain("Welcome back, Ada");
	expect(html).toContain("Kettle: $25.00");
	expect(html).toContain("Teapot: $18.50");
});

it("hydrates the server's HTML without a mismatch or a fetch", async () => {
	const server = countedCatalog(products);
	const browser = countedCatalog([]);
	const errors = vi.spyOn(console, "error");
	load(await serve(server.layer)("Ada"));
	const before = document.getElementById("root")?.innerHTML;

	await hydrate(browser.layer);

	expect(screen.getByRole("heading").textContent).toBe("Welcome back, Ada");
	expect(
		screen.getAllByRole("listitem").map((item) => item.textContent),
	).toEqual(["Kettle: $25.00", "Teapot: $18.50"]);
	expect(document.getElementById("root")?.innerHTML).toBe(before);
	expect(errors).not.toHaveBeenCalled();
	expect(server.reads.count).toBe(1);
	expect(browser.reads.count).toBe(0);
});

it("gives each request its own cache", async () => {
	const catalog = countedCatalog(products);
	const render = serve(catalog.layer);

	const [ada, grace] = await Promise.all([render("Ada"), render("Grace")]);

	expect(ada).toContain("Welcome back, Ada");
	expect(ada).not.toContain("Grace");
	expect(grace).toContain("Welcome back, Grace");
	expect(grace).not.toContain("Ada");
	expect(catalog.reads.count).toBe(2);
});

it("builds the catalog once for every request", async () => {
	const builds = { count: 0 };
	const render = serve(
		Layer.effect(Catalog)(
			Effect.sync(() => {
				builds.count += 1;
				return { list: Effect.succeed(products) };
			}),
		),
	);

	await render("Ada");
	await render("Grace");

	expect(builds.count).toBe(1);
});

it("escapes the embedded data so it can't close its script tag", async () => {
	const name = "</script><script>alert(1)</script>";
	const html = await serve(
		countedCatalog([{ id: 1, name, price: 100 }]).layer,
	)("Ada");
	const page = parse(html);

	expect(html).not.toContain(`"${name}"`);
	expect(page.querySelectorAll("script")).toHaveLength(2);
	expect(JSON.stringify(readPageData(page).state)).toContain(
		JSON.stringify(name),
	);
});
