import type * as Query from "../Query.js";
import type { ClientState } from "./runtime.js";

type Update = (value: any) => any;

/**
 * A live query's pushes (DESIGN.md §4.14), kept while something may apply
 * them again: a fetch that started before them, whose result may not hold
 * them, or an optimistic write whose undo would drop them. Each of those
 * holds a {@link Mark}; with none open, nothing is kept.
 */
export interface PushLog {
	seq: number;
	entries: Array<{ readonly seq: number; readonly f: Update }>;
	readonly marks: Set<Mark>;
}

/** A point in a query's pushes, to apply the ones after it again. */
export interface Mark {
	readonly since: number;
	/** Applies the pushes after the mark to `value`, skipping any that throws. */
	readonly replay: <A>(value: A) => A;
	/** Whether a push came after the mark. */
	readonly pushed: () => boolean;
	/** Stops keeping pushes for this mark. Safe to call twice. */
	readonly close: () => void;
}

const logOf = (state: ClientState, query: Query.Query<any, any>): PushLog => {
	let log = state.pushes.get(query);
	if (log === undefined) {
		log = { seq: 0, entries: [], marks: new Set() };
		state.pushes.set(query, log);
	}
	return log;
};

/** Opens a {@link Mark} at the query's latest push. */
export const openMark = (
	state: ClientState,
	query: Query.Query<any, any>,
): Mark => {
	const log = logOf(state, query);
	const since = log.seq;
	const after = () => log.entries.filter((entry) => entry.seq > since);
	const mark: Mark = {
		since,
		replay: (value) =>
			after().reduce((current, { f }) => {
				try {
					return f(current);
				} catch {
					return current;
				}
			}, value),
		pushed: () => log.seq > since,
		close: () => {
			if (!log.marks.delete(mark)) {
				return;
			}
			let oldest = Infinity;
			for (const open of log.marks) {
				oldest = Math.min(oldest, open.since);
			}
			log.entries = log.entries.filter((entry) => entry.seq > oldest);
		},
	};
	log.marks.add(mark);
	return mark;
};

/** Records a push, kept only while a mark is open. */
export const recordPush = (
	state: ClientState,
	query: Query.Query<any, any>,
	f: Update,
): void => {
	const log = logOf(state, query);
	log.seq++;
	if (log.marks.size > 0) {
		log.entries.push({ seq: log.seq, f });
	}
};
