import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Query from "../Query.js";
import { resumePolling, revalidate } from "./mountPolicy.js";
import { isIdle, isPlaceholder, markPlaceholder, wake } from "./queryAtom.js";
import { StateAtom } from "./runtime.js";
import { isShowable, queryFailure, whenShowable } from "./suspense.js";

/**
 * One reader of queries, such as a component's `useQuery` (DESIGN.md §4.2,
 * §5.8). Frameworks create one per reader, call {@link QueryUse.read} as they
 * render, {@link QueryUse.mounted} from the reader's mount effect and
 * {@link QueryUse.showed} after it shows a result, and read through
 * {@link QueryUse.show}, {@link QueryUse.paused} or {@link QueryUse.suspend}.
 */
export interface QueryUse {
	/**
	 * The query to subscribe to as the reader renders: `query`, or `null`
	 * while `paused`, so the reader doesn't count as a use. Notes how many
	 * fetches had started when the reader began reading a query, so
	 * {@link QueryUse.mounted} can tell a fetch the reader's own read started.
	 */
	readonly read: (
		query: Query.Query<any, any> | null,
		paused: boolean,
	) => Query.Query<any, any> | null;
	/**
	 * Runs the mount policy once each time the reader starts reading a query
	 * (`null`: none, or paused), and resumes its polling. A query fetched
	 * since the reader began reading it, by that read, is new to it and isn't
	 * revalidated.
	 */
	readonly mounted: (query: Query.Query<any, any> | null) => void;
	/**
	 * Remembers what the reader showed of a query, for `paused`, and a
	 * success other than a placeholder, for `keepPrevious`. Does nothing
	 * while `paused`; a `null` query forgets what a paused reader would show.
	 */
	readonly showed: (
		query: Query.Query<any, any> | null,
		result: AsyncResult.AsyncResult<any, any>,
		paused: boolean,
	) => void;
	/**
	 * What the reader shows: the result, or with `keepPrevious` its last
	 * success, marked as a placeholder, while the result is `Initial`, unless
	 * its query was cleared since. The copy is waiting, as the query fetches,
	 * except for a `paused` reader, for which nothing fetches. A re-render
	 * gets the same object.
	 */
	readonly show: <A, E>(
		result: AsyncResult.AsyncResult<A, E>,
		keepPrevious: boolean,
		paused: boolean,
	) => AsyncResult.AsyncResult<A, E>;
	/** What a paused reader shows of `query`: see {@link Freezer.show}. */
	readonly paused: <A, E, B>(
		query: Query.Query<A, E>,
		select: ((value: A) => B) | undefined,
	) => AsyncResult.AsyncResult<B, E>;
	/**
	 * The result of `query` with `select` applied to its value (and to a
	 * failure's previous success), or the result itself without `select`. A
	 * selection equal to the last one of the same query (`Equal.equals`)
	 * returns the last object, so a reader subscribed through it doesn't
	 * re-render. A `select` that throws on a value gives a settled failure
	 * with the defect and no previous success, so a suspense reader throws it;
	 * one that throws on a failure's previous success keeps the failure's
	 * cause and drops that success.
	 */
	readonly select: <A, E, B>(
		query: Query.Query<any, any> | null,
		result: AsyncResult.AsyncResult<A, E>,
		select: ((value: A) => B) | undefined,
	) => AsyncResult.AsyncResult<B, E>;
	/**
	 * What a suspense reader shows of `result`, its query's result or a
	 * selection of it: a success, or the success before a failure. Throws a
	 * promise to suspend on, or the `QueryFailure` of a failure with no
	 * success before it.
	 */
	readonly suspend: <A, E>(
		query: Query.Query<any, any>,
		result: AsyncResult.AsyncResult<A, E>,
	) => AsyncResult.Success<A, E>;
}

/**
 * `minStaleTime` raises a query's `staleTime` for the mount policy, as
 * suspense readers do, so the value a reader suspended on isn't fetched again
 * as it mounts.
 */
export const makeQueryUse = (
	registry: AtomRegistry.AtomRegistry,
	minStaleTime: Duration.Duration = Duration.zero,
): QueryUse => {
	const state = () => registry.get(StateAtom);
	let mountedAt = state().fetchCount;
	let current: Query.Query<any, any> | null = null;
	// The fetch count when the reader first rendered each query it hasn't
	// mounted yet: a render React drops doesn't move it.
	const reading = new Map<Query.Query<any, any> | null, number>();
	const freezer = makeFreezer(registry);
	let previous:
		| {
				readonly success: AsyncResult.Success<any, any>;
				readonly query: Query.Query<any, any>;
				readonly clears: number | undefined;
		  }
		| undefined;
	// What `clear` dropped doesn't come back as a previous value.
	const kept = (): AsyncResult.Success<any, any> | undefined =>
		previous !== undefined &&
		state().clears.get(previous.query) === previous.clears
			? previous.success
			: undefined;
	// The last waiting copy made, so a re-render gets the same object.
	let copy:
		| {
				readonly of: AsyncResult.Success<any, any>;
				readonly waiting: AsyncResult.Success<any, any>;
		  }
		| undefined;
	const waiting = <A, E>(
		success: AsyncResult.Success<A, E>,
	): AsyncResult.Success<A, E> => {
		if (copy?.of !== success) {
			copy = {
				of: success,
				waiting: AsyncResult.success(success.value, {
					waiting: true,
					timestamp: success.timestamp,
				}),
			};
		}
		return copy.waiting;
	};
	// The last copy `keepPrevious` showed, so a re-render gets the same object.
	let keptCopy:
		| {
				readonly of: AsyncResult.Success<any, any>;
				readonly waiting: boolean;
				readonly shown: AsyncResult.Success<any, any>;
		  }
		| undefined;
	const borrowed = <A, E>(
		success: AsyncResult.Success<A, E>,
		waiting: boolean,
	): AsyncResult.Success<A, E> => {
		if (keptCopy?.of !== success || keptCopy.waiting !== waiting) {
			keptCopy = {
				of: success,
				waiting,
				shown: markPlaceholder(
					registry,
					AsyncResult.success(success.value, {
						waiting,
						timestamp: success.timestamp,
					}),
				),
			};
		}
		return keptCopy.shown;
	};
	// What `select` last got, before selecting: a paused reader remembers
	// it, so a `select` that changes while paused applies to it.
	let raw:
		| {
				readonly query: Query.Query<any, any> | null;
				readonly result: AsyncResult.AsyncResult<any, any>;
		  }
		| undefined;
	let selected:
		| {
				readonly query: Query.Query<any, any> | null;
				readonly source: AsyncResult.AsyncResult<any, any>;
				readonly select: (value: any) => unknown;
				readonly output: AsyncResult.AsyncResult<any, any>;
		  }
		| undefined;
	return {
		select: <A, E, B>(
			query: Query.Query<any, any> | null,
			result: AsyncResult.AsyncResult<A, E>,
			select: ((value: A) => B) | undefined,
		): AsyncResult.AsyncResult<B, E> => {
			raw = { query, result };
			if (select === undefined) {
				return result as unknown as AsyncResult.AsyncResult<B, E>;
			}
			// An inline `select` is new on every render, so the source and the
			// function only skip the work; equal selections keep the object.
			if (
				selected?.query === query &&
				selected.source === result &&
				selected.select === select
			) {
				return selected.output;
			}
			const last = selected?.query === query ? selected.output : undefined;
			const mapped = selectResult(result, select);
			const placeholder = isPlaceholder(registry, result);
			const output =
				last !== undefined &&
				sameShown(last, mapped) &&
				isPlaceholder(registry, last) === placeholder
					? last
					: mapped;
			// A selection of a placeholder is one too, for `keepPrevious` and
			// `isPlaceholder`.
			if (output === mapped && placeholder) {
				markPlaceholder(registry, output);
			}
			selected = { query, source: result, select, output };
			return output;
		},
		read: (query, paused) => {
			const source = paused ? null : query;
			if (source !== current && !reading.has(source)) {
				reading.set(source, state().fetchCount);
			}
			return source;
		},
		mounted: (query) => {
			if (query !== null) {
				resumePolling(registry, query);
				const fetchedAt = state().fetchedAt.get(query) ?? 0;
				const since = reading.get(query) ?? mountedAt;
				if (
					query !== current &&
					(isIdle(registry, query) || fetchedAt <= since)
				) {
					revalidate(registry, query, minStaleTime);
				}
			}
			current = query;
			mountedAt = state().fetchCount;
			reading.clear();
		},
		showed: (query, result, paused) => {
			if (paused) {
				return;
			}
			freezer.forget();
			if (query === null) {
				return;
			}
			freezer.remember(query, raw?.query === query ? raw.result : result);
			if (
				AsyncResult.isSuccess(result) &&
				!isPlaceholder(registry, result)
			) {
				previous = {
					success: result,
					query,
					clears: state().clears.get(query),
				};
			}
		},
		paused: (query, select) => freezer.show(query, select),
		show: (result, keepPrevious, paused) => {
			const success =
				keepPrevious && AsyncResult.isInitial(result) ? kept() : undefined;
			return success === undefined ? result : borrowed(success, !paused);
		},
		suspend: (query, result) => {
			// A reader new to a query `clear` left idle fetches it; one already
			// showing it waits, as a `useQuery` reader shows `Initial`. The wake
			// waits for the render to end: it notifies the query's other readers.
			if (query !== current && isIdle(registry, query)) {
				const client = state();
				queueMicrotask(() => {
					if (!client.disposed && isIdle(registry, query)) {
						wake(registry, query);
					}
				});
			}
			if (!isShowable(result)) {
				throw whenShowable(registry, query);
			}
			if (AsyncResult.isSuccess(result)) {
				return result;
			}
			if (Option.isNone(result.previousSuccess)) {
				throw queryFailure(query, result.cause);
			}
			const success = result.previousSuccess.value;
			return result.waiting ? waiting(success) : success;
		},
	};
};

const notFetching = AsyncResult.initial<never, never>();

/**
 * What paused readers show (DESIGN.md §4.12): what they last showed of each
 * query, or what a server render would show of it. Nothing fetches for a
 * paused reader, so neither is shown waiting.
 */
export interface Freezer {
	/** Remembers what the reader showed of `query`, before any `select`. */
	readonly remember: (
		query: Query.Query<any, any>,
		result: AsyncResult.AsyncResult<any, any>,
	) => void;
	/** Forgets every query's remembered result. */
	readonly forget: () => void;
	/**
	 * What a paused reader shows of `query`, with `select` applied: what it
	 * remembered of it, unless `clear` dropped the query since, or else the
	 * query's server value (the cache, without fetching). A re-render gets
	 * the same object while what it shows is the same.
	 */
	readonly show: <A, E, B>(
		query: Query.Query<A, E>,
		select?: ((value: A) => B) | undefined,
	) => AsyncResult.AsyncResult<B, E>;
}

export const makeFreezer = (registry: AtomRegistry.AtomRegistry): Freezer => {
	const clearsOf = (query: Query.Query<any, any>) =>
		registry.get(StateAtom).clears.get(query);
	const remembered = new Map<
		Query.Query<any, any>,
		{
			readonly result: AsyncResult.AsyncResult<any, any>;
			readonly clears: number | undefined;
		}
	>();
	const cached = new Map<
		Query.Query<any, any>,
		{
			readonly source: AsyncResult.AsyncResult<any, any>;
			readonly select: ((value: any) => unknown) | undefined;
			readonly output: AsyncResult.AsyncResult<any, any>;
		}
	>();
	const settledCopies = new WeakMap<
		AsyncResult.AsyncResult<any, any>,
		AsyncResult.AsyncResult<any, any>
	>();
	const settle = <A, E>(
		result: AsyncResult.AsyncResult<A, E>,
	): AsyncResult.AsyncResult<A, E> => {
		if (!result.waiting) {
			return result;
		}
		let copy = settledCopies.get(result);
		if (copy === undefined) {
			copy = settled(result);
			settledCopies.set(result, copy);
			if (isPlaceholder(registry, result)) {
				markPlaceholder(registry, copy);
			}
		}
		return copy as AsyncResult.AsyncResult<A, E>;
	};
	return {
		remember: (query, result) => {
			remembered.set(query, { result, clears: clearsOf(query) });
		},
		forget: () => {
			remembered.clear();
		},
		show: <A, E, B>(
			query: Query.Query<A, E>,
			select?: ((value: A) => B) | undefined,
		): AsyncResult.AsyncResult<B, E> => {
			const kept = remembered.get(query);
			const source = settle(
				kept !== undefined && kept.clears === clearsOf(query)
					? kept.result
					: Atom.getServerValue(query, registry),
			);
			const last = cached.get(query);
			const sameSource =
				last !== undefined && sameShown(last.source, source);
			if (sameSource && last.select === select) {
				return last.output as AsyncResult.AsyncResult<B, E>;
			}
			const mapped =
				select === undefined ? source : selectResult(source, select);
			// An inline `select` is new on every render: an equal selection
			// keeps the object.
			const output =
				sameSource && sameShown(last.output, mapped) ? last.output : mapped;
			// A selection of a placeholder is one too, as `select` marks it.
			if (
				output === mapped &&
				mapped !== source &&
				isPlaceholder(registry, source)
			) {
				markPlaceholder(registry, mapped);
			}
			cached.set(query, { source, select, output });
			return output as AsyncResult.AsyncResult<B, E>;
		},
	};
};

/** The same result, not waiting. */
const settled = <A, E>(
	result: AsyncResult.AsyncResult<A, E>,
): AsyncResult.AsyncResult<A, E> => {
	switch (result._tag) {
		case "Initial":
			return notFetching;
		case "Success":
			return AsyncResult.success(result.value, {
				timestamp: result.timestamp,
			});
		case "Failure":
			return AsyncResult.failure(result.cause, {
				previousSuccess: result.previousSuccess,
			});
	}
};

const selectResult = <A, E, B>(
	result: AsyncResult.AsyncResult<A, E>,
	select: (value: A) => B,
): AsyncResult.AsyncResult<B, E> => {
	try {
		return AsyncResult.map(result, select);
	} catch (defect) {
		// A failure's own cause says more than a defect selecting what it
		// had; a value that can't be selected shows nothing older instead.
		return AsyncResult.isFailure(result)
			? AsyncResult.failure(result.cause, { waiting: result.waiting })
			: AsyncResult.failure(Cause.die(defect));
	}
};

const sameSuccess = Option.makeEquivalence(
	(
		x: AsyncResult.Success<unknown, unknown>,
		y: AsyncResult.Success<unknown, unknown>,
	) => Equal.equals(x.value, y.value),
);

/** Whether two selected results show the same thing, timestamps aside. */
const sameShown = (
	a: AsyncResult.AsyncResult<unknown, unknown>,
	b: AsyncResult.AsyncResult<unknown, unknown>,
): boolean => {
	if (a._tag !== b._tag || a.waiting !== b.waiting) {
		return false;
	}
	if (a._tag === "Success") {
		return Equal.equals(
			a.value,
			(b as AsyncResult.Success<unknown, unknown>).value,
		);
	}
	if (a._tag === "Failure") {
		const other = b as AsyncResult.Failure<unknown, unknown>;
		return (
			Equal.equals(a.cause, other.cause) &&
			sameSuccess(a.previousSuccess, other.previousSuccess)
		);
	}
	return true;
};
