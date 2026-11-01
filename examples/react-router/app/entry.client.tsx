import * as Effect from "effect/Effect";

import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

import { BrowserApp } from "./browser.js";
import { makeQueryClient } from "./query-client.js";
import { readBrowserToken } from "./session.js";

// One client for the page's lifetime. It reads the cookie for every request,
// so signing in or out takes effect at once.
const queryClient = makeQueryClient(Effect.sync(readBrowserToken));

startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<BrowserApp client={queryClient} />
		</StrictMode>,
	);
});
