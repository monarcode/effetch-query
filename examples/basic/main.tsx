import "../ui/styles.css";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";

import { QueryClient } from "@monarcode/effetch-query";
import { createRoot } from "react-dom/client";

import { DummyJsonLive } from "./api.js";
import { App } from "./App.js";

const client = QueryClient.make({
	layer: DummyJsonLive.pipe(Layer.provide(FetchHttpClient.layer)),
});

const root = document.getElementById("root");
if (root !== null) {
	createRoot(root).render(<App client={client} />);
}
