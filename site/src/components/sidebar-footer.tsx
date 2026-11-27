import { SiGithub, SiNpm } from "@icons-pack/react-simple-icons";
import { Link } from "@tanstack/react-router";

import { gitConfig } from "@/lib/shared";

/** The sidebar's last row: back to the home page, and the package's other homes. */
export function SidebarFooter() {
	return (
		<nav className="docs-sidebar-footer" aria-label="Elsewhere">
			<Link to="/">Home</Link>
			<a
				href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
				aria-label="GitHub"
				title="GitHub"
			>
				<SiGithub size={16} aria-hidden />
			</a>
			<a
				href="https://www.npmjs.com/package/@monarcode/effetch-query"
				aria-label="npm"
				title="npm"
			>
				<SiNpm size={16} aria-hidden />
			</a>
		</nav>
	);
}
