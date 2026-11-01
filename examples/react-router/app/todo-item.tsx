import * as Cause from "effect/Cause";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { useMutation } from "@monarcode/effetch-query/react";
import { Link } from "react-router";

import { TodoRow } from "../../ui/components.js";
import { deleteTodo, describeError, toggleTodo } from "./api.js";
import type { Todo } from "./dummyjson.js";

/** A failed run's message, for the row that ran it. */
const failure = (result: AsyncResult.AsyncResult<unknown, unknown>) =>
	AsyncResult.isFailure(result)
		? describeError(Cause.squash(result.cause))
		: undefined;

export function TodoItem({
	todo,
	deletable = false,
}: {
	readonly todo: Todo;
	readonly deletable?: boolean | undefined;
}) {
	const toggle = useMutation(toggleTodo);
	const remove = useMutation(deleteTodo);

	return (
		<TodoRow
			title={<Link to={`/todos/${todo.id}`}>{todo.todo}</Link>}
			done={todo.completed}
			pending={toggle.result.waiting || remove.result.waiting}
			error={failure(toggle.result) ?? failure(remove.result)}
			onToggle={(completed) =>
				void toggle.run({ params: { id: todo.id }, body: { completed } })
			}
			onDelete={
				deletable
					? () => void remove.run({ params: { id: todo.id } })
					: undefined
			}
		/>
	);
}
