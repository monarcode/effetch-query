import { Query } from "@monarcode/effetch-query";
import {
	useQueryClient,
	useSuspenseQuery,
} from "@monarcode/effetch-query/react";
import {
	createFileRoute,
	Link,
	Outlet,
	useRouter,
} from "@tanstack/react-router";

import { AppShell, UserChip } from "../../../ui/components.js";
import { viewer } from "../api.js";
import { PageError } from "../page-error.js";
import { clearSessionCookie } from "../session.js";

export const Route = createFileRoute("/_app")({
	// Signed out, the viewer dies with a redirect to sign in, and the router
	// follows it, on the server as in the browser.
	loader: ({ context }) => context.queryClient.runPromise(Query.fetch(viewer)),
	// Its pages' errors show inside it; its own replace it.
	errorComponent: (props) => (
		<AppShell>
			<PageError {...props} />
		</AppShell>
	),
	component: function SignedInLayout() {
		const { value: user } = useSuspenseQuery(viewer);
		const router = useRouter();
		const queryClient = useQueryClient();

		return (
			<AppShell
				nav={
					<>
						<Link to="/" activeOptions={{ exact: true }}>
							My todos
						</Link>
						<Link to="/todos" activeOptions={{ exact: true }}>
							All todos
						</Link>
					</>
				}
				user={
					<UserChip
						name={`${user.firstName} ${user.lastName}`}
						image={user.image}
						onSignOut={async () => {
							clearSessionCookie();
							await router.navigate({ to: "/login" });
							// Nothing of this user's may show to the next one.
							await queryClient.runPromise(Query.reset([]));
						}}
					/>
				}
			>
				<Outlet />
			</AppShell>
		);
	},
});
