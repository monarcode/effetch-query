import { Query, QueryClient } from "@monarcode/effetch-query";
import {
	HydrationBoundary,
	useQueryClient,
	useSuspenseQuery,
} from "@monarcode/effetch-query/react";
import {
	type ClientLoaderFunctionArgs,
	type LoaderFunctionArgs,
	NavLink,
	Outlet,
	useLoaderData,
	useNavigate,
} from "react-router";

import { AppShell, UserChip } from "../../../ui/components.js";
import { viewer } from "../api.js";
import { getQueryClient } from "../query-context.js";
import { clearSessionCookie } from "../session.js";

// Signed out, the viewer dies with a redirect to sign in, and the router
// follows it.
export async function loader({ context }: LoaderFunctionArgs) {
	const client = getQueryClient(context);
	await client.runPromise(Query.fetch(viewer));
	return { state: QueryClient.dehydrate(client) };
}

// The first page's loaders run on the server, and send what they loaded.
// After that, client loaders load into the page's own client, as the Start
// apps' loaders do: what it has cached isn't fetched again, and dummyjson's
// unsaved changes stay until the page is reloaded.
export async function clientLoader({ context }: ClientLoaderFunctionArgs) {
	await getQueryClient(context).runPromise(Query.fetch(viewer));
	return { state: undefined };
}

export default function SignedInLayout() {
	const { state } = useLoaderData<typeof loader | typeof clientLoader>();
	return (
		<HydrationBoundary state={state}>
			<Shell />
		</HydrationBoundary>
	);
}

function Shell() {
	const { value: user } = useSuspenseQuery(viewer);
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	return (
		<AppShell
			nav={
				<>
					<NavLink to="/" end>
						My todos
					</NavLink>
					<NavLink to="/todos" end>
						All todos
					</NavLink>
				</>
			}
			user={
				<UserChip
					name={`${user.firstName} ${user.lastName}`}
					image={user.image}
					onSignOut={async () => {
						clearSessionCookie();
						await navigate("/login");
						// Nothing of this user's may show to the next one.
						await queryClient.runPromise(Query.reset([]));
					}}
				/>
			}
		>
			<Outlet />
		</AppShell>
	);
}
