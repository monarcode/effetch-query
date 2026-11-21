import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type * as Query from "../Query.js";
import {
	ageOf,
	isFetched,
	now,
	oldest,
	stampCopies,
	stampQuery,
} from "./ages.js";
import {
	applyPlan,
	type EntityDefinition,
	holding,
	type Plan,
	planIn,
} from "./entity.js";
import { dropSyncs, recordPush } from "./live.js";
import {
	cachedQuery,
	internals,
	isCurrent,
	lastSuccess,
	localValue,
	peek,
	syncsEntities,
	writeKeepingAge,
} from "./queryAtom.js";
import {
	type ClientState,
	ConfigAtom,
	type StampWritten,
	StateAtom,
	type SyncFetched,
} from "./runtime.js";

interface Copy {
	readonly copy: object;
	readonly age: number;
	/** Read by this fetch: only those go to other queries. */
	readonly fresh: boolean;
}

type Holding = ReturnType<typeof holding>[number];

/** One synced entity in the fetched query, with the other queries that hold it. */
interface Pass {
	readonly entity: EntityDefinition<any, any>;
	readonly plan: Plan;
	readonly others: ReadonlyArray<Holding>;
	/** Each id's copy and age in the fetched value, once newer copies are pulled in. */
	readonly mine: MutableHashMap.MutableHashMap<unknown, Copy>;
	readonly pulled: MutableHashMap.MutableHashMap<unknown, Copy>;
}

/** A sync's write over another query, made once every write is computed. */
interface Write {
	readonly entity: EntityDefinition<any, any>;
	readonly query: Query.Query<any, any>;
	/**
	 * Puts the newer copies into a value: the query's when it's written, so
	 * two entities' writes to one query both stay, and the one an undo puts
	 * back (`live.ts`). `undefined` when every copy was already equal.
	 */
	readonly apply: ((value: unknown) => unknown) | undefined;
	/** The ages of the copies it dates, written or equal. */
	readonly ages: ReadonlyArray<readonly [unknown, number]>;
}

/** Calls `f` with each copy a plan reaches in a value, without changing it. */
const eachCopy = (
	plan: Plan,
	value: unknown,
	f: (copy: object) => void,
): void => {
	applyPlan(plan, value, (copy) => {
		f(copy);
		return copy;
	});
};

/** Keeps the newer of two copies of an id. */
const keepNewer = (
	copies: MutableHashMap.MutableHashMap<unknown, Copy>,
	id: unknown,
	copy: Copy,
): void => {
	const known = MutableHashMap.get(copies, id);
	if (Option.isNone(known) || known.value.age < copy.age) {
		MutableHashMap.set(copies, id, copy);
	}
};

/**
 * The queries the fetch read through `ctx.result`, and theirs: a sync
 * doesn't write them, or the fetch would start again.
 */
const dependencies = (
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<unknown>,
): ReadonlySet<Query.Query<any, any>> => {
	const found = new Set<Query.Query<any, any>>();
	const seen = new Set<unknown>();
	const pending = [...(registry.getNodes().get(atom)?.parents ?? [])];
	for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
		if (seen.has(node)) {
			continue;
		}
		seen.add(node);
		const query = cachedQuery(node.atom);
		if (query !== undefined) {
			found.add(query);
		}
		pending.push(...node.parents);
	}
	return found;
};

/**
 * When each object in what a fetch's attempts read was read: an infinite
 * query's refetch reads its pages one after the other, and a retried page
 * later still. `undefined` for an object no attempt read.
 */
const readDates = (
	reads: ReadonlyArray<{ readonly result: unknown; readonly start: number }>,
): ((copy: object) => number | undefined) => {
	let dates: WeakMap<object, number> | undefined;
	return (copy) => {
		if (dates === undefined) {
			dates = new WeakMap();
			for (const { result, start } of reads) {
				const pending: Array<unknown> = [result];
				while (pending.length > 0) {
					const next = pending.pop();
					if (Predicate.isObjectOrArray(next) && !dates.has(next)) {
						dates.set(next, start);
						// One by one: a spread of a large array exceeds the
						// engine's argument limit. A typed array holds no copies.
						if (!ArrayBuffer.isView(next)) {
							for (const field of Object.values(next)) {
								pending.push(field);
							}
						}
					}
				}
			}
		}
		return dates.get(copy);
	};
};

/**
 * Dates each copy of the entity in the fetched value and pulls newer
 * copies into it. A copy is dated by `dateOf`, unless it isn't new: one
 * the query already showed (an infinite query's older pages) keeps its
 * age, and one another query holds (read through `ctx.result`) takes that
 * query's. Only fetched copies are pulled: from other queries, and the
 * query's own, synced in while it fetched.
 */
const pull = <A>(
	registry: AtomRegistry.AtomRegistry,
	state: ClientState,
	query: Query.Query<A, any>,
	entity: EntityDefinition<any, any>,
	plan: Plan,
	value: A,
	dateOf: (copy: object) => Omit<Copy, "copy">,
): { readonly value: A; readonly pass: Pass } => {
	const shown = Option.flatMap(peek(registry, query), lastSuccess);
	const carried = new Set<object>();
	const newest = MutableHashMap.empty<unknown, Copy>();
	Option.map(shown, (success) =>
		eachCopy(plan, success.value, (copy) => {
			carried.add(copy);
			const id = entity.id(copy);
			const age = ageOf(state, query, entity, id);
			if (isFetched(age)) {
				keepNewer(newest, id, { copy, age, fresh: false });
			}
		}),
	);
	const mine = MutableHashMap.empty<unknown, Copy>();
	eachCopy(plan, value, (copy) => {
		const id = entity.id(copy);
		keepNewer(
			mine,
			id,
			carried.has(copy)
				? { copy, age: ageOf(state, query, entity, id), fresh: false }
				: { copy, ...dateOf(copy) },
		);
	});
	const others = holding(registry, entity).filter(
		(other) =>
			other.query !== query &&
			!other.failed &&
			syncsEntities(registry, other.query) &&
			isCurrent(registry, other.query),
	);
	const borrowed = MutableHashMap.empty<unknown, number>();
	for (const other of others) {
		eachCopy(other.plan, other.value, (copy) => {
			const id = entity.id(copy);
			const own = MutableHashMap.get(mine, id);
			if (Option.isNone(own)) {
				return;
			}
			const age = ageOf(state, other.query, entity, id);
			if (own.value.copy === copy && !carried.has(copy)) {
				MutableHashMap.set(borrowed, id, age);
			}
			if (isFetched(age)) {
				keepNewer(newest, id, { copy, age, fresh: false });
			}
		});
	}
	for (const [id, age] of borrowed) {
		const own = Option.getOrThrow(MutableHashMap.get(mine, id));
		MutableHashMap.set(mine, id, { copy: own.copy, age, fresh: false });
	}
	const pulled = MutableHashMap.empty<unknown, Copy>();
	for (const [id, other] of newest) {
		const own = MutableHashMap.get(mine, id);
		if (Option.isSome(own) && other.age > own.value.age) {
			MutableHashMap.set(pulled, id, other);
			MutableHashMap.set(mine, id, other);
		}
	}
	const next =
		MutableHashMap.size(pulled) === 0
			? value
			: (applyPlan(plan, value, (copy) =>
					Option.match(MutableHashMap.get(pulled, entity.id(copy)), {
						onNone: () => copy,
						onSome: ({ copy: newer }) =>
							Equal.equals(copy, newer) ? copy : newer,
					}),
				) as A);
	return { value: next, pass: { entity, plan, others, mine, pulled } };
};

/**
 * The writes of the fetched copies over older copies in other queries,
 * from the value with every entity's newer copies pulled in. Only the
 * copies this fetch read go, not carried, borrowed or pulled ones, and a
 * query the fetch depends on isn't written.
 */
const push = (
	state: ClientState,
	pass: Pass,
	value: unknown,
	skip: ReadonlySet<Query.Query<any, any>>,
): ReadonlyArray<Write> => {
	const { entity, plan, others, mine, pulled } = pass;
	// A copy another entity's pull rebuilt (an outer copy with a newer
	// inner one) is written as rebuilt.
	const kept = new Set<object>();
	const latest = MutableHashMap.empty<unknown, object>();
	eachCopy(plan, value, (copy) => {
		kept.add(copy);
		MutableHashMap.set(latest, entity.id(copy), copy);
	});
	return others.flatMap((other): ReadonlyArray<Write> => {
		if (skip.has(other.query)) {
			return [];
		}
		const ages: Array<readonly [unknown, number]> = [];
		const changed = MutableHashMap.empty<unknown, object>();
		eachCopy(other.plan, other.value, (copy) => {
			const id = entity.id(copy);
			const own = MutableHashMap.get(mine, id);
			if (
				Option.isNone(own) ||
				!own.value.fresh ||
				MutableHashMap.has(pulled, id) ||
				own.value.age <= ageOf(state, other.query, entity, id)
			) {
				return;
			}
			const newer = kept.has(own.value.copy)
				? own.value.copy
				: Option.getOrElse(
						MutableHashMap.get(latest, id),
						() => own.value.copy,
					);
			ages.push([id, own.value.age]);
			if (!Equal.equals(copy, newer)) {
				MutableHashMap.set(changed, id, newer);
			}
		});
		if (ages.length === 0) {
			return [];
		}
		return [
			{
				entity,
				query: other.query,
				apply:
					MutableHashMap.size(changed) === 0
						? undefined
						: (current) =>
								applyPlan(other.plan, current, (copy) =>
									Option.getOrElse(
										MutableHashMap.get(changed, entity.id(copy)),
										() => copy,
									),
								),
				ages,
			},
		];
	});
};

/**
 * Entity sync after a successful fetch (DESIGN.md §4.15), for the client's
 * `entities.sync`. Every write is computed before any is made, so an `id`
 * that throws writes nothing. A throw is logged, and the fetch keeps its
 * value. A fetch of a generation the query has left (a `reset` or `clear`
 * since) syncs nothing: its value isn't shown.
 */
export const syncFetched: SyncFetched = (registry, query, value, fetch) =>
	Effect.suspend(() => {
		if (
			!syncsEntities(registry, query) ||
			localValue(registry, query).generation !== fetch.generation
		) {
			return Effect.succeed(value);
		}
		const state = registry.get(StateAtom);
		// A value the server sent, read by no attempt, is older than any fetch.
		const base =
			fetch.reads.length === 0
				? oldest
				: Math.min(...fetch.reads.map(({ start }) => start));
		const readAt = readDates(fetch.reads);
		// A copy no attempt read was changed while the fetch ran, by a `live`
		// push `withPushes` replayed: a write, dated as one.
		const dateOf = (copy: object): Omit<Copy, "copy"> => {
			const read = fetch.reads.length === 0 ? undefined : readAt(copy);
			return read !== undefined
				? { age: read, fresh: true }
				: {
						age: fetch.reads.length === 0 ? oldest : now(state),
						fresh: false,
					};
		};
		let synced = value;
		const passes: Array<Pass> = [];
		const writes: Array<Write> = [];
		try {
			for (const entity of registry.get(ConfigAtom).entities) {
				const plan = planIn(entity, query);
				if (plan !== undefined) {
					const pulled = pull(
						registry,
						state,
						query,
						entity,
						plan,
						synced,
						dateOf,
					);
					synced = pulled.value;
					passes.push(pulled.pass);
				}
			}
			const skip = dependencies(
				registry,
				internals(query).fetchAtom(fetch.generation),
			);
			for (const pass of passes) {
				writes.push(...push(state, pass, synced, skip));
			}
		} catch (cause) {
			// A fetch that read nothing (an infinite query with no page to
			// add) returns what the query showed, which keeps its ages.
			if (fetch.reads.length > 0) {
				stampQuery(state, query, base);
			}
			return Effect.as(Effect.logError("Entity sync failed", cause), value);
		}
		stampQuery(state, query, base);
		for (const { entity, mine } of passes) {
			for (const [id, { age }] of mine) {
				if (age !== base) {
					stampCopies(state, query, [[entity, id]], age);
				}
			}
		}
		// The fetched value is dated after them, so an undo mustn't apply them.
		dropSyncs(state, query);
		// Each write is made whatever another throws: a listener, or an `id`
		// over a value a listener changed.
		const failures: Array<unknown> = [];
		for (const { entity, query: other, apply, ages } of writes) {
			try {
				for (const [id, age] of ages) {
					stampCopies(state, other, [[entity, id]], age);
				}
				const current = Option.flatMap(peek(registry, other), lastSuccess);
				if (apply === undefined || Option.isNone(current)) {
					continue;
				}
				const next = apply(current.value.value);
				if (next === current.value.value) {
					continue;
				}
				// Recorded first: the registry stores the value before a
				// listener can throw.
				recordPush(state, other, apply, true);
				writeKeepingAge(registry, other, next, current.value.timestamp);
			} catch (cause) {
				failures.push(cause);
			}
		}
		return failures.length === 0
			? Effect.succeed(synced)
			: Effect.as(
					Effect.logError("Entity sync failed", ...failures),
					synced,
				);
	});

/**
 * Dates as new the synced entities' copies a write put in a query: those
 * that aren't the same objects it showed before (DESIGN.md §4.15). A copy
 * whose `id` throws isn't dated: the write stands, as without sync, and the
 * next fetch that syncs the query logs the throw.
 */
export const stampWritten: StampWritten = (registry, query, before, after) => {
	if (!syncsEntities(registry, query)) {
		return () => {};
	}
	const state = registry.get(StateAtom);
	const written: Array<readonly [object, unknown]> = [];
	try {
		for (const entity of registry.get(ConfigAtom).entities) {
			const plan = planIn(entity, query);
			if (plan === undefined) {
				continue;
			}
			const old = new Set<object>();
			Option.map(before, (value) =>
				eachCopy(plan, value, (copy) => old.add(copy)),
			);
			eachCopy(plan, after, (copy) => {
				if (old.has(copy)) {
					return;
				}
				try {
					written.push([entity, entity.id(copy)]);
				} catch {
					// Left undated.
				}
			});
		}
	} catch {
		// The write has been made: date what was found.
	}
	return written.length === 0
		? () => {}
		: stampCopies(state, query, written, now(state));
};
