import * as Atom from "effect/reactivity/Atom";

/**
 * Where a client hears that the app regained focus or the device came back
 * online. Queries in use refetch on these when they're stale (the
 * `refetchOnFocus` and `refetchOnReconnect` options).
 *
 * Pass one as the `signals` option of `QueryClient.make`; the default is
 * {@link browser}. `reactNativeSignals` from
 * `@monarcode/effetch-query/react-native` builds one from React Native's
 * `AppState` and NetInfo.
 *
 * @example
 * ```ts
 * import * as Atom from "effect/reactivity/Atom";
 *
 * import type { Signals } from "@monarcode/effetch-query";
 *
 * const focus = Atom.make(0);
 * const online = Atom.make(true);
 *
 * // Tick `focus` and flip `online` from your platform's events.
 * export const signals: Signals.Signals = { focus, online };
 * ```
 *
 * @since 0.1.0
 */
export interface Signals {
	/** Changes each time the app regains focus. Only changes count, not the value. */
	readonly focus: Atom.Atom<number>;
	/** Whether the device is online. Going from `false` to `true` is a reconnect. */
	readonly online: Atom.Atom<boolean>;
}

// React Native and server runtimes define some browser globals (`window`,
// `navigator`) without the events, so both the document and the global
// event target must be there.
const hasDom = (): boolean =>
	typeof globalThis.document?.addEventListener === "function" &&
	typeof globalThis.addEventListener === "function";

/**
 * The browser's signals, the default: focus is the page becoming visible
 * again, and online follows `navigator.onLine`. Without a DOM, such as on a
 * server or in React Native, they never change.
 *
 * @example
 * ```ts
 * import type * as Layer from "effect/Layer";
 *
 * import { QueryClient, Signals } from "@monarcode/effetch-query";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 *
 * export const queryClient = QueryClient.make({
 *   layer: AppLayer,
 *   signals: Signals.browser,
 * });
 * ```
 *
 * @see {@link none} for no signals at all
 *
 * @since 0.1.0
 */
export const browser: Signals = {
	focus: Atom.readable((get) => {
		if (!hasDom()) {
			return 0;
		}
		const { document } = globalThis;
		let count = 0;
		const onVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				get.setSelf(++count);
			}
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
		get.addFinalizer(() => {
			document.removeEventListener("visibilitychange", onVisibilityChange);
		});
		return count;
	}),
	online: Atom.readable((get) => {
		if (!hasDom()) {
			return true;
		}
		const onChange = () => {
			get.setSelf(globalThis.navigator.onLine);
		};
		globalThis.addEventListener("online", onChange);
		globalThis.addEventListener("offline", onChange);
		get.addFinalizer(() => {
			globalThis.removeEventListener("online", onChange);
			globalThis.removeEventListener("offline", onChange);
		});
		return globalThis.navigator.onLine;
	}),
};

/**
 * Signals that never change: no query refetches on focus or reconnect.
 *
 * @example
 * ```ts
 * import type * as Layer from "effect/Layer";
 *
 * import { QueryClient, Signals } from "@monarcode/effetch-query";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 *
 * // A script or test with no focus or network events.
 * export const queryClient = QueryClient.make({
 *   layer: AppLayer,
 *   signals: Signals.none,
 * });
 * ```
 *
 * @since 0.1.0
 */
export const none: Signals = {
	focus: Atom.readable(() => 0),
	online: Atom.readable(() => true),
};
