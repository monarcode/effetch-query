import { Query, QueryClient } from "@monarcode/effetch-query";
import {
	HydrationBoundary,
	useRefetch,
	useSuspenseQuery,
} from "@monarcode/effetch-query/react";
import {
	type ClientLoaderFunctionArgs,
	type LoaderFunctionArgs,
	useLoaderData,
} from "react-router";

import {
	Card,
	EmptyState,
	PageHeader,
	RefreshButton,
	TodoList,
} from "../../../ui/components.js";
import { userTodos, viewer } from "../api.js";
import { getQueryClient } from "../query-context.js";
import { TodoItem } from "../todo-item.js";

const load = async (client: QueryClient.QueryClient) => {
	const user = await client.runPromise(Query.fetch(viewer));
	await client.runPromise(
		Query.fetch(userTodos({ params: { userId: user.id } })),
	);
};

export async function loader({ context }: LoaderFunctionArgs) {
	const client = getQueryClient(context);
	await load(client);
	return { state: QueryClient.dehydrate(client) };
}

export async function clientLoader({ context }: ClientLoaderFunctionArgs) {
	await load(getQueryClient(context));
	return { state: undefined };
}

export default function MyTodosRoute() {
	const { state } = useLoaderData<typeof loader | typeof clientLoader>();
	return (
		<HydrationBoundary state={state}>
			<MyTodos />
		</HydrationBoundary>
	);
}

function MyTodos() {
	const { value: user } = useSuspenseQuery(viewer);
	const mine = userTodos({ params: { userId: user.id } });
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
}
