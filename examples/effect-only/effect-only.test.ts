import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { expect, it } from "vitest";

import { main } from "./effect-only.js";

it("caches, writes and invalidates from Effect code", async () => {
	const result = await Effect.runPromise(main);

	expect(result).toEqual({
		listed: ["Write the docs"],
		opened: Option.some("Ship it"),
		relisted: ["Write the docs", "Ship it"],
		missing: "no todo 99",
		reads: 3,
	});
});
