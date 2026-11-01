import * as AsyncResult from "effect/reactivity/AsyncResult";

import type { QueryClient } from "@monarcode/effetch-query";
import {
	QueryProvider,
	useMutation,
	useQuery,
} from "@monarcode/effetch-query/react";

import { type Todo, todos, toggleTodo } from "./api.js";

export function App({ client }: { readonly client: QueryClient.QueryClient }) {
	return (
		<QueryProvider client={client}>
			<main className="page">
				<h1>Todos</h1>
				<TodoList />
			</main>
		</QueryProvider>
	);
}

function TodoList() {
	const result = useQuery(todos({ query: { limit: 10 } }));

	return AsyncResult.match(result, {
		onInitial: () => <p>Loading…</p>,
		onFailure: () => <p role="alert">Couldn't load the todos.</p>,
		onSuccess: ({ value }) => (
			<ul className="card todo-list">
				{value.todos.map((todo) => (
					<TodoItem key={todo.id} todo={todo} />
				))}
			</ul>
		),
	});
}

function TodoItem({ todo }: { readonly todo: Todo }) {
	const toggle = useMutation(toggleTodo);

	return (
		<li className={todo.completed ? "todo-row done" : "todo-row"}>
			<input
				type="checkbox"
				aria-label={todo.todo}
				checked={todo.completed}
				disabled={toggle.result.waiting}
				onChange={(event) =>
					void toggle.run({
						params: { id: todo.id },
						body: { completed: event.target.checked },
					})
				}
			/>
			<span className="todo-title">{todo.todo}</span>
			{AsyncResult.isFailure(toggle.result) ? (
				<span role="alert">Couldn't save</span>
			) : null}
		</li>
	);
}
