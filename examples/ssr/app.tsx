import * as Schema from "effect/Schema";

import { Query } from "@monarcode/effetch-query";
import { useSuspenseQuery } from "@monarcode/effetch-query/react";

import { Catalog, Product, Viewer } from "./services.js";

// A `schema` is what lets a query cross from server to browser.
export const products = Query.make({
	key: ["products"],
	run: Catalog.use((catalog) => catalog.list),
	schema: { success: Schema.Array(Product) },
	// Fresh for a minute, so the browser doesn't refetch what the server just
	// loaded.
	staleTime: "1 minute",
});

export const greeting = Query.make({
	key: ["viewer", "greeting"],
	run: Viewer.useSync(({ name }) => `Welcome back, ${name}`),
	schema: { success: Schema.String },
	staleTime: "1 minute",
});

const price = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function App() {
	const { value: welcome } = useSuspenseQuery(greeting);
	const { value: list } = useSuspenseQuery(products);
	return (
		<main>
			<h1>{welcome}</h1>
			<ul>
				{list.map((product) => (
					<li
						key={product.id}
					>{`${product.name}: ${price(product.price)}`}</li>
				))}
			</ul>
		</main>
	);
}
