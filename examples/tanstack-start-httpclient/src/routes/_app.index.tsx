import { Query } from "@monarcode/effetch-query";
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
	loader: async ({ context }) => {
		const user = await context.queryClient.runPromise(Query.fetch(viewer));
		await context.queryClient.runPromise(Query.fetch(userTodos(user.id)));
	},
	component: function MyTodos() {
		const { value: user } = useSuspenseQuery(viewer);
		const mine = userTodos(user.id);
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
