import * as Atom from "effect/reactivity/Atom";

import type * as Signals from "../Signals.js";

/**
 * The part of React Native's `AppState` that {@link reactNativeSignals}
 * uses. `AppState` from `react-native` satisfies it, so this package never
 * imports `react-native`.
 *
 * @example
 * ```ts
 * import type { AppStateLike } from "@monarcode/effetch-query/react-native";
 *
 * // A stand-in for tests: an app that's always in the foreground.
 * export const AppState: AppStateLike = {
 *   currentState: "active",
 *   addEventListener: () => ({ remove: () => {} }),
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface AppStateLike {
	/** The app's state now: `"active"` when it's in the foreground. */
	readonly currentState: string | null | undefined;
	/** Listens for changes to the app's state. */
	readonly addEventListener: (
		type: "change",
		listener: (state: string) => void,
	) => { readonly remove: () => void };
}

/**
 * The part of NetInfo (`@react-native-community/netinfo`) that
 * {@link reactNativeSignals} uses. Its default export satisfies it, so this
 * package never imports it.
 *
 * @example
 * ```ts
 * import type { NetInfoLike } from "@monarcode/effetch-query/react-native";
 *
 * // A stand-in for tests: a device that's always online.
 * export const NetInfo: NetInfoLike = {
 *   addEventListener: (listener) => {
 *     listener({ isConnected: true });
 *     return () => {};
 *   },
 * };
 * ```
 *
 * @since 0.1.0
 */
export interface NetInfoLike {
	/**
	 * Listens for network changes; returns a function that stops listening.
	 * `isConnected` is `null` while NetInfo doesn't know yet.
	 */
	readonly addEventListener: (
		listener: (state: { readonly isConnected: boolean | null }) => void,
	) => () => void;
}

/**
 * What {@link reactNativeSignals} listens to.
 *
 * @example
 * ```ts
 * import NetInfo from "@react-native-community/netinfo";
 * import { AppState } from "react-native";
 *
 * import type { ReactNativeSignalsOptions } from "@monarcode/effetch-query/react-native";
 *
 * export const options: ReactNativeSignalsOptions = { AppState, NetInfo };
 * ```
 *
 * @since 0.1.0
 */
export interface ReactNativeSignalsOptions {
	/** React Native's `AppState`. */
	readonly AppState: AppStateLike;
	/** NetInfo's default export. */
	readonly NetInfo: NetInfoLike;
}

/**
 * Signals for React Native: focus is the app coming back to the foreground
 * (`AppState` changing to `"active"` from anything else), and online follows
 * NetInfo's `isConnected`, where `null` (not known yet) counts as online.
 * Pass them as the `signals` option of `QueryClient.make`, in place of the
 * default `Signals.browser`, which never changes without a DOM.
 *
 * The listeners start when a client first needs them and stop when it's
 * disposed, so one set of signals can serve several clients.
 *
 * @example
 * ```ts
 * import NetInfo from "@react-native-community/netinfo";
 * import type * as Layer from "effect/Layer";
 * import { AppState } from "react-native";
 *
 * import { QueryClient } from "@monarcode/effetch-query";
 * import { reactNativeSignals } from "@monarcode/effetch-query/react-native";
 *
 * declare const AppLayer: Layer.Layer<QueryClient.Services>;
 *
 * export const queryClient = QueryClient.make({
 *   layer: AppLayer,
 *   signals: reactNativeSignals({ AppState, NetInfo }),
 * });
 * ```
 *
 * @since 0.1.0
 */
export const reactNativeSignals = ({
	AppState,
	NetInfo,
}: ReactNativeSignalsOptions): Signals.Signals => ({
	focus: Atom.readable((get) => {
		let count = 0;
		let previous = AppState.currentState;
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active" && previous !== "active") {
				get.setSelf(++count);
			}
			previous = state;
		});
		get.addFinalizer(() => {
			subscription.remove();
		});
		return count;
	}),
	online: Atom.readable((get) => {
		let online = true;
		let built = false;
		// NetInfo calls the listener with what it knows, which may be before
		// `addEventListener` returns: that's the initial value, not a change.
		const unsubscribe = NetInfo.addEventListener((state) => {
			online = state.isConnected !== false;
			if (built) {
				get.setSelf(online);
			}
		});
		get.addFinalizer(unsubscribe);
		built = true;
		return online;
	}),
});
