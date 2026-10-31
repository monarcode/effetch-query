import * as Equal from "effect/Equal";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { Query, QueryKey, QueryTarget } from "../Query.js";
import { isQuery } from "./queryAtom.js";
import { StateAtom } from "./runtime.js";

/** Whether `key` starts with `prefix`, comparing segments with `Equal.equals`. */
export const startsWith = (key: QueryKey, prefix: QueryKey): boolean =>
	prefix.length <= key.length &&
	prefix.every((segment, index) => Equal.equals(segment, key[index]));

const isQueryKey = (target: QueryTarget): target is QueryKey =>
	Array.isArray(target);

/**
 * Which keys a target matches: a key or a family matches its own key and
 * every longer one, a query only its own.
 */
export const matcher = (target: QueryTarget): ((key: QueryKey) => boolean) => {
	if (isQuery(target)) {
		const own = target.key;
		return (key) => key.length === own.length && startsWith(key, own);
	}
	const prefix = isQueryKey(target) ? target : target.key;
	return (key) => startsWith(key, prefix);
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
	return Array.from(registry.get(StateAtom).index).filter((query) =>
		matches(query.key),
	);
};
