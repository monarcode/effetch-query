import { createFileRoute } from "@tanstack/react-router";

import { Landing } from "@/components/landing/landing";
import { pageHead, websiteJsonLd } from "@/lib/shared";

export const Route = createFileRoute("/")({
	head: () =>
		pageHead({
			title: "Effetch Query: server state for Effect",
			description:
				"Effectful queries and mutations for Effect 4, inspired by TanStack Query. Cached, kept fresh, typed end to end, and made to pair with Effetch.",
			path: "/",
			type: "website",
			jsonLd: [websiteJsonLd()],
		}),
	component: Landing,
});
