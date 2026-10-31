import type * as Atom from "effect/reactivity/Atom";

/**
 * Where a client hears that the app regained focus or the device came back
 * online. Queries in use refetch on these when they're stale (the
 * `refetchOnFocus` and `refetchOnReconnect` options).
 *
 * Pass one as the `signals` option of `QueryClient.make`.
 * `reactNativeSignals` from `@monarcode/effetch-query/react-native` builds one
 * from React Native's `AppState` and NetInfo.
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
