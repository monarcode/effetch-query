import * as Equal from "effect/Equal";
import * as Predicate from "effect/Predicate";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type {
	Group,
	Query,
	Key as QueryKey,
	Target as QueryTarget,
} from "../Query.js";
import { isQuery } from "./queryAtom.js";
import { StateAtom } from "./runtime.js";

/** Whether `key` starts with `prefix`, comparing segments with `Equal.equals`. */
export const startsWith = (key: QueryKey, prefix: QueryKey): boolean =>
	prefix.length <= key.length &&
	prefix.every((segment, index) => Equal.equals(segment, key[index]));

const isQueryKey = (target: QueryTarget): target is QueryKey =>
	Array.isArray(target);

export const GroupTypeId = "~@monarcode/effetch-query/Group" as const;
export type GroupTypeId = typeof GroupTypeId;

export const isGroup = (target: QueryTarget): target is Group =>
	Predicate.hasProperty(target, GroupTypeId);

/** A group of `targets`, with nested groups replaced by their targets. */
export const makeGroup = (targets: ReadonlyArray<QueryTarget>): Group => {
	const flat = new Set<QueryTarget>();
	for (const target of targets) {
		for (const member of isGroup(target) ? target.targets : [target]) {
			flat.add(member);
		}
	}
	return { [GroupTypeId]: GroupTypeId, targets: Array.from(flat) };
};

/**
 * Marks a family that says itself which queries are its members, such as an
 * effetch endpoint's: its keys (`["todos", 1]` for `GET /todos/:id`) don't
 * tell its members from another route's under the same path.
 */
export const KeyMatcherId = "~@monarcode/effetch-query/KeyMatcher";

export interface KeyMatcher {
	readonly [KeyMatcherId]: (query: Query<any, any>) => boolean;
}

const hasKeyMatcher = (
	target: QueryTarget,
): target is QueryTarget & KeyMatcher => KeyMatcherId in target;

/**
 * Which queries a target matches: a key or a family matches the queries with
 * its own key or a longer one, a query those with its exact key, a family
 * with a {@link KeyMatcher} its own members, and a group those any of its
 * targets matches.
 */
export const matcher = (
	target: QueryTarget,
): ((query: Query<any, any>) => boolean) => {
	if (isGroup(target)) {
		const members = target.targets.map(matcher);
		return (query) => members.some((matches) => matches(query));
	}
	if (isQuery(target)) {
		const own = target.key;
		return ({ key }) => key.length === own.length && startsWith(key, own);
	}
	if (hasKeyMatcher(target)) {
		return target[KeyMatcherId];
	}
	const prefix = isQueryKey(target) ? target : target.key;
	return ({ key }) => startsWith(key, prefix);
};

/**
 * The queries with a node in the registry, used or idle, whose keys the
 * target matches. That includes stale nodes, which still hold a value.
 */
export const matching = (
	registry: AtomRegistry.AtomRegistry,
	target: QueryTarget,
): Array<Query<any, any>> => {
	const matches = matcher(target);
	return Array.from(registry.get(StateAtom).index).filter(matches);
};
