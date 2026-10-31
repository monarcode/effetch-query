import { describe, expect, it } from "vitest";

import * as Core from "../src/index.js";
import * as ReactNative from "../src/react-native/index.js";
import * as React from "../src/react/index.js";

describe("public entry points", () => {
	it("@monarcode/effetch-query exports exactly these values", () => {
		expect(Object.keys(Core).sort()).toEqual([
			"Mutation",
			"Query",
			"QueryClient",
			"QueryFailure",
			"Signals",
		]);
		expect(Object.keys(Core.Mutation).sort()).toEqual([
			"MutationTypeId",
			"make",
			"run",
		]);
		expect(Object.keys(Core.Query).sort()).toEqual([
			"QueryTypeId",
			"family",
			"fetch",
			"get",
			"invalidate",
			"isQuery",
			"make",
			"prefetch",
			"refetch",
			"reset",
			"set",
			"update",
		]);
		expect(Object.keys(Core.QueryClient).sort()).toEqual([
			"QueryClient",
			"layer",
			"make",
		]);
		expect(Object.keys(Core.Signals).sort()).toEqual(["browser", "none"]);
	});

	it("@monarcode/effetch-query/react exports exactly these values", () => {
		expect(Object.keys(React).sort()).toEqual([
			"MissingQueryProvider",
			"QueryFailure",
			"QueryProvider",
			"useMutation",
			"useQuery",
			"useQueryClient",
			"useRefetch",
			"useResetQueryFailure",
			"useSuspenseQuery",
		]);
		expect(React.QueryFailure).toBe(Core.QueryFailure);
	});

	it("@monarcode/effetch-query/react-native exports exactly these values", () => {
		expect(Object.keys(ReactNative).sort()).toEqual([]);
	});
});
