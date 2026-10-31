// Stand-ins for the React Native modules that the `./react-native` JSDoc
// examples and type tests import: neither package is installed. They copy
// the real signatures of what `reactNativeSignals` uses (react-native
// 0.88's generated `Libraries/AppState/AppState.d.ts`, NetInfo 11's
// `index.d.ts`), so compiling against them checks that the real modules
// satisfy `AppStateLike` and `NetInfoLike`. `check-docs.mjs` adds this file
// to the examples' programs.

declare module "react-native" {
	export type AppStateStatus =
		| "inactive"
		| "background"
		| "active"
		| "extension"
		| "unknown";
	type AppStateEventDefinitions = {
		change: [AppStateStatus];
		memoryWarning: [];
		blur: [];
		focus: [];
	};
	export type AppStateEvent = keyof AppStateEventDefinitions;
	interface EventSubscription {
		remove(): void;
	}
	class AppStateImpl {
		currentState: null | undefined | string;
		addEventListener<K extends AppStateEvent>(
			type: K,
			handler: (...args: AppStateEventDefinitions[K]) => void,
		): EventSubscription;
	}
	export const AppState: AppStateImpl;
}

declare module "@react-native-community/netinfo" {
	// Each state's other fields (`type`, `details`, …) are left out: only
	// `isConnected` reaches `NetInfoLike`.
	interface NetInfoConnectedState {
		isConnected: boolean;
		isInternetReachable: boolean | null;
	}
	interface NetInfoUnknownState {
		isConnected: boolean | null;
		isInternetReachable: null;
	}
	export type NetInfoState = NetInfoConnectedState | NetInfoUnknownState;
	export type NetInfoChangeHandler = (state: NetInfoState) => void;
	export type NetInfoSubscription = () => void;
	export function addEventListener(
		listener: NetInfoChangeHandler,
	): NetInfoSubscription;
	export function fetch(requestedInterface?: string): Promise<NetInfoState>;
	const _default: {
		fetch: typeof fetch;
		addEventListener: typeof addEventListener;
	};
	export default _default;
}
