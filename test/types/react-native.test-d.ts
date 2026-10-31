import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";
import { describe, expectTypeOf, it } from "vitest";

import type { Signals } from "../../src/index.js";
import {
	type AppStateLike,
	type NetInfoLike,
	reactNativeSignals,
} from "../../src/react-native/index.js";

// react-native's types before the generated ones (`types/index.d.ts`), which
// apps on the legacy type surface still get.
interface LegacyAppStateStatic {
	currentState: "active" | "background" | "inactive" | "unknown" | "extension";
	isAvailable: boolean;
	addEventListener(
		type: "change" | "memoryWarning" | "blur" | "focus",
		listener: (state: LegacyAppStateStatic["currentState"]) => void,
	): { remove(): void };
}

describe("reactNativeSignals", () => {
	it("takes React Native's AppState and NetInfo as they are", () => {
		expectTypeOf(
			reactNativeSignals({ AppState, NetInfo }),
		).toEqualTypeOf<Signals.Signals>();
		expectTypeOf<LegacyAppStateStatic>().toExtend<AppStateLike>();
		expectTypeOf<typeof NetInfo>().toExtend<NetInfoLike>();
	});

	it("rejects a module that listens differently", () => {
		reactNativeSignals({
			AppState,
			NetInfo: {
				// @ts-expect-error: NetInfo returns a function that stops listening
				addEventListener: () => ({ remove: () => {} }),
			},
		});
	});
});
