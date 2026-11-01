import { QueryFailure } from "@monarcode/effetch-query/react";
import type { ReactNode } from "react";
import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useRouteError,
} from "react-router";

import { AppShell, ErrorPanel, NotFoundPanel } from "../../ui/components.js";
import { describeError } from "./api.js";
import { queryClientMiddleware } from "./query-context.js";

import styles from "../../ui/styles.css?url";

export const middleware = [queryClientMiddleware];

export const meta = () => [{ title: "Todos" }];

export function Layout({ children }: { readonly children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta
					name="viewport"
					content="width=device-width, initial-scale=1"
				/>
				<link rel="stylesheet" href={styles} precedence="default" />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

export function ErrorBoundary() {
	const error = useRouteError();
	return (
		<AppShell>
			{isRouteErrorResponse(error) && error.status === 404 ? (
				<NotFoundPanel />
			) : (
				<ErrorPanel
					title="Something went wrong"
					message={describeError(
						QueryFailure.is(error) ? error.error : error,
					)}
				/>
			)}
		</AppShell>
	);
}
