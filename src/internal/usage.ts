import type * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

/**
 * Whether something uses an atom: a listener on it, or on anything that
 * depends on it, as the registry decides which nodes to keep up to date.
 */
export const isInUse = (
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<any>,
): boolean => {
	const node = registry.getNodes().get(atom);
	if (node === undefined) {
		return false;
	}
	// Dependents can share dependents, so each node is visited once.
	const seen = new Set<AtomRegistry.Node<unknown>>([node]);
	const pending: Array<AtomRegistry.Node<unknown>> = [node];
	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		if (!next.atom.lazy || next.listeners.size > 0) {
			return true;
		}
		for (const child of next.children) {
			if (!seen.has(child)) {
				seen.add(child);
				pending.push(child);
			}
		}
	}
	return false;
};
