import type { QueryClient } from "@monarcode/effetch-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{
	readonly queryClient: QueryClient.QueryClient;
}>()({
	head: () => ({ meta: [{ charSet: "utf-8" }, { title: "Todos" }] }),
	notFoundComponent: () => <h1>Page not found</h1>,
	component: function Root() {
		return (
			<html lang="en">
				<head>
					<HeadContent />
				</head>
				<body>
					<Outlet />
					<Scripts />
				</body>
			</html>
		);
	},
});
