import { Query } from "@monarcode/effetch-query";
import { useSuspenseQuery } from "@monarcode/effetch-query/react";
import { createFileRoute } from "@tanstack/react-router";

import { viewer } from "../todos.js";

export const Route = createFileRoute("/account")({
	// Signed out, the query dies with a redirect, and the router follows it,
	// on the server as in the browser.
	loader: ({ context }) => context.queryClient.runPromise(Query.fetch(viewer)),
	component: function Account() {
		return <h1>Signed in as {useSuspenseQuery(viewer).value}</h1>;
	},
});
