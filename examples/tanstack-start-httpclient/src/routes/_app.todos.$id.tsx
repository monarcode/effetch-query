import { Query } from "@monarcode/effetch-query";
import {
	QueryFailure,
	useMutation,
	useResetQueryFailure,
	useSuspenseQuery,
} from "@monarcode/effetch-query/react";
import {
	createFileRoute,
	type ErrorComponentProps,
	Link,
	notFound,
} from "@tanstack/react-router";
import { Suspense } from "react";

import {
	Card,
	ErrorPanel,
	PageHeader,
	Skeleton,
	StatusBadge,
} from "../../../ui/components.js";
import { describeError, todo, toggleTodo } from "../api.js";

export const Route = createFileRoute("/_app/todos/$id")({
	// Started, not awaited: the page renders at once, and the todo streams in.
	loader: ({ context, params }) => {
		const id = Number(params.id);
		if (!Number.isInteger(id)) {
			throw notFound();
		}
		void context.queryClient.runPromiseExit(Query.prefetch(todo(id)));
	},
	errorComponent: TodoFailed,
	component: function TodoPage() {
		return (
			<Suspense fallback={<Skeleton rows={2} />}>
				<TodoDetail />
			</Suspense>
		);
	},
});

function TodoDetail() {
	const { id } = Route.useParams();
	const { value } = useSuspenseQuery(todo(Number(id)));
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
									id: value.id,
									completed: !value.completed,
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

function TodoFailed({ error, reset }: ErrorComponentProps) {
	const resetFailure = useResetQueryFailure();
	return (
		<ErrorPanel
			title="Couldn't load this todo"
			message={describeError(QueryFailure.is(error) ? error.error : error)}
			onRetry={() => {
				resetFailure(error);
				reset();
			}}
		/>
	);
}
