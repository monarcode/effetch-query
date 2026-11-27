import { Link } from "@tanstack/react-router";
import * as Twoslash from "fumadocs-twoslash/ui";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { ComponentProps } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

import type { LandingPanel } from "@/lib/landing-data";

// Every name is a hover target, so they stay out of the tab order, as in
// the docs: the code reads the same without its hovers.
function PopupTrigger(props: ComponentProps<typeof Twoslash.PopupTrigger>) {
	return <Twoslash.PopupTrigger {...props} tabIndex={-1} />;
}

const components = { ...Twoslash, PopupTrigger };

/**
 * An example from the docs, highlighted with its type hovers, and a link
 * to its page. Twoslash compiled it when the site was built, as the docs
 * check compiles it.
 */
export function CodeFile({ panel }: { panel: LandingPanel }) {
	return (
		<figure className="code-file">
			<figcaption>
				<span className="code-file-name">
					{panel.name ?? panel.page.title}
				</span>
				<Link
					to="/docs/$"
					params={{ _splat: panel.page.href.replace(/^\/docs\/?/, "") }}
					className="code-file-note"
				>
					{panel.name ? panel.page.title : "Read the page"}
				</Link>
			</figcaption>
			<div className="code-file-body">
				{toJsxRuntime(panel.hast, { Fragment, jsx, jsxs, components })}
			</div>
		</figure>
	);
}
