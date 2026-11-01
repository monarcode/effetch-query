import { Query } from "@monarcode/effetch-query";
import { useSuspenseQuery } from "@monarcode/effetch-query/react";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import { todo } from "../todos.js";

export const Route = createFileRoute("/todos/$id")({
	// Started, not awaited: the page renders at once, and the todo streams in.
	loader: ({ context, params }) => {
		void context.queryClient.runPromiseExit(
			Query.prefetch(todo(Number(params.id))),
		);
	},
	errorComponent: () => <h1>No such todo</h1>,
	component: function TodoPage() {
		return (
			<Suspense fallback={<p>Loading…</p>}>
				<TodoDetail />
			</Suspense>
		);
	},
});

function TodoDetail() {
	const { id } = Route.useParams();
	const { value } = useSuspenseQuery(todo(Number(id)));
	return (
		<h1>
			{value.title}
			{value.done ? " (done)" : ""}
		</h1>
	);
}
