import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { baseOptions } from "@/lib/layout.shared";
import { pageHead, websiteJsonLd } from "@/lib/shared";

const TAGLINE = "Server state for Effect apps, inspired by TanStack Query.";

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
	component: Home,
});

// A placeholder until the landing page is designed.
function Home() {
	return (
		<HomeLayout {...baseOptions()}>
			<div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-16">
				<h1 className="text-4xl font-semibold">Effetch Query</h1>
				<p className="mt-3 text-lg text-fd-muted-foreground">{TAGLINE}</p>
				<pre className="mt-6 overflow-x-auto rounded-md border bg-fd-card px-4 py-3 text-sm">
					<code>
						pnpm add @monarcode/effetch-query @monarcode/effetch effect
					</code>
				</pre>
				<div className="mt-6">
					<Link
						to="/docs/$"
						params={{ _splat: "" }}
						className="rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
					>
						Read the docs
					</Link>
				</div>
			</div>
		</HomeLayout>
	);
}
