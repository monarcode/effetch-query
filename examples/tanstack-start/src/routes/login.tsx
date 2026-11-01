import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { Query } from "@monarcode/effetch-query";
import { useMutation } from "@monarcode/effetch-query/react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import { AppShell, LoginCard } from "../../../ui/components.js";
import { describeError, login, viewer } from "../api.js";

export const Route = createFileRoute("/login")({
	// Already signed in: there's nothing to do here.
	loader: async ({ context }) => {
		if (context.readToken() === undefined) {
			return;
		}
		const signedIn = await context.queryClient.runPromiseExit(
			Query.fetch(viewer),
		);
		if (Exit.isSuccess(signedIn)) {
			throw redirect({ to: "/" });
		}
	},
	component: function LoginPage() {
		const router = useRouter();
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
							await router.navigate({ to: "/" });
						}
					}}
				/>
			</AppShell>
		);
	},
});
