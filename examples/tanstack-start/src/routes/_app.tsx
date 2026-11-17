import {
	useIsFetching,
	useIsMutating,
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
import type { User } from "../dummyjson.js";
import { PageError } from "../page-error.js";
import { clearSessionCookie } from "../session.js";

/** What the top bar shows of the user. */
const chipOf = (user: User) => ({
	name: `${user.firstName} ${user.lastName}`,
	image: user.image,
});

export const Route = createFileRoute("/_app")({
	// Runs before any page below loads. Signed out, the viewer dies with a
	// redirect to sign in, and the router follows it, on the server as in
	// the browser. Signed in, its pages' loaders get the user in their context.
	beforeLoad: async ({ context }) => ({
		user: await context.queryClient.fetch(viewer),
	}),
	// Its pages' errors show inside it; its own replace it.
	errorComponent: (props) => (
		<AppShell>
			<PageError {...props} />
		</AppShell>
	),
	component: function SignedInLayout() {
		// Re-renders when the name or image changes, not the rest of the user.
		const { value: chip } = useSuspenseQuery(viewer, { select: chipOf });
		const fetching = useIsFetching();
		const saving = useIsMutating();
		const router = useRouter();
		const queryClient = useQueryClient();

		return (
			<AppShell
				loading={fetching > 0}
				saving={saving > 0}
				nav={
					<>
						<Link to="/" activeOptions={{ exact: true }}>
							My todos
						</Link>
						<Link to="/todos" activeOptions={{ exact: false }}>
							All todos
						</Link>
					</>
				}
				user={
					<UserChip
						name={chip.name}
						image={chip.image}
						onSignOut={async () => {
							clearSessionCookie();
							await router.navigate({ to: "/login" });
							// Nothing of this user's may show to the next one, and nothing
							// refetches without a session.
							await queryClient.clear();
						}}
					/>
				}
			>
				<Outlet />
			</AppShell>
		);
	},
});
