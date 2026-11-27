import { useRef, useState } from "react";

import type { EntityFacts, LandingPanel } from "@/lib/landing-data";

import { TODOS, type Todo } from "./cache";
import { useTimers } from "./timers";
import { Trace } from "./trace";

type Entry = "list" | "open" | "detail";
const ENTRIES: readonly Entry[] = ["list", "open", "detail"];
const DETAIL = 2;

/** How long each part of the run takes, in milliseconds. */
const TIMES = { request: 1100, set: 800, refetch: 1000, undo: 220 };

interface Cached {
	readonly list: readonly Todo[];
	readonly open: readonly Todo[];
	readonly detail: Todo;
}

const initial: Cached = {
	list: TODOS,
	open: TODOS.filter((todo) => !todo.done),
	detail: TODOS.find((todo) => todo.id === DETAIL)!,
};

const holds = (cached: Cached, entry: Entry, id: number) =>
	entry === "detail"
		? cached.detail.id === id
		: cached[entry].some((todo) => todo.id === id);

/** `Entity.update`: maps the todo in one query's value. */
function write(
	cached: Cached,
	entry: Entry,
	id: number,
	done: boolean,
): Cached {
	const update = (todo: Todo) => (todo.id === id ? { ...todo, done } : todo);
	return entry === "detail"
		? { ...cached, detail: update(cached.detail) }
		: { ...cached, [entry]: cached[entry].map(update) };
}

/**
 * The docs' optimistic toggle, run against three cached queries that hold
 * the same todos: `Entity.update` writes every copy before the request
 * leaves, `Entity.set` replaces the guess, and `invalidates` refetches the
 * lists. Set the request to fail and every write is undone, newest first.
 */
export function EntitiesBand({
	facts,
	panel,
}: {
	facts: EntityFacts;
	panel: LandingPanel;
}) {
	const { later } = useTimers();
	const [server, setServer] = useState<readonly Todo[]>(TODOS);
	const [cached, setCached] = useState(initial);
	const [running, setRunning] = useState(false);
	const [fail, setFail] = useState(false);
	const [lit, setLit] = useState<readonly string[]>([]);
	const [step, setStep] = useState(0);
	const [note, setNote] = useState(
		"Click a todo in any of the three queries to run the mutation.",
	);
	/** Each entry's last write, so it flashes when written. */
	const [written, setWritten] = useState<Record<Entry, number>>({
		list: 0,
		open: 0,
		detail: 0,
	});
	const [refetching, setRefetching] = useState(false);
	const run = useRef(0);

	function light(lines: readonly string[]) {
		setLit(lines);
		setStep((n) => n + 1);
	}

	function flash(entries: readonly Entry[]) {
		setWritten((was) => {
			const next = { ...was };
			for (const entry of entries) next[entry] = was[entry] + 1;
			return next;
		});
	}

	function start(todo: Todo) {
		if (running) return;
		const token = ++run.current;
		const done = !todo.done;
		const targets = ENTRIES.filter((entry) => holds(cached, entry, todo.id));
		const before = cached;
		setRunning(true);
		setCached(
			targets.reduce(
				(value, entry) => write(value, entry, todo.id, done),
				cached,
			),
		);
		flash(targets);
		light(["optimistic", "body"]);
		setNote(
			`${facts.mutation} is on its way. ${facts.entity} already wrote ${targets.length} ${targets.length === 1 ? "query" : "queries"}.`,
		);

		if (fail) {
			later(TIMES.request, () => {
				light([]);
				setNote(
					`${facts.mutation} failed, so every write is undone, newest first.`,
				);
				[...targets].reverse().forEach((entry, i) =>
					later(i * TIMES.undo, () => {
						setCached((now) =>
							entry === "detail"
								? { ...now, detail: before.detail }
								: { ...now, [entry]: before[entry] },
						);
						flash([entry]);
					}),
				);
				later(targets.length * TIMES.undo + 400, () => setRunning(false));
			});
			return;
		}

		const saved = server.map((each) =>
			each.id === todo.id ? { ...each, done } : each,
		);
		later(TIMES.request, () => {
			setServer(saved);
			light(["set"]);
			setNote(
				`The server’s todo replaces the guess in every copy: Entity.set.`,
			);
			flash(targets);
		});
		later(TIMES.request + TIMES.set, () => {
			light(["invalidates"]);
			setRefetching(true);
			setNote(
				`invalidates: [todos] refetches both lists. ${facts.queries.detail.call} isn’t one of them, so it keeps Entity.set’s copy.`,
			);
		});
		later(TIMES.request + TIMES.set + TIMES.refetch, () => {
			setRefetching(false);
			setCached((now) => ({
				...now,
				list: saved,
				open: saved.filter((each) => !each.done),
			}));
			flash(["list", "open"]);
			setRunning(false);
		});
		later(TIMES.request + TIMES.set + TIMES.refetch + 900, () => {
			// Only if no other run has started since.
			if (run.current === token) light([]);
		});
	}

	const query = (entry: Entry) => facts.queries[entry];
	const rows = (entry: Entry) =>
		entry === "detail" ? [cached.detail] : cached[entry];

	return (
		<section className="band band-feature" aria-labelledby="entities-title">
			<div className="band-head reveal">
				<h2 id="entities-title" className="band-title">
					Change it once. Every copy follows.
				</h2>
				<p className="band-lead">
					An entity says what identifies a todo. The docs’ toggle writes it
					into every cached query that holds it before the request leaves,
					and undoes every write if the request fails.
				</p>
			</div>

			<div className="feature-run reveal">
				<Trace panel={panel} lit={lit} step={step} />

				<div className="feature-panel">
					<div className="entity-queries">
						{ENTRIES.map((entry) => (
							<article
								key={entry}
								className="entity-query"
								data-entry={entry}
								data-waiting={
									(refetching && entry !== "detail") || undefined
								}
							>
								<header>
									<code>{query(entry).call}</code>
									<span>{query(entry).key}</span>
								</header>
								{written[entry] > 0 ? (
									<span
										key={written[entry]}
										className="entity-written"
										aria-hidden
									/>
								) : null}
								<ul>
									{rows(entry).map((todo) => (
										<li key={todo.id}>
											<button
												type="button"
												disabled={running}
												data-done={todo.done || undefined}
												onClick={() => start(todo)}
												aria-label={`${todo.title}: ${todo.done ? "done" : "open"}. Toggle it`}
											>
												<span className="stage-check" aria-hidden>
													{todo.done ? "✓" : "○"}
												</span>
												<span className="stage-todo-title">
													{todo.title}
												</span>
											</button>
										</li>
									))}
									{rows(entry).length === 0 ? (
										<li className="entity-empty">No open todos.</li>
									) : null}
								</ul>
							</article>
						))}
					</div>

					<div className="feature-controls">
						<label className="stage-switch">
							<input
								type="checkbox"
								checked={fail}
								disabled={running}
								onChange={(event) => setFail(event.target.checked)}
							/>
							<span>The request fails</span>
						</label>
					</div>
					<p className="feature-note" aria-live="polite">
						{note}
					</p>
				</div>
			</div>
		</section>
	);
}
