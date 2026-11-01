import type { QueryClient } from "@monarcode/effetch-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";

import { AppShell, NotFoundPanel } from "../../../ui/components.js";

import styles from "../../../ui/styles.css?url";

export const Route = createRootRouteWithContext<{
	readonly queryClient: QueryClient.QueryClient;
	readonly readToken: () => string | undefined;
}>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Todos" },
		],
		links: [{ rel: "stylesheet", href: styles }],
	}),
	notFoundComponent: () => (
		<AppShell>
			<NotFoundPanel />
		</AppShell>
	),
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
