import { QueryFailure } from "@monarcode/effetch-query/react";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { ErrorPanel } from "../../ui/components.js";
import { describeError } from "./api.js";

/** A page that failed to load, with dummyjson's message. */
export function PageError({ error }: ErrorComponentProps) {
	return (
		<ErrorPanel
			title="Something went wrong"
			message={describeError(QueryFailure.is(error) ? error.error : error)}
		/>
	);
}
