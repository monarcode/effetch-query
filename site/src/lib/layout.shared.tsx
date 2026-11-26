import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { Mark } from "@/components/landing/mark";

import { gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
	return {
		nav: {
			title: (
				<span className="docs-brand">
					<Mark />
					Effetch Query
				</span>
			),
		},
		// The site is dark only.
		themeSwitch: { enabled: false },
		githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
	};
}
