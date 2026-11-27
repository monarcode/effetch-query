import { useCallback, useEffect, useRef } from "react";

/** `setTimeout` for a component: what's pending is cleared when it unmounts. */
export function useTimers() {
	const pending = useRef(new Set<number>());

	useEffect(function trackTimers() {
		const ids = pending.current;
		return function clearTimers() {
			for (const id of ids) window.clearTimeout(id);
			ids.clear();
		};
	}, []);

	const later = useCallback((ms: number, run: () => void) => {
		const id = window.setTimeout(() => {
			pending.current.delete(id);
			run();
		}, ms);
		pending.current.add(id);
	}, []);

	const clear = useCallback(() => {
		for (const id of pending.current) window.clearTimeout(id);
		pending.current.clear();
	}, []);

	return { later, clear };
}
