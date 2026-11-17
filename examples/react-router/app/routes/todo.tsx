import { QueryClient } from "@monarcode/effetch-query";
import {
	HydrationBoundary,
	QueryFailure,
	useMutation,
	useResetQueryFailure,
	useSuspenseQuery,
} from "@monarcode/effetch-query/react";
import { Suspense } from "react";
import {
	data,
	isRouteErrorResponse,
	Link,
	useParams,
	useRevalidator,
	useRouteError,
} from "react-router";

import {
	Card,
	ErrorPanel,
	NotFoundPanel,
	PageHeader,
	Skeleton,
	StatusBadge,
} from "../../../ui/components.js";
import { describeError, todo, toggleTodo } from "../api.js";
import { TodoNotFound } from "../dummyjson.js";
import { getQueryClient } from "../query-context.js";
import type { Route } from "./+types/todo";

// A page that isn't a todo keeps the root's title.
export const meta: Route.MetaFunction = ({ params, error }) => [
	{
		title:
			isRouteErrorResponse(error) && error.status === 404
				? "Todos"
				: `Todo #${params.id} · Todos`,
	},
];

/** The todo's id, or not found for anything but digits. */
const idOf = (params: Route.LoaderArgs["params"]): number => {
	if (!/^\d+$/.test(params.id)) {
		throw data(null, { status: 404 });
	}
	return Number(params.id);
};

// Started, not awaited: the page renders at once, and the todo streams in.
const load = (client: QueryClient.QueryClient, id: number) => {
	void client.prefetch(todo({ params: { id } }));
};

export function loader({ context, params }: Route.LoaderArgs) {
	const client = getQueryClient(context);
	load(client, idOf(params));
	return { state: QueryClient.dehydrate(client, { pending: "promise" }) };
}

export function clientLoader({ context, params }: Route.ClientLoaderArgs) {
	load(getQueryClient(context), idOf(params));
	return { state: undefined };
}

export default function TodoRoute({ loaderData }: Route.ComponentProps) {
	return (
		<HydrationBoundary state={loaderData.state}>
			{/* Shown while the todo loads, unless a list has it cached already. */}
			<Suspense fallback={<Skeleton rows={2} />}>
				<TodoDetail />
			</Suspense>
		</HydrationBoundary>
	);
}

function TodoDetail() {
	const { id } = useParams();
	const result = useSuspenseQuery(todo({ params: { id: Number(id) } }));
	const { value } = result;
	const toggle = useMutation(toggleTodo);

	return (
		<>
			<PageHeader
				title={value.todo}
				description={<Link to="/todos">← All todos</Link>}
			/>
			<Card>
				<div className="detail">
					<div className="detail-meta">
						<StatusBadge done={value.completed} />
						<span>
							Todo #{value.id} · user #{value.userId}
						</span>
					</div>
					<div>
						<button
							type="button"
							className="button primary"
							// Waits for the todo itself, not a list's copy shown meanwhile.
							disabled={toggle.result.waiting || result.waiting}
							onClick={() =>
								void toggle.run({
									params: { id: value.id },
									body: { completed: !value.completed },
								})
							}
						>
							{value.completed ? "Mark as open" : "Mark as done"}
						</button>
					</div>
				</div>
			</Card>
		</>
	);
}

// React Router clears a render error once a revalidation settles.
export function ErrorBoundary() {
	const error = useRouteError();
	const resetFailure = useResetQueryFailure();
	const revalidator = useRevalidator();
	if (isRouteErrorResponse(error) && error.status === 404) {
		return <NotFoundPanel />;
	}
	const cause = QueryFailure.is(error) ? error.error : error;
	return (
		<ErrorPanel
			title="Couldn't load this todo"
			message={describeError(cause)}
			// Trying again can't bring back a todo that doesn't exist.
			onRetry={
				cause instanceof TodoNotFound
					? undefined
					: () => {
							resetFailure(error);
							void revalidator.revalidate();
						}
			}
		/>
	);
}
