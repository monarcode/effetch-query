import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";

import type * as Query from "../Query.js";
import type { ClientState } from "./runtime.js";

/**
 * How new each copy of a synced entity in a query is, for entity sync
 * (DESIGN.md §4.15), on the client's `clock`. A fetch attempt takes a whole
 * number when it starts; a write takes the half after the latest attempt
 * (`now`). `base` dates the query's value, and `copies` the copies that
 * came from elsewhere, per entity and id: synced in, written, or carried
 * over from an older value.
 */
export interface Ages {
	readonly base: number;
	readonly copies: Map<object, MutableHashMap.MutableHashMap<unknown, number>>;
}

/** No record, or a value from the server: older than any fetch. */
export const oldest = -1;

/** Dates a fetch attempt as it starts. */
export const tick = (state: ClientState): number => ++state.clock;

/**
 * A write's age: after every fetch attempt started so far and before the
 * next one, so a fetch already in flight doesn't sync over it.
 */
export const now = (state: ClientState): number => state.clock + 0.5;

/** Whether an age is a fetch's: only fetched copies are synced to other queries. */
export const isFetched = (age: number): boolean => Number.isInteger(age);

export const ageOf = (
	state: ClientState,
	query: Query.Query<any, any>,
	entity: object,
	id: unknown,
): number => {
	const ages = state.ages.get(query);
	if (ages === undefined) {
		return oldest;
	}
	const copies = ages.copies.get(entity);
	return copies === undefined
		? ages.base
		: Option.getOrElse(MutableHashMap.get(copies, id), () => ages.base);
};

/** Dates a query's whole value, forgetting its copies' own ages. */
export const stampQuery = (
	state: ClientState,
	query: Query.Query<any, any>,
	age: number,
): void => {
	state.ages.set(query, { base: age, copies: new Map() });
};

/**
 * Dates copies of a query's value. Returns how to put their ages back, for
 * a write's undo: only while the query keeps these ages, and for each copy
 * nothing has dated since.
 */
export const stampCopies = (
	state: ClientState,
	query: Query.Query<any, any>,
	copies: ReadonlyArray<readonly [entity: object, id: unknown]>,
	age: number,
): (() => void) => {
	let ages = state.ages.get(query);
	if (ages === undefined) {
		ages = { base: oldest, copies: new Map() };
		state.ages.set(query, ages);
	}
	const stamped = ages;
	const previous = copies.map(([entity, id]) => {
		let byId = stamped.copies.get(entity);
		if (byId === undefined) {
			byId = MutableHashMap.empty();
			stamped.copies.set(entity, byId);
		}
		const before = MutableHashMap.get(byId, id);
		MutableHashMap.set(byId, id, age);
		return { byId, id, before };
	});
	return () => {
		if (state.ages.get(query) !== stamped) {
			return;
		}
		for (const { byId, id, before } of previous) {
			if (Option.getOrUndefined(MutableHashMap.get(byId, id)) !== age) {
				continue;
			}
			if (Option.isSome(before)) {
				MutableHashMap.set(byId, id, before.value);
			} else {
				MutableHashMap.remove(byId, id);
			}
		}
	};
};
