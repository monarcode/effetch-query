import { useRefetch, useSuspenseQuery } from "@monarcode/effetch-query/react";
import { createFileRoute } from "@tanstack/react-router";

import {
	Card,
	EmptyState,
	PageHeader,
	RefreshButton,
	TodoList,
} from "../../../ui/components.js";
import { userTodos, viewer } from "../api.js";
import { TodoItem } from "../todo-item.js";

export const Route = createFileRoute("/_app/")({
	head: () => ({ meta: [{ title: "My todos · Todos" }] }),
	// The user comes from `_app`'s `beforeLoad`. Returns nothing: the page
	// reads the todos from the cache.
	loader: async ({ context }) => {
		await context.queryClient.fetch(
			userTodos({ params: { userId: context.user.id } }),
		);
	},
	component: function MyTodos() {
		// From the query, not the route context, so it follows a refetch.
		const { value: userId } = useSuspenseQuery(viewer, {
			select: (user) => user.id,
		});
		const mine = userTodos({ params: { userId } });
		const { value } = useSuspenseQuery(mine);
		const { refetch, isRefetching } = useRefetch(mine);
		const open = value.todos.filter((todo) => !todo.completed).length;

		return (
			<>
				<PageHeader
					title="My todos"
					description={`${open} open of ${value.todos.length}`}
					actions={
						<RefreshButton
							refreshing={isRefetching}
							onClick={() => void refetch()}
						/>
					}
				/>
				<Card>
					{value.todos.length === 0 ? (
						<EmptyState>Nothing left to do.</EmptyState>
					) : (
						<TodoList>
							{value.todos.map((todo) => (
								<TodoItem key={todo.id} todo={todo} deletable />
							))}
						</TodoList>
					)}
				</Card>
			</>
		);
	},
});
