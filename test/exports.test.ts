import { describe, expect, it } from "vitest";

import * as Core from "../src/index.js";
import * as ReactNative from "../src/react-native/index.js";
import * as React from "../src/react/index.js";

describe("public entry points", () => {
	it("@monarcode/effetch-query exports exactly these values", () => {
		expect(Object.keys(Core).sort()).toEqual([
			"Query",
			"QueryClient",
			"Signals",
		]);
		expect(Object.keys(Core.Query).sort()).toEqual([]);
		expect(Object.keys(Core.QueryClient).sort()).toEqual([
			"QueryClient",
			"layer",
			"make",
		]);
		expect(Object.keys(Core.Signals).sort()).toEqual([]);
	});

	it("@monarcode/effetch-query/react exports exactly these values", () => {
		expect(Object.keys(React).sort()).toEqual([]);
	});

	it("@monarcode/effetch-query/react-native exports exactly these values", () => {
		expect(Object.keys(ReactNative).sort()).toEqual([]);
	});
});
