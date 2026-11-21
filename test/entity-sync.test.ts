import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { Fetch } from "@monarcode/effetch";
import { afterEach, describe, expect, it } from "vitest";

import { fromClient } from "../src/effetch/index.js";
import {
	Entity,
	InfiniteQuery,
	Mutation,
	Query,
	QueryClient,
} from "../src/index.js";
import { setValue } from "../src/internal/cache.js";
import { peek } from "../src/internal/queryAtom.js";
import { disposeClients, gate, makeClient, use } from "./helpers.js";
import { servicesLayer, TestApi } from "./services.js";

afterEach(disposeClients);

const Transaction = Schema.Struct({ id: Schema.String, status: Schema.String });
type Transaction = typeof Transaction.Type;
const Transactions = Entity.make(Transaction, { id: (t) => t.id });

/** The server's records, which every fetch reads. */
const backend = () => {
	const records = new Map<string, Transaction>([
		["t1", { id: "t1", status: "Pending" }],
		["t2", { id: "t2", status: "Pending" }],
	]);
	const fetches = { list: 0, detail: 0 };
	const set = (id: string, status: string) => {
		records.set(id, { id, status });
	};
	const list = Query.family({
		key: ["transactions", "list"],
		run: (limit: number) =>
			Effect.sync(() => {
				fetches.list++;
				return [...records.values()].slice(0, limit);
			}),
		schema: { success: Schema.Array(Transaction) },
	});
	const detail = Query.family({
		key: ["transactions"],
		run: (id: string) =>
			Effect.sync(() => {
				fetches.detail++;
				return records.get(id)!;
			}),
		schema: { success: Transaction },
	});
	return { records, fetches, set, list, detail };
};

const syncing = () => makeClient({ entities: { sync: [Transactions] } });

const cached = async <A>(
	client: QueryClient.QueryClient,
	query: Query.Query<A, any>,
): Promise<A> => Option.getOrThrow(await client.runPromise(Query.get(query)));

const timestamp = (
	client: QueryClient.QueryClient,
	query: Query.Query<any, any>,
): number => {
	const result = Option.getOrThrow(peek(client.registry, query));
	if (!AsyncResult.isSuccess(result)) {
		throw new Error(`Not a success: ${result._tag}`);
	}
	return result.timestamp;
};

const statuses = (list: ReadonlyArray<Transaction>) =>
	list.map((t) => `${t.id} ${t.status}`);

describe("entity sync", () => {
	it("writes a details fetch into every list that holds the record, keeping their ages", async () => {
		const client = await syncing();
		const server = backend();
		await client.fetch(server.list(10));
		await client.fetch(server.list(20));
		const unmount = use(client.registry, server.list(10));
		const listFetches = server.fetches.list;
		const ages = [
			timestamp(client, server.list(10)),
			timestamp(client, server.list(20)),
		];

		server.set("t1", "Successful");
		expect(await client.fetch(server.detail("t1"))).toEqual({
			id: "t1",
			status: "Successful",
		});

		for (const limit of [10, 20]) {
			expect(statuses(await cached(client, server.list(limit)))).toEqual([
				"t1 Successful",
				"t2 Pending",
			]);
		}
		expect([
			timestamp(client, server.list(10)),
			timestamp(client, server.list(20)),
		]).toEqual(ages);
		expect(server.fetches.list).toBe(listFetches);
		unmount();
	});

	it("writes a list fetch into the cached details", async () => {
		const client = await syncing();
		const server = backend();
		await client.fetch(server.detail("t1"));
		await client.fetch(server.detail("t2"));
		const untouched = await cached(client, server.detail("t2"));

		server.set("t1", "Successful");
		await client.fetch(server.list(10));

		expect(await cached(client, server.detail("t1"))).toEqual({
			id: "t1",
			status: "Successful",
		});
		// An equal copy isn't written.
		expect(await cached(client, server.detail("t2"))).toBe(untouched);
		expect(server.fetches.detail).toBe(2);
	});

	it("does nothing without entities.sync, and for entities not in it", async () => {
		const server = backend();
		const plain = await makeClient();
		await plain.fetch(server.list(10));
		server.set("t1", "Successful");
		await plain.fetch(server.detail("t1"));
		expect(statuses(await cached(plain, server.list(10)))).toEqual([
			"t1 Pending",
			"t2 Pending",
		]);

		const Other = Entity.make(Schema.Struct({ id: Schema.String }), {
			id: (record) => record.id,
		});
		const other = await makeClient({ entities: { sync: [Other] } });
		server.set("t1", "Pending");
		await other.fetch(server.list(10));
		server.set("t1", "Successful");
		await other.fetch(server.detail("t1"));
		expect(statuses(await cached(other, server.list(10)))).toEqual([
			"t1 Pending",
			"t2 Pending",
		]);
	});

	it("doesn't let an older response that settles last overwrite a newer copy", async () => {
		const client = await syncing();
		const server = backend();
		const slow = gate();
		const detail = Query.family({
			key: ["transactions", "slow"],
			run: (id: string) =>
				Effect.flatMap(
					Effect.sync(() => server.records.get(id)!),
					(read) => Effect.as(slow.wait, read),
				),
			schema: { success: Transaction },
		});
		await client.fetch(server.list(10));

		// The details read "Pending", then the list reads "Successful" and
		// settles first.
		const pending = client.fetch(detail("t1"));
		await Effect.runPromise(Effect.yieldNow);
		server.set("t1", "Successful");
		await client.fetch(server.list(10));
		slow.open();

		expect(await pending).toEqual({ id: "t1", status: "Successful" });
		expect(statuses(await cached(client, server.list(10)))).toEqual([
			"t1 Successful",
			"t2 Pending",
		]);
	});

	it("never fetches again to sync, and a sync starts no other", async () => {
		const client = await syncing();
		const server = backend();
		await client.fetch(server.list(10));
		await client.fetch(server.list(20));
		await client.fetch(server.detail("t1"));
		const before = { ...server.fetches };

		server.set("t1", "Successful");
		await client.fetch(server.detail("t1"));
		await client.fetch(server.list(10));

		expect(server.fetches).toEqual({
			list: before.list + 1,
			detail: before.detail + 1,
		});
		expect(statuses(await cached(client, server.list(20)))).toEqual([
			"t1 Successful",
			"t2 Pending",
		]);
	});

	it("skips an invalidated query and a failed one, both ways", async () => {
		const client = await syncing();
		const server = backend();
		let fail = false;
		const flaky = Query.make({
			key: ["transactions", "flaky"],
			run: Effect.suspend(() =>
				fail
					? Effect.fail("offline" as const)
					: Effect.succeed([...server.records.values()]),
			),
			schema: { success: Schema.Array(Transaction) },
		});
		await client.fetch(server.list(10));
		await client.fetch(flaky);
		fail = true;
		await client.runPromiseExit(Query.fetch(flaky));
		await client.invalidate(server.list(10));

		server.set("t1", "Successful");
		await client.fetch(server.detail("t1"));

		expect(statuses(await cached(client, server.list(10)))).toEqual([
			"t1 Pending",
			"t2 Pending",
		]);
		expect(statuses(await cached(client, flaky))).toEqual([
			"t1 Pending",
			"t2 Pending",
		]);
	});

	it("leaves out a query that opted out, both ways", async () => {
		const client = await syncing();
		const server = backend();
		const summaries = Query.make({
			key: ["transactions", "summaries"],
			run: Effect.sync(() => [...server.records.values()]),
			schema: { success: Schema.Array(Transaction) },
			entities: { sync: false },
		});
		await client.fetch(summaries);
		await client.fetch(server.detail("t1"));

		server.set("t1", "Successful");
		await client.fetch(server.detail("t1"));
		expect(statuses(await cached(client, summaries))).toEqual([
			"t1 Pending",
			"t2 Pending",
		]);

		server.set("t1", "Failed");
		await client.fetch(summaries);
		expect(await cached(client, server.detail("t1"))).toEqual({
			id: "t1",
			status: "Successful",
		});
	});

	it("doesn't sync a fetch already in flight over a newer Entity write, or spread the write", async () => {
		const client = await syncing();
		const server = backend();
		const started = gate();
		const slow = gate();
		const detail = Query.make({
			key: ["transactions", "slow", "t1"],
			run: Effect.flatMap(
				Effect.sync(() => {
					started.open();
					return server.records.get("t1")!;
				}),
				(read) => Effect.as(slow.wait, read),
			),
			schema: { success: Transaction },
		});
		await client.fetch(server.list(10));

		const pending = client.fetch(detail);
		await Effect.runPromise(started.wait);
		await client.runPromise(
			Entity.set(Transactions, { id: "t1", status: "Cancelled" }),
		);
		slow.open();

		// The write is newer than the fetch, so the list keeps it. A sync
		// spreads only fetched copies: the details show what they fetched.
		expect(await pending).toEqual({ id: "t1", status: "Pending" });
		expect(statuses(await cached(client, server.list(10)))).toEqual([
			"t1 Cancelled",
			"t2 Pending",
		]);
	});

	it("puts a sync back over a failed mutation's rolled-back optimistic write", async () => {
		const client = await syncing();
		const server = backend();
		await client.fetch(server.list(10));
		await client.fetch(server.detail("t1"));
		let during: ReadonlyArray<string> = [];
		const cancel = Mutation.make({
			run: () =>
				Effect.promise(async () => {
					server.set("t1", "Successful");
					await client.fetch(server.detail("t1"));
					during = statuses(await cached(client, server.list(10)));
				}).pipe(Effect.andThen(Effect.fail("rejected" as const))),
			optimistic: () =>
				Entity.update(Transactions, "t1", (t) => ({
					...t,
					status: "Cancelling",
				})),
		});

		await client.runPromiseExit(Mutation.run(cancel));

		expect(during).toEqual(["t1 Successful", "t2 Pending"]);
		expect(statuses(await cached(client, server.list(10)))).toEqual([
			"t1 Successful",
			"t2 Pending",
		]);
	});

	it("writes an infinite query's pages, and dates only a new page by its fetch", async () => {
		const client = await syncing();
		const server = backend();
		let failNext = false;
		const Page = Schema.Struct({
			items: Schema.Array(Transaction),
			next: Schema.NullOr(Schema.Finite),
		});
		const pages = InfiniteQuery.make({
			key: ["transactions", "pages"],
			run: (cursor: number) =>
				cursor === 1 && failNext
					? Effect.fail("offline" as const)
					: Effect.sync(() => ({
							items: [server.records.get(cursor === 0 ? "t1" : "t2")!],
							next: cursor === 0 ? 1 : null,
						})),
			initialPageParam: 0,
			nextPageParam: (last: typeof Page.Type) => last.next,
			schema: { page: Page },
			staleTime: "1 hour",
		});
		const items = async () =>
			statuses(
				(await cached(client, pages)).pages.flatMap((page) => page.items),
			);
		await client.runPromise(InfiniteQuery.fetchNextPage(pages));
		await client.fetch(server.detail("t2"));

		// A details fetch reaches a loaded page.
		server.set("t1", "Successful");
		await client.fetch(server.detail("t1"));
		expect(await items()).toEqual(["t1 Successful"]);

		// While the pages show a failure, a details fetch skips them, so
		// their first page is older than the details.
		failNext = true;
		await client.runPromiseExit(InfiniteQuery.fetchNextPage(pages));
		server.set("t1", "Refunded");
		await client.fetch(server.detail("t1"));

		// Loading the next page doesn't date the first by its fetch: the
		// details keep theirs and the page takes it. The new page goes to
		// the details.
		failNext = false;
		server.set("t2", "Successful");
		await client.runPromise(InfiniteQuery.fetchNextPage(pages));
		expect(await items()).toEqual(["t1 Refunded", "t2 Successful"]);
		expect(await cached(client, server.detail("t1"))).toEqual({
			id: "t1",
			status: "Refunded",
		});
		expect(await cached(client, server.detail("t2"))).toEqual({
			id: "t2",
			status: "Successful",
		});
	});

	it("logs an id that throws, and the fetch keeps its value", async () => {
		const errors: Array<unknown> = [];
		const logger = Logger.layer([
			Logger.make(({ logLevel, message }) => {
				if (logLevel === "Error") {
					errors.push(message);
				}
			}),
		]);
		const Throwing = Entity.make(Transaction, {
			id: (t) => {
				if (t.status === "Broken") {
					throw new Error("no id");
				}
				return t.id;
			},
		});
		const client = await makeClient({
			layer: Layer.merge(servicesLayer("hello"), logger),
			entities: { sync: [Throwing] },
		});
		const server = backend();
		await client.fetch(server.list(10));

		server.set("t1", "Broken");
		expect(await client.fetch(server.detail("t1"))).toEqual({
			id: "t1",
			status: "Broken",
		});
		expect(statuses(await cached(client, server.list(10)))).toEqual([
			"t1 Pending",
			"t2 Pending",
		]);
		expect(errors.flat()).toContain("Entity sync failed");
	});

	it("syncs Effetch endpoint queries", async () => {
		const records = new Map<string, Transaction>([
			["t1", { id: "t1", status: "Pending" }],
		]);
		const client = await makeClient({
			layer: servicesLayer("hello", (request) =>
				Response.json(
					request.url.pathname === "/transactions"
						? [...records.values()]
						: records.get("t1"),
				),
			),
			entities: { sync: [Transactions] },
		});
		const api = fromClient(TestApi);
		const list = api.query(
			Fetch.endpoint("GET /transactions", {
				output: Schema.Array(Transaction),
			}),
		);
		const detail = api.query(
			Fetch.endpoint("GET /transactions/:id", { output: Transaction }),
		);
		await client.fetch(list());

		records.set("t1", { id: "t1", status: "Successful" });
		await client.fetch(detail({ params: { id: "t1" } }));

		expect(statuses(await cached(client, list()))).toEqual(["t1 Successful"]);
	});
});

/** Lets the registry's tasks and a stream's fibers run. */
const settle = async () => {
	for (let i = 0; i < 3; i++) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
};

/** A details query whose fetch reads the record, then waits for `slow`. */
const slowDetail = (server: ReturnType<typeof backend>, id: string) => {
	const started = gate();
	const slow = gate();
	const query = Query.make({
		key: ["transactions", "slow", id],
		run: Effect.flatMap(
			Effect.sync(() => {
				started.open();
				return server.records.get(id)!;
			}),
			(read) => Effect.as(slow.wait, read),
		),
		schema: { success: Transaction },
	});
	return { query, started: Effect.runPromise(started.wait), open: slow.open };
};

describe("entity sync, from the review", () => {
	it("dates only the copies a write changed", async () => {
		const client = await syncing();
		const server = backend();
		await client.fetch(server.list(10));
		server.set("t2", "Successful");
		const detail = slowDetail(server, "t2");

		const pending = client.fetch(detail.query);
		await detail.started;
		// A row added to the list doesn't make its other rows newer.
		await client.runPromise(
			Query.update(server.list(10), (rows) => [
				...rows,
				{ id: "t3", status: "Pending" },
			]),
		);
		detail.open();

		expect(await pending).toEqual({ id: "t2", status: "Successful" });
		expect(statuses(await cached(client, server.list(10)))).toEqual([
			"t1 Pending",
			"t2 Successful",
			"t3 Pending",
		]);
	});

	it("doesn't spread an optimistic write, and a rollback dates the copy back", async () => {
		const client = await syncing();
		const server = backend();
		await client.fetch(server.list(10));
		server.set("t1", "Successful");
		const detail = slowDetail(server, "t1");
		const pending = client.fetch(detail.query);
		await detail.started;
		const cancel = Mutation.make({
			run: () => Effect.fail("rejected" as const),
			optimistic: () =>
				Entity.update(Transactions, "t1", (t) => ({
					...t,
					status: "Cancelling",
				})),
		});

		await client.runPromiseExit(Mutation.run(cancel));
		detail.open();

		// The detail fetched "Successful" and never showed "Cancelling"; the
		// list, rolled back, is older than that fetch again.
		expect(await pending).toEqual({ id: "t1", status: "Successful" });
		expect(statuses(await cached(client, server.list(10)))).toEqual([
			"t1 Successful",
			"t2 Pending",
		]);
	});

	it("keeps a newer copy synced into a query while it fetched", async () => {
		const client = await syncing();
		const server = backend();
		const listStarted = gate();
		const listGate = gate();
		const list = Query.make({
			key: ["transactions", "slow list"],
			run: Effect.flatMap(
				Effect.sync(() => {
					listStarted.open();
					return [...server.records.values()];
				}),
				(read) => Effect.as(listGate.wait, read),
			),
			schema: { success: Schema.Array(Transaction) },
		});
		await client.runPromise(Query.set(list, [...server.records.values()]));

		const pending = client.fetch(list);
		await Effect.runPromise(listStarted.wait);
		server.set("t1", "Successful");
		await client.fetch(server.detail("t1"));
		// The source of the newer copy is gone before the list lands.
		await client.runPromise(Query.clear(server.detail("t1")));
		listGate.open();

		expect(statuses(await pending)).toEqual(["t1 Successful", "t2 Pending"]);
	});

	it("doesn't write a query the fetch read, so it doesn't fetch again", async () => {
		const client = await syncing();
		const server = backend();
		let reads = 0;
		const Detailed = Schema.Struct({
			transaction: Transaction,
			seenAt: Schema.Finite,
		});
		const detailed = Query.make({
			key: ["transactions", "detailed"],
			run: (ctx: Query.RunContext) =>
				Effect.map(ctx.result(server.detail("t1")), (transaction) => {
					reads++;
					// Its own copy, which differs from the one it read.
					return {
						transaction: { ...transaction, status: "Seen" },
						seenAt: reads,
					};
				}),
			schema: { success: Detailed },
		});
		// The details are older than the fetch that reads them.
		await client.fetch(server.detail("t1"));
		const unmount = use(client.registry, detailed);
		await settle();
		await settle();

		expect(reads).toBe(1);
		expect(await cached(client, server.detail("t1"))).toEqual({
			id: "t1",
			status: "Pending",
		});
		unmount();
	});

	it("doesn't let an older fetch overwrite a live push", async () => {
		const client = await syncing();
		const server = backend();
		let queue:
			| Queue.Queue<
					(rows: ReadonlyArray<Transaction>) => ReadonlyArray<Transaction>,
					Cause.Done
			  >
			| undefined;
		const live = Query.make({
			key: ["transactions", "live"],
			run: Effect.sync(() => [...server.records.values()]),
			schema: { success: Schema.Array(Transaction) },
			live: Stream.callback<
				(rows: ReadonlyArray<Transaction>) => ReadonlyArray<Transaction>
			>((q) =>
				Effect.sync(() => {
					queue = q;
				}),
			),
			staleTime: "1 hour",
		});
		const unmount = client.registry.mount(live);
		await settle();
		const detail = slowDetail(server, "t1");

		const pending = client.fetch(detail.query);
		await detail.started;
		Queue.offerUnsafe(queue!, (rows) =>
			rows.map((t) => (t.id === "t1" ? { ...t, status: "Successful" } : t)),
		);
		await settle();
		detail.open();
		await pending;

		expect(statuses(await cached(client, live))).toEqual([
			"t1 Successful",
			"t2 Pending",
		]);
		unmount();
	});

	it("dates a retry by when it started", async () => {
		const client = await syncing();
		const server = backend();
		const firstAttempt = gate();
		const failing = gate();
		let attempts = 0;
		const detail = Query.make({
			key: ["transactions", "retried"],
			run: Effect.suspend(() => {
				attempts++;
				if (attempts === 1) {
					firstAttempt.open();
					return Effect.andThen(
						failing.wait,
						Effect.fail("timeout" as const),
					);
				}
				return Effect.sync(() => server.records.get("t1")!);
			}),
			schema: { success: Transaction },
			retry: Schedule.recurs(1),
		});
		const pending = client.fetch(detail);
		await Effect.runPromise(firstAttempt.wait);
		await client.fetch(server.list(10));
		server.set("t1", "Successful");
		failing.open();

		expect(await pending).toEqual({ id: "t1", status: "Successful" });
		expect(statuses(await cached(client, server.list(10)))).toEqual([
			"t1 Successful",
			"t2 Pending",
		]);
	});

	it("doesn't put a sync back over a newer fetch when a mutation rolls back", async () => {
		const client = await syncing();
		const server = backend();
		await client.fetch(server.list(10));
		const rename = Mutation.make({
			run: () =>
				Effect.promise(async () => {
					server.set("t1", "Successful");
					await client.fetch(server.detail("t1"));
					server.set("t1", "Refunded");
					await client.fetch(server.list(10));
				}).pipe(Effect.andThen(Effect.fail("rejected" as const))),
			optimistic: () =>
				Entity.update(Transactions, "t2", (t) => ({
					...t,
					status: "Cancelling",
				})),
		});

		await client.runPromiseExit(Mutation.run(rename));

		expect(statuses(await cached(client, server.list(10)))).toEqual([
			"t1 Refunded",
			"t2 Pending",
		]);
	});

	it("writes an outer entity with the inner copies it pulled", async () => {
		const Customer = Schema.Struct({
			id: Schema.String,
			name: Schema.String,
		});
		const Order = Schema.Struct({ id: Schema.String, customer: Customer });
		const Customers = Entity.make(Customer, { id: (c) => c.id });
		const Orders = Entity.make(Order, { id: (o) => o.id });
		// Orders first: their writes are computed after every pull.
		const client = await makeClient({
			entities: { sync: [Orders, Customers] },
		});
		let name = "Ada";
		const customer = () => ({ id: "c1", name });
		const recent = Query.make({
			key: ["orders", "recent"],
			run: Effect.sync(() => [{ id: "o1", customer: customer() }]),
			schema: { success: Schema.Array(Order) },
		});
		const profile = Query.make({
			key: ["customers", "c1"],
			run: Effect.sync(customer),
			schema: { success: Customer },
		});
		await client.fetch(recent);
		const started = gate();
		const slow = gate();
		const orders = Query.make({
			key: ["orders"],
			run: Effect.flatMap(
				Effect.sync(() => {
					started.open();
					return [{ id: "o1", customer: customer() }];
				}),
				(read) => Effect.as(slow.wait, read),
			),
			schema: { success: Schema.Array(Order) },
		});

		// The orders read "Ada"; then the customer, fetched later, is "Grace".
		const pending = client.fetch(orders);
		await Effect.runPromise(started.wait);
		name = "Grace";
		await client.fetch(profile);
		slow.open();
		await pending;

		for (const query of [orders, recent]) {
			expect((await cached(client, query))[0]!.customer.name).toBe("Grace");
		}
	});

	it("refetches a query that reads a written one, once", async () => {
		const client = await syncing();
		const server = backend();
		let reads = 0;
		const done = Query.make({
			key: ["transactions", "done"],
			run: (ctx: Query.RunContext) =>
				Effect.map(ctx.result(server.list(10)), (rows) => {
					reads++;
					return rows.filter((t) => t.status === "Successful").length;
				}),
		});
		const unmount = use(client.registry, done);
		await settle();
		expect(reads).toBe(1);

		server.set("t1", "Successful");
		await client.fetch(server.detail("t1"));
		await settle();
		await settle();

		expect(reads).toBe(2);
		expect(await cached(client, done)).toBe(1);
		unmount();
	});

	it("leaves out Effetch queries and infinite queries that opted out", async () => {
		const records = new Map<string, Transaction>([
			["t1", { id: "t1", status: "Pending" }],
		]);
		const client = await makeClient({
			layer: servicesLayer("hello", (request) =>
				Response.json(
					request.url.pathname === "/transactions"
						? [...records.values()]
						: request.url.pathname === "/pages"
							? { items: [...records.values()], next: null }
							: records.get("t1"),
				),
			),
			entities: { sync: [Transactions] },
		});
		const api = fromClient(TestApi);
		const list = api.query(
			Fetch.endpoint("GET /transactions", {
				output: Schema.Array(Transaction),
			}),
			{ entities: { sync: false } },
		);
		const pages = api.infiniteQuery(
			Fetch.endpoint("GET /pages", {
				output: Schema.Struct({
					items: Schema.Array(Transaction),
					next: Schema.NullOr(Schema.String),
				}),
			}),
			{
				pageParam: "cursor",
				initialPageParam: null as string | null,
				nextPageParam: (page) => page.next,
				entities: { sync: false },
			},
		);
		const detail = api.query(
			Fetch.endpoint("GET /transactions/:id", { output: Transaction }),
		);
		await client.fetch(list());
		await client.runPromise(InfiniteQuery.fetchNextPage(pages()));

		records.set("t1", { id: "t1", status: "Successful" });
		await client.fetch(detail({ params: { id: "t1" } }));

		expect(statuses(await cached(client, list()))).toEqual(["t1 Pending"]);
		expect(statuses((await cached(client, pages())).pages[0]!.items)).toEqual(
			["t1 Pending"],
		);
	});

	it("logs a listener that throws, and the fetch keeps its value", async () => {
		const errors: Array<unknown> = [];
		const logger = Logger.layer([
			Logger.make(({ logLevel, message }) => {
				if (logLevel === "Error") {
					errors.push(message);
				}
			}),
		]);
		const client = await makeClient({
			layer: Layer.merge(servicesLayer("hello"), logger),
			entities: { sync: [Transactions] },
		});
		const server = backend();
		await client.fetch(server.list(10));
		let calls = 0;
		client.registry.subscribe(server.list(10), () => {
			calls++;
			throw new Error("listener");
		});

		server.set("t1", "Successful");
		expect(await client.fetch(server.detail("t1"))).toEqual({
			id: "t1",
			status: "Successful",
		});
		expect(calls).toBeGreaterThan(0);
		expect(errors.flat()).toContain("Entity sync failed");
	});
});

describe("entity sync, paged and guarded", () => {
	const Page = Schema.Struct({
		items: Schema.Array(Transaction),
		next: Schema.NullOr(Schema.Finite),
	});

	/** Two pages, t1 then t2, that wait for `hold` when it's set. */
	const paged = (
		server: ReturnType<typeof backend>,
		hold: { page?: number; first?: boolean; until?: Effect.Effect<void> },
		options: { retry?: Schedule.Schedule<unknown, unknown> } = {},
	) =>
		InfiniteQuery.make({
			key: ["transactions", "pages"],
			run: (cursor: number) =>
				Effect.suspend(() => {
					const read = Effect.sync(() => ({
						items: [server.records.get(cursor === 0 ? "t1" : "t2")!],
						next: cursor === 0 ? 1 : null,
					}));
					if (hold.page !== cursor || hold.until === undefined) {
						return read;
					}
					const until = hold.until;
					if (hold.first === true) {
						hold.first = false;
						return Effect.andThen(until, Effect.fail("timeout" as const));
					}
					return Effect.andThen(until, read);
				}),
			initialPageParam: 0,
			nextPageParam: (last: typeof Page.Type) => last.next,
			schema: { page: Page },
			...options,
		});

	const items = async (
		client: QueryClient.QueryClient,
		pages: ReturnType<typeof paged>,
	) =>
		statuses(
			(await cached(client, pages)).pages.flatMap((page) => page.items),
		);

	it("dates each page of a refetch by when its fetch started", async () => {
		const client = await syncing();
		const server = backend();
		const hold: Parameters<typeof paged>[1] = {};
		const pages = paged(server, hold);
		await client.runPromise(InfiniteQuery.fetchNextPage(pages));
		await client.runPromise(InfiniteQuery.fetchNextPage(pages));

		// The first page waits, so the second starts after the details fetch.
		const firstPage = gate();
		const started = gate();
		Object.assign(hold, {
			page: 0,
			until: Effect.andThen(Effect.sync(started.open), firstPage.wait),
		});
		const refetching = client.fetch(pages);
		await Effect.runPromise(started.wait);
		server.set("t2", "Successful");
		await client.fetch(server.detail("t2"));
		server.set("t2", "Refunded");
		firstPage.open();
		await refetching;

		expect(await items(client, pages)).toEqual(["t1 Pending", "t2 Refunded"]);
		expect(await cached(client, server.detail("t2"))).toEqual({
			id: "t2",
			status: "Refunded",
		});
	});

	it("dates a page read before a retried page by when it was read", async () => {
		const client = await syncing();
		const server = backend();
		const hold: Parameters<typeof paged>[1] = {};
		const pages = paged(server, hold, { retry: Schedule.recurs(1) });
		await client.runPromise(InfiniteQuery.fetchNextPage(pages));
		await client.runPromise(InfiniteQuery.fetchNextPage(pages));

		// The second page fails once, and its retry starts after the details
		// fetch: the first page, read before both, is older than the details.
		const failing = gate();
		const started = gate();
		Object.assign(hold, {
			page: 1,
			first: true,
			until: Effect.andThen(Effect.sync(started.open), failing.wait),
		});
		const refetching = client.fetch(pages);
		await Effect.runPromise(started.wait);
		server.set("t1", "Successful");
		await client.fetch(server.detail("t1"));
		hold.until = Effect.void;
		failing.open();
		await refetching;

		expect(await items(client, pages)).toEqual([
			"t1 Successful",
			"t2 Pending",
		]);
		expect(await cached(client, server.detail("t1"))).toEqual({
			id: "t1",
			status: "Successful",
		});
	});

	it("sends only the new page when loading more, not the pages already shown", async () => {
		const server = backend();
		const detail = Query.family({
			key: ["transactions"],
			run: (id: string) => Effect.sync(() => server.records.get(id)!),
			schema: { success: Transaction },
			staleTime: "1 hour",
		});
		const rendered = await makeClient();
		server.set("t1", "Successful");
		await rendered.fetch(detail("t1"));
		const sent = QueryClient.dehydrate(rendered);
		server.set("t1", "Pending");

		const client = await syncing();
		const pages = paged(server, {});
		await client.runPromise(InfiniteQuery.fetchNextPage(pages));
		// A server render sent the details after the first page loaded.
		QueryClient.hydrate(client, sent);
		const unmount = use(client.registry, detail("t1"));
		await client.runPromise(InfiniteQuery.fetchNextPage(pages));

		expect(await cached(client, detail("t1"))).toEqual({
			id: "t1",
			status: "Successful",
		});
		unmount();
	});

	it("keeps a write whose id throws", async () => {
		const Throwing = Entity.make(Transaction, {
			id: (t) => {
				if (t.status === "Broken") {
					throw new Error("no id");
				}
				return t.id;
			},
		});
		const client = await makeClient({ entities: { sync: [Throwing] } });
		const server = backend();
		await client.fetch(server.list(10));

		await client.runPromise(
			Query.set(server.list(10), [{ id: "t1", status: "Broken" }]),
		);

		expect(statuses(await cached(client, server.list(10)))).toEqual([
			"t1 Broken",
		]);
		const mutation = Mutation.make({
			run: () => Effect.fail("rejected" as const),
			optimistic: () =>
				Query.update(server.list(10), (list) => [
					...list,
					{ id: "t3", status: "Broken" },
				]),
		});
		await client.runPromiseExit(Mutation.run(mutation));
		expect(statuses(await cached(client, server.list(10)))).toEqual([
			"t1 Broken",
		]);
	});

	it("dates a live push made during the query's own fetch as a write", async () => {
		const client = await syncing();
		const server = backend();
		let queue:
			| Queue.Queue<
					(rows: ReadonlyArray<Transaction>) => ReadonlyArray<Transaction>,
					Cause.Done
			  >
			| undefined;
		const listStarted = gate();
		const slowList = gate();
		const live = Query.make({
			key: ["transactions", "live"],
			run: Effect.flatMap(
				Effect.sync(() => {
					listStarted.open();
					return [...server.records.values()];
				}),
				(read) => Effect.as(slowList.wait, read),
			),
			schema: { success: Schema.Array(Transaction) },
			live: Stream.callback<
				(rows: ReadonlyArray<Transaction>) => ReadonlyArray<Transaction>
			>((q) =>
				Effect.sync(() => {
					queue = q;
				}),
			),
			staleTime: "1 hour",
		});
		const unmount = client.registry.mount(live);
		await Effect.runPromise(listStarted.wait);
		// The details fetch starts after the list's, and before the push.
		const detail = slowDetail(server, "t1");
		const pending = client.fetch(detail.query);
		await detail.started;
		await settle();
		Queue.offerUnsafe(queue!, (rows) =>
			rows.map((t) => (t.id === "t1" ? { ...t, status: "Successful" } : t)),
		);
		await settle();
		slowList.open();
		await settle();
		detail.open();
		await pending;

		expect(statuses(await cached(client, live))).toEqual([
			"t1 Successful",
			"t2 Pending",
		]);
		unmount();
	});

	it("dates the copies a write changed when another's id throws", async () => {
		let breaking = false;
		const Flaky = Entity.make(Transaction, {
			id: (t) => {
				if (breaking && t.status === "Broken") {
					throw new Error("no id");
				}
				return t.id;
			},
		});
		const client = await makeClient({ entities: { sync: [Flaky] } });
		const server = backend();
		await client.fetch(server.list(10));
		server.set("t1", "Successful");
		const detail = slowDetail(server, "t1");
		const pending = client.fetch(detail.query);
		await detail.started;

		breaking = true;
		await client.runPromise(
			Query.update(server.list(10), (list) => [
				{ id: "t1", status: "Cancelled" },
				...list.slice(1),
				{ id: "t3", status: "Broken" },
			]),
		);
		breaking = false;
		detail.open();
		await pending;

		// The write is newer than the detail's fetch, which was in flight.
		expect(statuses(await cached(client, server.list(10)))).toEqual([
			"t1 Cancelled",
			"t2 Pending",
			"t3 Broken",
		]);
	});

	it("keeps the fetched value when a listener leaves a copy whose id throws", async () => {
		const Throwing = Entity.make(Transaction, {
			id: (t) => {
				if (t.status === "Broken") {
					throw new Error("no id");
				}
				return t.id;
			},
		});
		const client = await makeClient({
			layer: Layer.merge(
				servicesLayer("hello"),
				Logger.layer([Logger.make(() => {})]),
			),
			entities: { sync: [Throwing] },
		});
		const server = backend();
		await client.fetch(server.list(10));
		await client.fetch(server.list(20));
		// Each list's first write breaks the other, before its own write.
		for (const [limit, other] of [
			[10, 20],
			[20, 10],
		] as const) {
			client.registry.subscribe(server.list(limit), () => {
				setValue(client.registry, server.list(other), [
					{ id: "t1", status: "Broken" },
				]);
			});
		}

		server.set("t1", "Successful");
		expect(await client.fetch(server.detail("t1"))).toEqual({
			id: "t1",
			status: "Successful",
		});
	});

	it("dates a refetch whose page holds a large array", async () => {
		const client = await syncing();
		const server = backend();
		const pages = InfiniteQuery.make({
			key: ["transactions", "large"],
			run: (cursor: number) =>
				Effect.sync(() => ({
					items: [server.records.get(cursor === 0 ? "t1" : "t2")!],
					next: cursor === 0 ? 1 : null,
					scores: Array.from({ length: 200_000 }, () => 0),
				})),
			initialPageParam: 0,
			nextPageParam: (last: { readonly next: number | null }) => last.next,
			schema: { page: Page },
		});
		await client.runPromise(InfiniteQuery.fetchNextPage(pages));
		await client.runPromise(InfiniteQuery.fetchNextPage(pages));
		await client.fetch(server.detail("t2"));

		server.set("t2", "Successful");
		await client.fetch(pages);

		expect(await cached(client, server.detail("t2"))).toEqual({
			id: "t2",
			status: "Successful",
		});
	});

	it("writes every query when a listener of one throws", async () => {
		const client = await makeClient({
			layer: Layer.merge(
				servicesLayer("hello"),
				Logger.layer([Logger.make(() => {})]),
			),
			entities: { sync: [Transactions] },
		});
		const server = backend();
		await client.fetch(server.list(10));
		await client.fetch(server.list(20));
		for (const limit of [10, 20]) {
			client.registry.subscribe(server.list(limit), () => {
				throw new Error("listener");
			});
		}

		server.set("t1", "Successful");
		await client.fetch(server.detail("t1"));

		for (const limit of [10, 20]) {
			expect(statuses(await cached(client, server.list(limit)))).toEqual([
				"t1 Successful",
				"t2 Pending",
			]);
		}
	});
});
