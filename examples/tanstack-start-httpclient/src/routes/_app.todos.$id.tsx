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

import {
	Card,
	ErrorPanel,
	PageHeader,
	Skeleton,
	StatusBadge,
} from "../../../ui/components.js";
import { describeError, todo, toggleTodo } from "../api.js";
import { TodoNotFound } from "../dummyjson.js";

export const Route = createFileRoute("/_app/todos/$id")({
	// The id is a number everywhere: in the loader, the component and links.
	// Anything else in the URL is a page that doesn't exist.
	params: {
		parse: ({ id }) => {
			if (!/^\d+$/.test(id)) {
				throw notFound();
			}
			return { id: Number(id) };
		},
		stringify: ({ id }) => ({ id: String(id) }),
	},
	head: ({ params }) => ({ meta: [{ title: `Todo #${params.id} · Todos` }] }),
	// Started, not awaited: the page renders at once, and the todo streams in.
	loader: ({ context, params }) => {
		void context.queryClient.prefetch(todo(params.id));
	},
	// Shown while the todo loads, unless a list has it cached already.
	pendingComponent: () => <Skeleton rows={2} />,
	errorComponent: TodoFailed,
	component: function TodoDetail() {
		const { id } = Route.useParams();
		const result = useSuspenseQuery(todo(id));
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
	},
});

function TodoFailed({ error, reset }: ErrorComponentProps) {
	const resetFailure = useResetQueryFailure();
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
							reset();
						}
			}
		/>
	);
}
