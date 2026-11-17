import { QueryClient } from "@monarcode/effetch-query";
import {
	HydrationBoundary,
	useIsFetching,
	useIsMutating,
	useQueryClient,
	useSuspenseQuery,
} from "@monarcode/effetch-query/react";
import {
	NavLink,
	Outlet,
	type RouterContextProvider,
	useNavigate,
} from "react-router";

import { AppShell, UserChip } from "../../../ui/components.js";
import { viewer } from "../api.js";
import type { User } from "../dummyjson.js";
import { getQueryClient } from "../query-context.js";
import { clearSessionCookie } from "../session.js";
import { userContext } from "../user-context.js";
import type { Route } from "./+types/signed-in";

// Runs before any page below loads, on the server and in the browser.
// Signed out, the viewer dies with a redirect to sign in, and the router
// follows it. Signed in, its pages' loaders get the user from the context.
const requireUser = async ({
	context,
}: {
	readonly context: Readonly<RouterContextProvider>;
}) => {
	context.set(userContext, await getQueryClient(context).fetch(viewer));
};

export const middleware: Array<Route.MiddlewareFunction> = [requireUser];

export const clientMiddleware: Array<Route.ClientMiddlewareFunction> = [
	requireUser,
];

// The first page's loaders run on the server, and send what they loaded.
// After that, client loaders load into the page's own client, as the Start
// apps' loaders do: what it has cached isn't fetched again, and dummyjson's
// unsaved changes stay until the page is reloaded.
export function loader({ context }: Route.LoaderArgs) {
	return { state: QueryClient.dehydrate(getQueryClient(context)) };
}

export function clientLoader() {
	return { state: undefined };
}

export default function SignedInLayout({ loaderData }: Route.ComponentProps) {
	return (
		<HydrationBoundary state={loaderData.state}>
			<Shell />
		</HydrationBoundary>
	);
}

/** What the top bar shows of the user. */
const chipOf = (user: User) => ({
	name: `${user.firstName} ${user.lastName}`,
	image: user.image,
});

function Shell() {
	// Re-renders when the name or image changes, not the rest of the user.
	const { value: chip } = useSuspenseQuery(viewer, { select: chipOf });
	const fetching = useIsFetching();
	const saving = useIsMutating();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	return (
		<AppShell
			loading={fetching > 0}
			saving={saving > 0}
			nav={
				<>
					<NavLink to="/" end>
						My todos
					</NavLink>
					<NavLink to="/todos">All todos</NavLink>
				</>
			}
			user={
				<UserChip
					name={chip.name}
					image={chip.image}
					onSignOut={async () => {
						clearSessionCookie();
						await navigate("/login");
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
}
