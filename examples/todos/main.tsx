import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { makeQueryClient } from "./client.js";

const client = makeQueryClient(FetchHttpClient.layer);

const root = document.getElementById("root");
if (root !== null) {
	createRoot(root).render(<App client={client} />);
}
