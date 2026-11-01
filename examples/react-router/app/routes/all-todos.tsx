import { Query, QueryClient } from "@monarcode/effetch-query";
import {
	HydrationBoundary,
	useSuspenseInfiniteQuery,
} from "@monarcode/effetch-query/react";
import {
	type ClientLoaderFunctionArgs,
	type LoaderFunctionArgs,
	useLoaderData,
} from "react-router";

import {
	Card,
	LoadMore,
	PageHeader,
	TodoList,
} from "../../../ui/components.js";
import { everyTodo } from "../api.js";
import { getQueryClient } from "../query-context.js";
import { TodoItem } from "../todo-item.js";

export async function loader({ context }: LoaderFunctionArgs) {
	const client = getQueryClient(context);
	await client.runPromise(Query.fetch(everyTodo));
	return { state: QueryClient.dehydrate(client) };
}

export async function clientLoader({ context }: ClientLoaderFunctionArgs) {
	await getQueryClient(context).runPromise(Query.fetch(everyTodo));
	return { state: undefined };
}

export default function AllTodosRoute() {
	const { state } = useLoaderData<typeof loader | typeof clientLoader>();
	return (
		<HydrationBoundary state={state}>
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
