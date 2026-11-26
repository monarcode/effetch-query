import { useEffect, useRef } from "react";

import type { LandingPanel } from "@/lib/landing-data";

import { CodeFile } from "./code";

/**
 * A file from the docs whose named lines light as a simulation runs them.
 * `step` changes each time the lines light again, so a line that stays lit
 * runs its light once more.
 */
export function Trace({
	panel,
	lit,
	step,
}: {
	panel: LandingPanel;
	lit: readonly string[];
	step: number;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const names = lit.join(" ");

	useEffect(
		function lightLines() {
			const root = ref.current;
			if (!root) return;
			const lines = root.querySelectorAll<HTMLElement>("[data-line]");
			for (const line of lines) line.removeAttribute("data-on");
			// A layout between off and on restarts the light's animation.
			void root.offsetWidth;
			for (const line of lines)
				if (names.split(" ").includes(line.dataset.line ?? ""))
					line.setAttribute("data-on", "");
			// Set here rather than rendered, so the prerendered file isn't
			// dimmed before its lines can light.
			root.toggleAttribute("data-live", names !== "");
		},
		[names, step],
	);

	return (
		<div ref={ref} className="trace">
			<CodeFile panel={panel} />
		</div>
	);
}
