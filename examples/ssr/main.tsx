import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { hydratePage, readPageData } from "./browser.js";
import { Catalog, Product } from "./services.js";

/** In the browser, the catalog is the server's JSON API. */
const catalog = Layer.succeed(Catalog, {
	list: Effect.promise(() =>
		fetch("/api/products").then((response) => response.json()),
	).pipe(
		Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Product))),
		Effect.orDie,
	),
});

const container = document.getElementById("root");
if (container !== null) {
	hydratePage(container, readPageData(document), catalog);
}
