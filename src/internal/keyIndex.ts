import * as Equal from "effect/Equal";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type {
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
 * its own key or a longer one, a query those with its exact key, and a
 * family with a {@link KeyMatcher} its own members.
 */
export const matcher = (
	target: QueryTarget,
): ((query: Query<any, any>) => boolean) => {
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
