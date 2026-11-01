import { Query } from "@monarcode/effetch-query";
import { useSuspenseInfiniteQuery } from "@monarcode/effetch-query/react";
import { createFileRoute } from "@tanstack/react-router";

import {
	Card,
	LoadMore,
	PageHeader,
	TodoList,
} from "../../../ui/components.js";
import { everyTodo } from "../api.js";
import { TodoItem } from "../todo-item.js";

export const Route = createFileRoute("/_app/todos/")({
	loader: ({ context }) =>
		context.queryClient.runPromise(Query.fetch(everyTodo)),
	component: function AllTodos() {
		const { result, fetchNextPage, hasNextPage, isFetchingNextPage } =
			useSuspenseInfiniteQuery(everyTodo);
		const { pages } = result.value;
		const todos = pages.flatMap((page) => page.todos);

		return (
			<>
				<PageHeader
					title="All todos"
					description={`${todos.length} of ${pages[0]?.total ?? 0}`}
				/>
				<Card>
					<TodoList>
						{todos.map((todo) => (
							<TodoItem key={todo.id} todo={todo} />
						))}
					</TodoList>
					{hasNextPage ? (
						<LoadMore
							loading={isFetchingNextPage}
							onClick={() => void fetchNextPage()}
						/>
					) : null}
				</Card>
			</>
		);
	},
});
