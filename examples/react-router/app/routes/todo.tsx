import { Query, QueryClient } from "@monarcode/effetch-query";
import {
	HydrationBoundary,
	QueryFailure,
	useMutation,
	useResetQueryFailure,
	useSuspenseQuery,
} from "@monarcode/effetch-query/react";
import { Suspense } from "react";
import {
	type ClientLoaderFunctionArgs,
	data,
	isRouteErrorResponse,
	Link,
	type LoaderFunctionArgs,
	type Params,
	useLoaderData,
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
import { getQueryClient } from "../query-context.js";

// Started, not awaited: the page renders at once, and the todo streams in.
const load = (client: QueryClient.QueryClient, params: Params) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) {
		throw data(null, { status: 404 });
	}
	void client.runPromiseExit(Query.prefetch(todo({ params: { id } })));
};

export function loader({ context, params }: LoaderFunctionArgs) {
	const client = getQueryClient(context);
	load(client, params);
	return { state: QueryClient.dehydrate(client, { pending: "promise" }) };
}

export function clientLoader({ context, params }: ClientLoaderFunctionArgs) {
	load(getQueryClient(context), params);
	return { state: undefined };
}

export default function TodoRoute() {
	const { state } = useLoaderData<typeof loader | typeof clientLoader>();
	return (
		<HydrationBoundary state={state}>
			<Suspense fallback={<Skeleton rows={2} />}>
				<TodoDetail />
			</Suspense>
		</HydrationBoundary>
	);
}

function TodoDetail() {
	const { id } = useParams();
	const { value } = useSuspenseQuery(todo({ params: { id: Number(id) } }));
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
							disabled={toggle.result.waiting}
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
	return (
		<ErrorPanel
			title="Couldn't load this todo"
			message={describeError(QueryFailure.is(error) ? error.error : error)}
			onRetry={() => {
				resetFailure(error);
				void revalidator.revalidate();
			}}
		/>
	);
}
