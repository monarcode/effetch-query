import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Query from "../Query.js";
import { resumePolling, revalidate } from "./mountPolicy.js";
import { isIdle } from "./queryAtom.js";
import { makeFreezer } from "./queryUse.js";
import { RegistryAtom, StateAtom } from "./runtime.js";

type AnyQuery = Query.Query<any, any>;
type Results = ReadonlyArray<AsyncResult.AsyncResult<any, any>>;

/**
 * One reader of a list of queries, such as a component's `useQueries`
 * (DESIGN.md §4.12). It works as {@link QueryUse} does for one: frameworks
 * call {@link QueriesUse.read} as they render, {@link QueriesUse.mounted}
 * from the reader's mount effect and {@link QueriesUse.showed} after it
 * shows the results.
 */
export interface QueriesUse {
	/**
	 * The atom to subscribe to: every query's result, in order, `Initial` for
	 * `null`. It's the same atom while the queries are the same ones, in the
	 * same order, and an atom of nothing while `paused`, so the reader
	 * doesn't count as a use of any of them. Notes how many fetches had
	 * started when each query joined the list.
	 */
	readonly read: (
		queries: ReadonlyArray<AnyQuery | null>,
		paused: boolean,
	) => Atom.Atom<Results>;
	/**
	 * Keeps the last array when every result in it is the same object, as a
	 * rebuild that changed nothing, or a server snapshot read again, gives.
	 */
	readonly stable: (results: Results) => Results;
	/**
	 * Runs the mount policy for each query that joined the list since the
	 * last call (`null`: none, or paused), and resumes every query's polling.
	 */
	readonly mounted: (queries: ReadonlyArray<AnyQuery | null> | null) => void;
	/** Remembers what the reader showed of each query, for `paused`. */
	readonly showed: (
		queries: ReadonlyArray<AnyQuery | null>,
		results: Results,
	) => void;
	/**
	 * What a paused reader shows of each query, as `Freezer.show` decides:
	 * what it last showed of it, or what a server render would show.
	 */
	readonly paused: (queries: ReadonlyArray<AnyQuery | null>) => Results;
}

const none = AsyncResult.initial<never, never>();
const nothing = Atom.readable((): Results => []);

const sameQueries = (
	a: ReadonlyArray<AnyQuery | null>,
	b: ReadonlyArray<AnyQuery | null>,
): boolean =>
	a.length === b.length && a.every((query, index) => query === b[index]);

const resultsAtom = (
	queries: ReadonlyArray<AnyQuery | null>,
): Atom.Atom<Results> =>
	Object.assign(
		Atom.readable((get): Results =>
			queries.map((query) => (query === null ? none : get(query))),
		),
		{
			// As a query's own server value: the cache, never a fetch.
			[Atom.ServerValueTypeId]: (get: <X>(atom: Atom.Atom<X>) => X) => {
				const registry = get(RegistryAtom);
				return queries.map((query) =>
					query === null ? none : Atom.getServerValue(query, registry),
				);
			},
		},
	);

interface ResultsEntry {
	readonly queries: ReadonlyArray<AnyQuery | null>;
	readonly atom: Atom.Atom<Results>;
}

export const makeQueriesUse = (
	registry: AtomRegistry.AtomRegistry,
): QueriesUse => {
	const state = () => registry.get(StateAtom);
	// The committed list's atom and the latest rendered one, so renders
	// React drops don't replace the atom the committed list subscribes to.
	let committed: ResultsEntry | undefined;
	let rendered: ResultsEntry | undefined;
	// The fetch count when each query not yet mounted was first rendered.
	const joined = new Map<AnyQuery, number>();
	let current = new Set<AnyQuery>();
	const entryFor = (
		queries: ReadonlyArray<AnyQuery | null>,
	): ResultsEntry | undefined =>
		[committed, rendered].find(
			(entry) => entry !== undefined && sameQueries(entry.queries, queries),
		);
	let mountedAt = state().fetchCount;
	const freezer = makeFreezer(registry);
	const keep = () => {
		let last: Results | undefined;
		return (results: Results): Results => {
			if (
				last === undefined ||
				last.length !== results.length ||
				last.some((result, index) => result !== results[index])
			) {
				last = results;
			}
			return last;
		};
	};
	const stable = keep();
	const stablePaused = keep();
	return {
		read: (queries, paused) => {
			if (paused) {
				return nothing;
			}
			const at = state().fetchCount;
			for (const query of queries) {
				if (query !== null && !current.has(query) && !joined.has(query)) {
					joined.set(query, at);
				}
			}
			const found = entryFor(queries);
			if (found !== undefined) {
				return found.atom;
			}
			rendered = { queries, atom: resultsAtom(queries) };
			return rendered.atom;
		},
		stable,
		mounted: (queries) => {
			const next = new Set<AnyQuery>();
			for (const query of queries ?? []) {
				if (query === null || next.has(query)) {
					continue;
				}
				next.add(query);
				resumePolling(registry, query);
				const fetchedAt = state().fetchedAt.get(query) ?? 0;
				const since = joined.get(query) ?? mountedAt;
				if (
					!current.has(query) &&
					(isIdle(registry, query) || fetchedAt <= since)
				) {
					revalidate(registry, query);
				}
			}
			current = next;
			mountedAt = state().fetchCount;
			joined.clear();
			if (queries !== null) {
				committed = entryFor(queries);
				rendered = undefined;
			}
		},
		showed: (queries, results) => {
			freezer.forget();
			queries.forEach((query, index) => {
				const result = results[index];
				if (query !== null && result !== undefined) {
					freezer.remember(query, result);
				}
			});
		},
		paused: (queries) =>
			stablePaused(
				queries.map((query) =>
					query === null ? none : freezer.show(query),
				),
			),
	};
};
