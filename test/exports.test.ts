import { describe, expect, it } from "vitest";

import * as Effetch from "../src/effetch/index.js";
import * as Core from "../src/index.js";
import * as ReactNative from "../src/react-native/index.js";
import * as React from "../src/react/index.js";
import * as TanStackRouter from "../src/react/tanstack-router/index.js";

describe("public entry points", () => {
	it("@monarcode/effetch-query exports exactly these values", () => {
		expect(Object.keys(Core).sort()).toEqual([
			"InfiniteQuery",
			"Mutation",
			"Query",
			"QueryClient",
			"QueryFailure",
			"Signals",
		]);
		expect(Object.keys(Core.InfiniteQuery).sort()).toEqual([
			"TypeId",
			"family",
			"fetchNextPage",
			"fetchPreviousPage",
			"isInfiniteQuery",
			"make",
		]);
		expect(Object.keys(Core.Mutation).sort()).toEqual([
			"TypeId",
			"isMutation",
			"make",
			"run",
		]);
		expect(Object.keys(Core.Query).sort()).toEqual([
			"TypeId",
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
			"DuplicateQueryKeyError",
			"NonJsonKeyError",
			"QueryClient",
			"dehydrate",
			"disposeAfter",
			"get",
			"hydrate",
			"layer",
			"make",
		]);
		expect(Object.keys(Core.Signals).sort()).toEqual(["browser", "none"]);
	});

	it("@monarcode/effetch-query/react exports exactly these values", () => {
		expect(Object.keys(React).sort()).toEqual([
			"HydrationBoundary",
			"MissingQueryProviderError",
			"QueryFailure",
			"QueryProvider",
			"useInfiniteQuery",
			"useMutation",
			"useQuery",
			"useQueryClient",
			"useRefetch",
			"useResetQueryFailure",
			"useSuspenseInfiniteQuery",
			"useSuspenseQuery",
		]);
		expect(React.QueryFailure).toBe(Core.QueryFailure);
	});

	it("@monarcode/effetch-query/react-native exports exactly these values", () => {
		expect(Object.keys(ReactNative).sort()).toEqual(["reactNativeSignals"]);
	});

	it("@monarcode/effetch-query/effetch exports exactly these values", () => {
		expect(Object.keys(Effetch).sort()).toEqual(["endpoints"]);
	});

	it("@monarcode/effetch-query/react/tanstack-router exports exactly these values", () => {
		expect(Object.keys(TanStackRouter).sort()).toEqual([
			"connectQueryClient",
		]);
	});
});
