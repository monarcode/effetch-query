import { QueryClient } from "@monarcode/effetch-query";
import {
	HydrationBoundary,
	useRefetch,
	useSuspenseQuery,
} from "@monarcode/effetch-query/react";

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
import { userContext } from "../user-context.js";
import type { Route } from "./+types/my-todos";

export const meta: Route.MetaFunction = () => [{ title: "My todos · Todos" }];

// The user comes from the signed-in layout's middleware.
const load = (context: Route.LoaderArgs["context"]) =>
	getQueryClient(context).fetch(
		userTodos({ params: { userId: context.get(userContext).id } }),
	);

export async function loader({ context }: Route.LoaderArgs) {
	await load(context);
	return { state: QueryClient.dehydrate(getQueryClient(context)) };
}

export async function clientLoader({ context }: Route.ClientLoaderArgs) {
	await load(context);
	return { state: undefined };
}

export default function MyTodosRoute({ loaderData }: Route.ComponentProps) {
	return (
		<HydrationBoundary state={loaderData.state}>
			<MyTodos />
		</HydrationBoundary>
	);
}

function MyTodos() {
	// From the query, not the router's context, so it follows a refetch.
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
}
