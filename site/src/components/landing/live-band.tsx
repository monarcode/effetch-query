import { useEffect, useRef, useState } from "react";

import type { LandingPanel, LiveFacts } from "@/lib/landing-data";

import { TODOS, type Todo } from "./cache";
import { useTimers } from "./timers";
import { Trace } from "./trace";

/** How often the simulated socket pushes a change while in view. */
const EVERY = 3600;

type Change =
	| { readonly _tag: "saved"; readonly todo: Todo }
	| { readonly _tag: "deleted"; readonly id: number };

/** What the socket sends, in order, round and round. */
const SCRIPT: readonly Change[] = [
	{
		_tag: "saved",
		todo: { id: 4, title: "Reply to the design review", done: false },
	},
	{ _tag: "saved", todo: { id: 2, title: "Review the cache PR", done: true } },
	{ _tag: "deleted", id: 4 },
	{
		_tag: "saved",
		todo: { id: 2, title: "Review the cache PR", done: false },
	},
];

/** The docs' `apply`: an upsert or a removal by id. */
function apply(change: Change, list: readonly Todo[]): readonly Todo[] {
	const id = change._tag === "saved" ? change.todo.id : change.id;
	const rest = list.filter((todo) => todo.id !== id);
	return change._tag === "saved" ? [...rest, change.todo] : rest;
}

const same = (a: readonly Todo[], b: readonly Todo[]) =>
	JSON.stringify(a) === JSON.stringify(b);

interface Message {
	readonly n: number;
	readonly tag: string;
	readonly json: string;
	readonly result: "applied" | "unchanged";
}

/**
 * The docs' socket-fed list: each message is decoded, turned into an
 * update by `apply`, and applied to the cached list. Dropping the socket
 * subscribes again after `Stream.retry`'s wait.
 */
export function LiveBand({
	facts,
	panel,
}: {
	facts: LiveFacts;
	panel: LandingPanel;
}) {
	const { later } = useTimers();
	const rootRef = useRef<HTMLElement>(null);
	const [list, setList] = useState<readonly Todo[]>(TODOS);
	const [messages, setMessages] = useState<readonly Message[]>([]);
	const [changed, setChanged] = useState<{ id: number; n: number } | null>(
		null,
	);
	const [lit, setLit] = useState<readonly string[]>(["live"]);
	const [step, setStep] = useState(0);
	const [retryIn, setRetryIn] = useState(0);
	const next = useRef(0);
	const count = useRef(0);
	const last = useRef<Change | null>(null);
	const dropped = useRef(false);
	const pushing = useRef(0);
	/** The list as it will be once the changes on their way land. */
	const ahead = useRef<readonly Todo[]>(TODOS);

	function light(lines: readonly string[]) {
		setLit(lines);
		setStep((n) => n + 1);
	}

	function tagOf(change: Change) {
		return change._tag === "saved" ? facts.saved : facts.deleted;
	}

	function push(change: Change) {
		last.current = change;
		const n = ++count.current;
		const json = JSON.stringify(
			change._tag === "saved"
				? { _tag: tagOf(change), todo: change.todo }
				: { _tag: tagOf(change), id: change.id },
		);
		const after = apply(change, ahead.current);
		const result: Message["result"] = same(after, ahead.current)
			? "unchanged"
			: "applied";
		ahead.current = after;
		const token = ++pushing.current;
		// A later push takes over the light from this one.
		const lightIfLatest = (lines: readonly string[]) => {
			if (pushing.current === token) light(lines);
		};
		setMessages((was) =>
			[{ n, tag: tagOf(change), json, result }, ...was].slice(0, 4),
		);
		light(["socket", "decode"]);
		later(380, () => lightIfLatest(["apply", "upsert"]));
		later(760, () => {
			setList((now) => apply(change, now));
			if (result === "applied")
				setChanged({
					id: change._tag === "saved" ? change.todo.id : change.id,
					n,
				});
		});
		later(1700, () => lightIfLatest(dropped.current ? ["retry"] : ["live"]));
	}

	function pushNext() {
		push(SCRIPT[next.current % SCRIPT.length]!);
		next.current += 1;
	}

	const pushRef = useRef(pushNext);
	pushRef.current = pushNext;
	const connected = retryIn === 0;

	useEffect(
		function streamWhileVisible() {
			const root = rootRef.current;
			if (!root || !connected) return;
			let timer = 0;
			const watcher = new IntersectionObserver((entries) => {
				window.clearInterval(timer);
				if (entries.at(-1)?.isIntersecting)
					timer = window.setInterval(() => pushRef.current(), EVERY);
			});
			watcher.observe(root);
			return function stopStreaming() {
				window.clearInterval(timer);
				watcher.disconnect();
			};
		},
		[connected],
	);

	function drop() {
		dropped.current = true;
		pushing.current += 1;
		light(["retry"]);
		const seconds = facts.retry.seconds;
		setRetryIn(Math.ceil(seconds));
		for (let s = 1; s < seconds; s++)
			later(s * 1000, () => setRetryIn(Math.ceil(seconds - s)));
		later(seconds * 1000, () => {
			setRetryIn(0);
			dropped.current = false;
			light(["socket", "live"]);
		});
	}

	return (
		<section
			ref={rootRef}
			className="band band-feature"
			aria-labelledby="live-title"
		>
			<div className="band-head reveal">
				<h2 id="live-title" className="band-title">
					Live between fetches.
				</h2>
				<p className="band-lead">
					<code>live</code> applies a stream of changes, here from a
					WebSocket, to a fetched list. Each change is an upsert or a
					removal by id, so applying one twice is safe, and a socket that
					drops subscribes again.
				</p>
			</div>

			<div className="feature-run reveal">
				<Trace panel={panel} lit={lit} step={step} />

				<div className="feature-panel">
					<p className="live-socket" data-open={connected || undefined}>
						<code>{facts.url}</code>
						<span>
							{connected ? "open" : `closed, retrying in ${retryIn}s`}
						</span>
					</p>

					<ol
						className="live-messages"
						aria-label="Messages from the socket"
					>
						{messages.map((message) => (
							<li
								key={message.n}
								data-unchanged={
									message.result === "unchanged" || undefined
								}
							>
								<b>{message.tag}</b>
								<code>{message.json}</code>
								<span>
									{message.result === "applied"
										? "applied"
										: "no change"}
								</span>
							</li>
						))}
						{messages.length === 0 ? (
							<li className="live-waiting">Waiting for the socket…</li>
						) : null}
					</ol>

					<article className="entity-query live-list">
						<header>
							<code>useQuery({facts.query}())</code>
							<span>{list.length} todos</span>
						</header>
						<ul>
							{list.map((todo) => (
								<li
									key={
										changed?.id === todo.id
											? `${todo.id}-${changed.n}`
											: todo.id
									}
									data-changed={changed?.id === todo.id || undefined}
								>
									<span
										className="entity-row"
										data-done={todo.done || undefined}
									>
										<span className="stage-check" aria-hidden>
											{todo.done ? "✓" : "○"}
										</span>
										<span className="stage-todo-title">
											{todo.title}
										</span>
									</span>
								</li>
							))}
						</ul>
					</article>

					<div className="feature-controls">
						<button
							type="button"
							disabled={!connected}
							onClick={pushNext}
						>
							Push a change
						</button>
						<button
							type="button"
							disabled={!connected || !last.current}
							onClick={() => last.current && push(last.current)}
						>
							Send it again
						</button>
						<button type="button" disabled={!connected} onClick={drop}>
							Drop the socket
						</button>
					</div>
				</div>
			</div>
		</section>
	);
}
