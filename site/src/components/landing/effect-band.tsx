import { Fragment, type KeyboardEvent, type ReactNode, useState } from "react";

import type { ErrorFacts, LandingPanel } from "@/lib/landing-data";

import { CodeFile } from "./code";

export type Channel = "a" | "e" | "r";

/** Effect's three type parameters, as the page names them. */
export const CHANNELS: readonly {
	readonly id: Channel;
	readonly letter: string;
	readonly name: string;
	readonly short: string;
	readonly note: string;
}[] = [
	{
		id: "a",
		letter: "A",
		name: "The value",
		short: "the value",
		note: "Decoded by the endpoint’s schema, and typed in every component that reads it.",
	},
	{
		id: "e",
		letter: "E",
		name: "The errors",
		short: "typed errors",
		note: "Each a tagged error, caught by its tag in Effect code or in the component.",
	},
	{
		id: "r",
		letter: "R",
		name: "The services",
		short: "your services",
		note: "Registered once. A query that needs one you haven’t registered doesn’t compile.",
	},
];

/**
 * The band that follows Effect's three type parameters through the docs'
 * code: pick one and its lines light, from where it's declared to where a
 * component renders it.
 */
export function EffectBand({
	channel,
	onChannel,
	errors,
	code,
}: {
	channel: Channel;
	onChannel: (channel: Channel) => void;
	errors: ErrorFacts;
	code: { readonly errors: LandingPanel; readonly services: LandingPanel };
}) {
	const [status, setStatus] = useState(errors.cases[0]!.status);
	const picked = errors.cases.find((each) => each.status === status)!;
	const current = CHANNELS.find((each) => each.id === channel)!;

	return (
		<section
			id="effect"
			className="band band-effect"
			aria-labelledby="effect-title"
		>
			<div className="effect-head reveal">
				<h2 id="effect-title" className="band-title">
					Effect all the way to the component.
				</h2>
				<p className="effect-lead">
					A query is an Effect, so its value, its errors and the services
					it needs keep their types from the request to the component that
					renders them. Pick one to follow it through the code.
				</p>
			</div>

			<div
				className="effect-signature reveal"
				role="tablist"
				aria-label="Follow a type"
			>
				<span className="effect-signature-type" aria-hidden>
					Effect&lt;
				</span>
				{CHANNELS.map((each, i) => (
					<Fragment key={each.id}>
						<button
							type="button"
							role="tab"
							id={`channel-${each.id}`}
							aria-selected={channel === each.id}
							aria-controls="channel-panel"
							tabIndex={channel === each.id ? 0 : -1}
							className="effect-channel"
							onClick={() => onChannel(each.id)}
							onKeyDown={(event) =>
								arrows(event, CHANNELS, i, (next) => onChannel(next.id))
							}
						>
							<b>{each.letter}</b>
							<span>{each.name}</span>
						</button>
						{i < CHANNELS.length - 1 ? (
							<span className="effect-signature-type" aria-hidden>
								,
							</span>
						) : null}
					</Fragment>
				))}
				<span className="effect-signature-type" aria-hidden>
					&gt;
				</span>
			</div>

			<div
				id="channel-panel"
				role="tabpanel"
				aria-labelledby={`channel-${channel}`}
				className="effect-trace reveal"
				data-channel={channel}
				data-case={channel === "e" ? picked.line : undefined}
			>
				<CodeFile panel={channel === "r" ? code.services : code.errors} />

				<aside className="effect-out" aria-live="polite">
					<p className="effect-out-name">
						<b>{current.letter}</b> {current.name}
					</p>
					<p className="effect-out-note">{current.note}</p>

					{channel === "a" ? (
						<Rendered label="Renders">
							<h3 className="effect-rendered-title">
								Review the cache PR
							</h3>
						</Rendered>
					) : null}

					{channel === "e" ? (
						<>
							<div
								className="effect-statuses"
								role="radiogroup"
								aria-label="The response"
							>
								{errors.cases.map((each, i) => (
									<button
										key={each.status}
										type="button"
										role="radio"
										aria-checked={each.status === status}
										tabIndex={each.status === status ? 0 : -1}
										onClick={() => setStatus(each.status)}
										onKeyDown={(event) =>
											arrows(event, errors.cases, i, (next) =>
												setStatus(next.status),
											)
										}
									>
										{each.status}
									</button>
								))}
							</div>
							<Rendered
								key={picked.status}
								label={`A ${picked.status} fails with ${picked.tag ?? "an HttpError"}, and renders`}
							>
								{picked.renders === "{error.message}" ? (
									<p>
										<code>error.message</code>, from the response
									</p>
								) : (
									<p>{picked.renders}</p>
								)}
							</Rendered>
							{picked.status === 404 ? (
								<p className="effect-out-aside">
									In a loader, <code>Effect.catchTag</code> turns the
									same 404 into no todo.
								</p>
							) : null}
						</>
					) : null}

					{channel === "r" ? (
						<Rendered label="Then">
							<p>
								<code>QueryClient.make</code> needs a layer that
								provides <code>ApiClient</code>, or it doesn’t compile.
							</p>
						</Rendered>
					) : null}
				</aside>
			</div>
		</section>
	);
}

/** Arrow keys move along a row of tabs or radios, and focus follows. */
function arrows<T>(
	event: KeyboardEvent<HTMLButtonElement>,
	items: readonly T[],
	index: number,
	pick: (item: T) => void,
) {
	const step =
		event.key === "ArrowRight" || event.key === "ArrowDown"
			? 1
			: event.key === "ArrowLeft" || event.key === "ArrowUp"
				? -1
				: 0;
	if (!step) return;
	event.preventDefault();
	const next = (index + step + items.length) % items.length;
	pick(items[next]!);
	const row = event.currentTarget.parentElement;
	const buttons = row?.querySelectorAll<HTMLButtonElement>(":scope > button");
	buttons?.[next]?.focus();
}

function Rendered({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="effect-rendered">
			<p className="effect-rendered-label">{label}</p>
			<div className="effect-rendered-body">{children}</div>
		</div>
	);
}
