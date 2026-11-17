import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import * as Schema from "effect/Schema";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Query, QueryClient } from "../src/index.js";
import { makeFreezer, makeQueryUse } from "../src/internal/queryUse.js";
import { whenShowable } from "../src/internal/suspense.js";
import {
	disposeClients,
	gate,
	makeClient,
	record,
	tracked,
} from "./helpers.js";

afterEach(disposeClients);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Todo {
	readonly id: number;
	readonly title: string;
}

const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });

/** A cached list and a detail family whose placeholder reads it. */
const todos = (options?: { readonly fail?: boolean }) => {
	const detail = gate();
	let placeholders = 0;
	const list = Query.make({
		key: ["todos"],
		run: Effect.succeed<ReadonlyArray<Todo>>([{ id: 1, title: "From list" }]),
	});
	const todo = Query.family({
		key: ["todo"],
		run: (id: number) =>
			Effect.andThen(
				detail.wait,
				options?.fail === true
					? Effect.fail("gone" as const)
					: Effect.succeed<Todo>({ id, title: "Fetched" }),
			),
		placeholder: (id) =>
			Effect.map(
				Query.get(list),
				(cached) => (
					placeholders++,
					Option.flatMap(cached, (items) =>
						Option.fromUndefinedOr(items.find((item) => item.id === id)),
					)
				),
			),
		schema: { success: Todo },
		staleTime: "1 minute",
	});
	return { list, todo, detail, placeholders: () => placeholders };
};

describe("placeholder", () => {
	it("shows a waiting value until the first fetch settles", async () => {
		const client = await makeClient();
		const { list, todo, detail } = todos();
		await client.fetch(list);

		const shown = record(client.registry, todo(1));
		detail.open();
		await client.fetch(todo(1));

		expect(shown).toEqual([
			'Success(waiting) {"id":1,"title":"From list"}',
			'Success {"id":1,"title":"Fetched"}',
		]);
	});

	it("shows a failure, not the placeholder, when the fetch fails", async () => {
		const client = await makeClient();
		const { list, todo, detail } = todos({ fail: true });
		await client.fetch(list);

		const shown = record(client.registry, todo(1));
		detail.open();
		await client.prefetch(todo(1));

		expect(shown).toEqual([
			'Success(waiting) {"id":1,"title":"From list"}',
			"Failure",
		]);
	});

	it("shows nothing for Option.none", async () => {
		const client = await makeClient();
		const { list, todo, detail } = todos();
		await client.fetch(list);

		const shown = record(client.registry, todo(9));
		detail.open();
		await client.fetch(todo(9));

		expect(shown).toEqual([
			"Initial(waiting)",
			'Success {"id":9,"title":"Fetched"}',
		]);
	});

	it("is never cached, updated, fetched or sent", async () => {
		const client = await makeClient();
		const { list, todo, detail } = todos();
		await client.fetch(list);
		record(client.registry, todo(1));
		let updated = 0;

		await client.runPromise(
			Query.update(todo(1), (value) => (updated++, value)),
		);
		const fetched = client.fetch(todo(1));
		await flush();

		expect(QueryClient.get(client, todo(1))).toEqual(Option.none());
		expect(updated).toBe(0);
		// The list has no schema, so only the detail could be sent.
		expect(QueryClient.dehydrate(client)).toEqual([]);
		detail.open();
		expect(await fetched).toEqual({ id: 1, title: "Fetched" });
	});

	it("isn't a value for a query that reads it through ctx.result", async () => {
		const client = await makeClient();
		const { list, todo, detail } = todos();
		await client.fetch(list);
		const title = Query.make({
			key: ["title"],
			run: (ctx) => Effect.map(ctx.result(todo(1)), (found) => found.title),
		});

		const shown = record(client.registry, title);
		await flush();
		detail.open();
		await client.fetch(title);

		expect(shown).toEqual(["Initial(waiting)", 'Success "Fetched"']);
	});

	it("isn't what a suspense reader waits for", async () => {
		const client = await makeClient();
		const { list, todo, detail } = todos();
		await client.fetch(list);
		record(client.registry, todo(1));
		let ready = false;

		void whenShowable(client.registry, todo(1)).then(() => {
			ready = true;
		});
		await flush();
		expect(ready).toBe(false);
		detail.open();
		await client.fetch(todo(1));
		await flush();

		expect(ready).toBe(true);
	});

	it("shows again after a reset, until the next fetch settles", async () => {
		const client = await makeClient();
		const { list, todo, detail } = todos();
		await client.fetch(list);
		detail.open();
		await client.fetch(todo(1));

		const shown = record(client.registry, todo(1));
		await client.reset(todo(1));
		await client.fetch(todo(1));

		expect(shown).toEqual([
			'Success {"id":1,"title":"Fetched"}',
			'Success(waiting) {"id":1,"title":"From list"}',
			'Success {"id":1,"title":"Fetched"}',
		]);
	});
});

describe("a placeholder that dies", () => {
	it("is logged, and shows nothing", async () => {
		const client = await makeClient();
		const detail = gate();
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const logs = vi.spyOn(console, "log").mockImplementation(() => {});
		const todo = Query.make({
			key: ["todo"],
			run: Effect.as(detail.wait, 1),
			placeholder: Effect.die("broken"),
		});

		const shown = record(client.registry, todo);
		await flush();
		detail.open();
		await client.fetch(todo);

		expect(shown).toEqual(["Initial(waiting)", "Success 1"]);
		const output = [...logged.mock.calls, ...logs.mock.calls]
			.flat()
			.join(" ");
		expect(output).toContain("A query's placeholder failed");
		logged.mockRestore();
		logs.mockRestore();
	});
});

describe("what readers keep", () => {
	it("doesn't count a fetch a dropped render started as the reader's own", async () => {
		const client = await makeClient();
		const first = tracked(["first"], (n) => Effect.succeed(n));
		const second = tracked(["second"], (n) => Effect.succeed(n));
		const reader = makeQueryUse(client.registry);
		reader.read(first.query, false);
		client.registry.get(first.query);
		reader.mounted(first.query);

		// A transition renders `second`, whose read fetches it; an urgent
		// update renders `first` again; the transition renders `second` again.
		reader.read(second.query, false);
		client.registry.get(second.query);
		reader.read(first.query, false);
		reader.read(second.query, false);
		reader.mounted(second.query);

		expect(second.fetches.count).toBe(1);
	});

	it("gives a paused reader one object while the cache shows the same", async () => {
		const client = await makeClient();
		const slow = gate();
		const { query } = tracked(["n"], (n) =>
			n === 1 ? Effect.succeed(n) : Effect.as(slow.wait, n),
		);
		record(client.registry, query);
		await client.invalidate(query);
		await client.runPromise(Query.set(query, 5));
		const freezer = makeFreezer(client.registry);

		expect(freezer.show(query)).toBe(freezer.show(query));
		slow.open();
	});

	it("gives one server value for a query that isn't cached", async () => {
		const client = await makeClient();
		const { query } = tracked(["n"], (n) => Effect.succeed(n));

		expect(Atom.getServerValue(query, client.registry)).toBe(
			Atom.getServerValue(query, client.registry),
		);
	});
});
