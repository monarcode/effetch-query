import * as AsyncResult from "effect/reactivity/AsyncResult";

import * as Fetch from "@monarcode/effetch";
import type { QueryClient } from "@monarcode/effetch-query";
import {
	QueryFailure,
	QueryProvider,
	useMutation,
	useQuery,
	useRefetch,
	useResetQueryFailure,
	useSuspenseQuery,
} from "@monarcode/effetch-query/react";
import * as React from "react";

import { type Todo, todo, todos, toggleTodo } from "./api.js";

export function App({ client }: { readonly client: QueryClient.QueryClient }) {
	const [open, setOpen] = React.useState<number | null>(null);
	return (
		<QueryProvider client={client}>
			<TodoList onOpen={setOpen} />
			{open === null ? null : (
				<Boundary key={open}>
					<React.Suspense fallback={<p>Loading the todo…</p>}>
						<TodoDetail id={open} />
					</React.Suspense>
				</Boundary>
			)}
		</QueryProvider>
	);
}

function TodoList({ onOpen }: { readonly onOpen: (id: number) => void }) {
	const result = useQuery(todos());
	// A refresh button on the web; a RefreshControl in React Native.
	const { refetch, isRefetching } = useRefetch(todos);

	return (
		<section>
			<button disabled={isRefetching} onClick={() => void refetch()}>
				{isRefetching ? "Refreshing…" : "Refresh"}
			</button>
			{AsyncResult.match(result, {
				onInitial: () => <p>Loading your todos…</p>,
				onFailure: () => <p role="alert">Couldn't load your todos.</p>,
				onSuccess: ({ value }) => (
					<ul>
						{value.map((item) => (
							<TodoItem key={item.id} todo={item} onOpen={onOpen} />
						))}
					</ul>
				),
			})}
		</section>
	);
}

function TodoItem({
	todo: item,
	onOpen,
}: {
	readonly todo: Todo;
	readonly onOpen: (id: number) => void;
}) {
	const toggle = useMutation(toggleTodo);
	return (
		<li>
			<input
				type="checkbox"
				aria-label={`Done: ${item.title}`}
				checked={item.done}
				onChange={() =>
					void toggle.run({
						params: { id: item.id },
						body: { done: !item.done },
					})
				}
			/>
			<button onClick={() => onOpen(item.id)}>{item.title}</button>
			{AsyncResult.isFailure(toggle.result) ? (
				<span role="alert">Couldn't save {item.title}</span>
			) : null}
		</li>
	);
}

function TodoDetail({ id }: { readonly id: number }) {
	const { value } = useSuspenseQuery(todo({ params: { id } }));
	return (
		<article>
			<h2>{value.title}</h2>
			<p>{value.done ? "Done" : "Not done yet"}</p>
		</article>
	);
}

const describeFailure = (error: unknown) => {
	const shown = QueryFailure.is(error) ? error.error : error;
	return shown instanceof Fetch.HttpError && shown.status === 404
		? "This todo doesn't exist."
		: "Couldn't load this todo.";
};

function Retry({
	error,
	onRetry,
}: {
	readonly error: unknown;
	readonly onRetry: () => void;
}) {
	const resetFailure = useResetQueryFailure();
	return (
		<div role="alert">
			<p>{describeFailure(error)}</p>
			<button
				onClick={() => {
					resetFailure(error);
					onRetry();
				}}
			>
				Try again
			</button>
		</div>
	);
}

/** Shows a todo that failed to load, with a button that refetches it. */
class Boundary extends React.Component<
	{ readonly children: React.ReactNode },
	{ readonly error: unknown; readonly failed: boolean }
> {
	override state = { error: undefined as unknown, failed: false };

	static getDerivedStateFromError(error: unknown) {
		return { error, failed: true };
	}

	override render() {
		return this.state.failed ? (
			<Retry
				error={this.state.error}
				onRetry={() => this.setState({ error: undefined, failed: false })}
			/>
		) : (
			this.props.children
		);
	}
}
