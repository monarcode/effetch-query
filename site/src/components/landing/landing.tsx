import { Link } from "@tanstack/react-router";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { ArrowRight, ArrowUpRight, Check, Copy, Search } from "lucide-react";
import { type CSSProperties, Fragment, useState } from "react";
import landing from "virtual:landing";

import { gitConfig } from "@/lib/shared";

import { type Channel, CHANNELS, EffectBand } from "./effect-band";
import { EntitiesBand } from "./entities-band";
import { LiveBand } from "./live-band";
import { Mark } from "./mark";
import { Stage } from "./stage";

const INSTALL = "pnpm add @monarcode/effetch-query @monarcode/effetch";

const PLATFORMS = [
	{ name: "React", note: "useQuery and useMutation", page: "react" },
	{
		name: "React Native",
		note: "focus and online from the app",
		page: "react/react-native",
	},
	{
		name: "TanStack Start",
		note: "loaders and server rendering",
		page: "frameworks/tanstack-start",
	},
	{
		name: "React Router",
		note: "framework mode",
		page: "frameworks/react-router",
	},
	{ name: "Next.js", note: "the App Router", page: "frameworks/nextjs" },
	{ name: "Effect, no UI", note: "the cache from Effect code", page: "cache" },
] as const;

export function Landing() {
	const [channel, setChannel] = useState<Channel>("e");
	function follow(next: Channel) {
		setChannel(next);
		document.getElementById("effect")?.scrollIntoView({
			behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
				? "auto"
				: "smooth",
		});
	}
	return (
		<div className="landing">
			<LandingNav />
			<main>
				<Stage
					facts={landing.facts}
					panel={landing.code.stage}
					heading={
						<>
							<h1 id="stage-title" className="stage-title">
								<span>
									<span>Server state,</span>
								</span>{" "}
								<span>
									<span>as an Effect.</span>
								</span>
							</h1>
							<Signature onPick={follow} />
						</>
					}
				>
					<p className="stage-sub">
						A query is an Effect with a key. Effetch Query fetches it once
						for every component that shows it, refreshes it in the
						background, and keeps its errors and services typed from the
						request to the component.
					</p>
					<GetStarted />
					<CopyCommand command={INSTALL} />
				</Stage>

				<EffectBand
					channel={channel}
					onChannel={setChannel}
					errors={landing.errors}
					code={landing.code}
				/>

				<EntitiesBand
					facts={landing.entities}
					panel={landing.code.entities}
				/>

				<LiveBand facts={landing.live} panel={landing.code.live} />

				<section
					className="band band-platforms"
					aria-labelledby="runs-title"
				>
					<h2 id="runs-title" className="band-title">
						Runs where Effect runs.
					</h2>
					<ul className="platforms">
						{PLATFORMS.map((platform) => (
							<li key={platform.name} className="reveal">
								<Link
									to="/docs/$"
									params={{ _splat: platform.page }}
									className="platform"
								>
									<span className="platform-name">
										{platform.name}
									</span>
									<span className="platform-note">
										{platform.note}
									</span>
									<ArrowUpRight
										aria-hidden
										className="platform-arrow"
									/>
								</Link>
							</li>
						))}
					</ul>
					<p className="band-note">
						Browsers, React Native (Hermes), Node 20+, Bun and Deno. It
						pairs with <a href="https://effetch.pages.dev">Effetch</a>,
						the typed HTTP client for Effect, and works with any Effect
						too.
					</p>
				</section>

				<section className="close" aria-labelledby="close-title">
					<div className="close-lead">
						<h2 id="close-title" className="close-title reveal">
							Build the todo app.
						</h2>
						<p className="close-sub">
							Getting started builds a small todo app one piece at a
							time, a file for each step.
						</p>
						<div className="hero-actions">
							<GetStarted />
							<CopyCommand command={INSTALL} />
						</div>
						<p className="close-thanks">
							With thanks to{" "}
							<a href="https://tanstack.com/query">TanStack Query</a>,
							whose model, vocabulary and many defaults Effetch Query
							borrows.
						</p>
					</div>
					<ol className="close-steps" aria-label="Getting started">
						{landing.steps.map((step) => (
							<li key={step.n} className="reveal">
								<Link
									to="/docs/$"
									params={{ _splat: "getting-started" }}
									hash={step.href.split("#")[1]}
									className="close-step"
								>
									<span className="close-step-n">{step.n}</span>
									<span className="close-step-title">
										{step.title}
									</span>
									<code>{step.file}</code>
									<ArrowRight
										aria-hidden
										className="close-step-arrow"
									/>
								</Link>
							</li>
						))}
					</ol>
				</section>
			</main>
			<LandingFooter />
		</div>
	);
}

/** `Effect<A, E, R>`, each parameter a way into the band that follows it. */
function Signature({ onPick }: { onPick: (channel: Channel) => void }) {
	return (
		<p className="signature">
			<span className="signature-type" aria-hidden>
				Effect&lt;
			</span>
			{CHANNELS.map((each, i) => (
				<Fragment key={each.id}>
					<a
						href="#effect"
						className="signature-param"
						style={{ "--i": i } as CSSProperties}
						onClick={(event) => {
							event.preventDefault();
							onPick(each.id);
						}}
					>
						<b>{each.letter}</b>
						<span>{each.short}</span>
					</a>
					{i < CHANNELS.length - 1 ? (
						<span className="signature-type" aria-hidden>
							,{" "}
						</span>
					) : null}
				</Fragment>
			))}
			<span className="signature-type" aria-hidden>
				&gt;
			</span>
		</p>
	);
}

function GetStarted() {
	return (
		<Link
			to="/docs/$"
			params={{ _splat: "getting-started" }}
			className="button-primary"
		>
			Get started
			<ArrowRight aria-hidden className="size-4" />
		</Link>
	);
}

function LandingNav() {
	const { setOpenSearch } = useSearchContext();
	return (
		<header className="landing-nav">
			<Link to="/" className="landing-brand" aria-label="Effetch Query home">
				<Mark className="landing-mark" />
				<span>Effetch Query</span>
			</Link>
			<nav className="landing-links" aria-label="Site">
				<Link to="/docs/$" params={{ _splat: "" }}>
					Docs
				</Link>
				<Link to="/docs/$" params={{ _splat: "reference" }}>
					Reference
				</Link>
				<Link to="/docs/$" params={{ _splat: "examples" }}>
					Examples
				</Link>
				<a href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}>
					GitHub
				</a>
			</nav>
			<button
				type="button"
				className="landing-search"
				onClick={() => setOpenSearch(true)}
			>
				<Search aria-hidden className="size-4" />
				<span>Search</span>
				<kbd>⌘K</kbd>
			</button>
		</header>
	);
}

function LandingFooter() {
	return (
		<footer className="landing-footer">
			<div className="landing-brand">
				<Mark className="landing-mark" />
				<span>Effetch Query</span>
			</div>
			<nav aria-label="Footer" className="footer-links">
				<Link to="/docs/$" params={{ _splat: "" }}>
					Docs
				</Link>
				<a href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}>
					GitHub
				</a>
				<a href="https://www.npmjs.com/package/@monarcode/effetch-query">
					npm
				</a>
				<a href="https://effetch.pages.dev">Effetch</a>
				<a href="/llms.txt">llms.txt</a>
			</nav>
			<p className="footer-note">MIT licensed.</p>
		</footer>
	);
}

function CopyCommand({ command }: { command: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="copy-command">
			<code>{command}</code>
			<button
				type="button"
				aria-label={copied ? "Copied" : "Copy the install command"}
				onClick={() => {
					navigator.clipboard
						?.writeText(command)
						.then(() => {
							setCopied(true);
							setTimeout(() => setCopied(false), 1600);
						})
						// Without clipboard access the command stays there to select.
						.catch(() => {});
				}}
			>
				{copied ? (
					<Check aria-hidden className="size-4" />
				) : (
					<Copy aria-hidden className="size-4" />
				)}
			</button>
		</div>
	);
}
