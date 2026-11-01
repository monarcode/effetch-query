import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export const Product = Schema.Struct({
	id: Schema.Finite,
	name: Schema.String,
	price: Schema.Finite,
});
export type Product = typeof Product.Type;

/** The product catalog: a database on the server, an HTTP API in the browser. */
export class Catalog extends Context.Service<
	Catalog,
	{ readonly list: Effect.Effect<ReadonlyArray<Product>> }
>()("examples/ssr/Catalog") {}

/** Who's signed in: the request's session on the server, the page's in the browser. */
export class Viewer extends Context.Service<
	Viewer,
	{ readonly name: string }
>()("examples/ssr/Viewer") {}

declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: Catalog | Viewer;
	}
}

export const viewerLayer = (name: string): Layer.Layer<Viewer> =>
	Layer.succeed(Viewer, { name });

/** A catalog over a fixed list, standing in for the database or the API. */
export const catalogLayer = (
	products: ReadonlyArray<Product>,
): Layer.Layer<Catalog> =>
	Layer.succeed(Catalog, { list: Effect.succeed(products) });
