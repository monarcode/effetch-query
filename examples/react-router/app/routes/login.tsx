import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { Query } from "@monarcode/effetch-query";
import { useMutation } from "@monarcode/effetch-query/react";
import { type LoaderFunctionArgs, redirect, useNavigate } from "react-router";

import { AppShell, LoginCard } from "../../../ui/components.js";
import { describeError, login, viewer } from "../api.js";
import { getQueryClient } from "../query-context.js";
import { readToken } from "../session.js";

// Already signed in: there's nothing to do here.
export async function loader({ request, context }: LoaderFunctionArgs) {
	if (readToken(request.headers.get("Cookie")) === undefined) {
		return null;
	}
	const signedIn = await getQueryClient(context).runPromiseExit(
		Query.fetch(viewer),
	);
	if (Exit.isSuccess(signedIn)) {
		throw redirect("/");
	}
	return null;
}

export default function LoginPage() {
	const navigate = useNavigate();
	const { result, run } = useMutation(login);

	return (
		<AppShell>
			<LoginCard
				pending={result.waiting}
				error={
					AsyncResult.isFailure(result)
						? describeError(Cause.squash(result.cause))
						: undefined
				}
				onSubmit={async (credentials) => {
					const exit = await run({
						body: { ...credentials, expiresInMins: 60 },
					});
					if (Exit.isSuccess(exit)) {
						await navigate("/");
					}
				}}
			/>
		</AppShell>
	);
}
