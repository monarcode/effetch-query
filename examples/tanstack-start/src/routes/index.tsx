import { Query } from "@monarcode/effetch-query";
import { useSuspenseQuery } from "@monarcode/effetch-query/react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { todos } from "../todos.js";

export const Route = createFileRoute("/")({
	loader: ({ context }) => context.queryClient.runPromise(Query.fetch(todos)),
	component: function Todos() {
		const { value } = useSuspenseQuery(todos);
		return (
			<ul>
				{value.map((todo) => (
					<li key={todo.id}>
						<Link to="/todos/$id" params={{ id: String(todo.id) }}>
							{todo.title}
						</Link>
					</li>
				))}
			</ul>
		);
	},
});
