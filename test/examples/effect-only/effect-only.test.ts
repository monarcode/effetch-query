import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { afterEach, expect, it, vi } from "vitest";

import { main } from "../../../examples/effect-only/effect-only.js";

afterEach(() => {
	vi.restoreAllMocks();
});

it("reads the store only when the cache can't answer", async () => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	expect(await Effect.runPromise(main)).toEqual({
		listed: ["Write the docs"],
		opened: Option.some("Ship it"),
		count: { before: 1, after: 2, countSubscriptions: 2 },
		relisted: ["Write the docs", "Ship it"],
		missing: "No todo 99",
		reads: {
			cached: 1,
			afterAdd: 2,
			afterMissing: 3,
			afterRefetch: 4,
			afterInvalidate: 6,
		},
	});
});

it("logs the failed fetch from the client's hook", async () => {
	const log = vi.spyOn(console, "log").mockImplementation(() => {});
	await Effect.runPromise(main);
	// Any call that carries the key and the error, however the logger lays
	// them out.
	expect(log.mock.calls).toContainEqual(
		expect.arrayContaining([
			["todos", "detail", 99],
			expect.stringContaining("No todo 99"),
		]),
	);
});
