import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/login")({
	component: () => <h1>Sign in</h1>,
});
