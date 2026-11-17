import { QueryClient } from "@monarcode/effetch-query";
import {
	HydrationBoundary,
	useSuspenseInfiniteQuery,
} from "@monarcode/effetch-query/react";

import {
	Card,
	LoadMore,
	PageHeader,
	TodoList,
} from "../../../ui/components.js";
import { everyTodo } from "../api.js";
import { getQueryClient } from "../query-context.js";
import { TodoItem } from "../todo-item.js";
import type { Route } from "./+types/all-todos";

export const meta: Route.MetaFunction = () => [{ title: "All todos · Todos" }];

export async function loader({ context }: Route.LoaderArgs) {
	const client = getQueryClient(context);
	await client.fetch(everyTodo);
	return { state: QueryClient.dehydrate(client) };
}

export async function clientLoader({ context }: Route.ClientLoaderArgs) {
	await getQueryClient(context).fetch(everyTodo);
	return { state: undefined };
}

export default function AllTodosRoute({ loaderData }: Route.ComponentProps) {
	return (
		<HydrationBoundary state={loaderData.state}>
			<AllTodos />
		</HydrationBoundary>
	);
}

function AllTodos() {
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
}
