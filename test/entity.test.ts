import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { Fetch } from "@monarcode/effetch";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fromClient } from "../src/effetch/index.js";
import {
	Entity,
	InfiniteQuery,
	Mutation,
	Query,
	QueryClient,
} from "../src/index.js";
import { applyPlan, findPlan, Remove } from "../src/internal/entity.js";
import { dispose, disposeClients, makeClient, use } from "./helpers.js";
import { servicesLayer, TestApi } from "./services.js";

afterEach(disposeClients);

const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String });
type Todo = typeof Todo.Type;
const Todos = Entity.make(Todo, { id: (todo) => todo.id });

const one: Todo = { id: 1, title: "one" };
const two: Todo = { id: 2, title: "two" };

const rename = (todo: unknown) =>
	(todo as Todo).id === 1 ? { ...(todo as Todo), title: "renamed" } : todo;
const drop = (todo: unknown) => ((todo as Todo).id === 1 ? Remove : todo);

/** The value with the entity renamed (or dropped) where `schema` holds it, or "not reached". */
const write = (
	schema: Schema.Top,
	value: unknown,
	f: (todo: unknown) => unknown = rename,
	entity: SchemaAST.AST = Todo.ast,
) => {
	const plan = findPlan(schema.ast, entity);
	return plan === undefined ? "not reached" : applyPlan(plan, value, f);
};

describe("where an entity is found", () => {
	it("in arrays, nested arrays and tuples", () => {
		expect(write(Schema.Array(Todo), [one, two])).toEqual([
			{ id: 1, title: "renamed" },
			two,
		]);
		expect(write(Schema.Array(Schema.Array(Todo)), [[two], [one]])).toEqual([
			[two],
			[{ id: 1, title: "renamed" }],
		]);
		expect(write(Schema.Tuple([Todo, Schema.String]), [one, "x"])).toEqual([
			{ id: 1, title: "renamed" },
			"x",
		]);
	});

	it("in struct fields, optional and NullOr ones too, and records", () => {
		const renamed = { id: 1, title: "renamed" };
		expect(write(Schema.Struct({ todo: Todo }), { todo: one })).toEqual({
			todo: renamed,
		});
		expect(
			write(Schema.Struct({ todo: Schema.optionalKey(Todo) }), {
				todo: one,
			}),
		).toEqual({ todo: renamed });
		expect(
			write(Schema.Struct({ todo: Schema.optional(Todo) }), { todo: one }),
		).toEqual({ todo: renamed });
		expect(
			write(Schema.Struct({ todo: Schema.NullOr(Todo) }), { todo: null }),
		).toEqual({ todo: null });
		expect(write(Schema.Record(Schema.String, Todo), { a: one })).toEqual({
			a: renamed,
		});
	});

	it("as the whole value", () => {
		expect(write(Todo, one)).toEqual({ id: 1, title: "renamed" });
	});

	it("in the members of a union that hold it, told apart by their schemas", () => {
		const Comment = Schema.Struct({ id: Schema.Finite, body: Schema.String });
		const Item = Schema.Union([
			Schema.Struct({ kind: Schema.Literal("todo"), todo: Todo }),
			Schema.Struct({ kind: Schema.Literal("comment"), comment: Comment }),
		]);
		const items = [
			{ kind: "todo", todo: one },
			{ kind: "comment", comment: { id: 1, body: "hi" } },
		];

		expect(write(Schema.Array(Item), items)).toEqual([
			{ kind: "todo", todo: { id: 1, title: "renamed" } },
			items[1],
		]);
		// A Comment with the same id isn't taken for a Todo.
		expect(
			write(Schema.Union([Todo, Comment]), { id: 1, body: "hi" }),
		).toEqual({ id: 1, body: "hi" });
	});

	it("in a Schema.Class entity and a Schema.Class container, which keeps its class", () => {
		class TodoClass extends Schema.Class<TodoClass>("TodoClass")({
			id: Schema.Finite,
			title: Schema.String,
		}) {}
		class Page extends Schema.Class<Page>("Page")({
			items: Schema.Array(Todo),
		}) {}

		const renamed = write(
			Schema.Array(TodoClass),
			[new TodoClass(one)],
			(todo) => new TodoClass({ ...(todo as TodoClass), title: "renamed" }),
			TodoClass.ast,
		) as ReadonlyArray<TodoClass>;
		const page = write(Page, new Page({ items: [one, two] })) as Page;

		expect(renamed[0]).toBeInstanceOf(TodoClass);
		expect(renamed[0]?.title).toBe("renamed");
		expect(page).toBeInstanceOf(Page);
		expect(page.items).toEqual([{ id: 1, title: "renamed" }, two]);
	});

	it("on the decoded side of a schema that transforms", () => {
		const Due = Schema.Struct({
			id: Schema.Finite,
			due: Schema.DateFromString,
		});
		const Wrapped = Schema.Struct({ data: Schema.Array(Todo) }).pipe(
			Schema.decodeTo(
				Schema.Array(Todo),
				SchemaTransformation.transform({
					decode: (wire: { readonly data: ReadonlyArray<Todo> }) =>
						wire.data,
					encode: (todos: ReadonlyArray<Todo>) => ({ data: todos }),
				}),
			),
		);
		const date = new Date(0);

		expect(write(Wrapped, [one])).toEqual([{ id: 1, title: "renamed" }]);
		expect(
			write(
				Schema.Array(Due),
				[{ id: 1, due: date }],
				(todo) => ({
					...(todo as object),
					seen: true,
				}),
				Due.ast,
			),
		).toEqual([{ id: 1, due: date, seen: true }]);
	});

	it("in a recursive schema, and not in one that never holds it", () => {
		interface Folder {
			readonly todos: ReadonlyArray<Todo>;
			readonly folders: ReadonlyArray<Folder>;
		}
		const Folder: Schema.Codec<Folder> = Schema.Struct({
			todos: Schema.Array(Todo),
			folders: Schema.Array(
				Schema.suspend((): Schema.Codec<Folder> => Folder),
			),
		});
		interface Tree {
			readonly name: string;
			readonly children: ReadonlyArray<Tree>;
		}
		const Tree: Schema.Codec<Tree> = Schema.Struct({
			name: Schema.String,
			children: Schema.Array(Schema.suspend((): Schema.Codec<Tree> => Tree)),
		});

		expect(
			write(Folder, { todos: [], folders: [{ todos: [one], folders: [] }] }),
		).toEqual({
			todos: [],
			folders: [{ todos: [{ id: 1, title: "renamed" }], folders: [] }],
		});
		expect(findPlan(Tree.ast, Todo.ast)).toBeUndefined();
	});

	it("in a copy of its schema that only adds annotations or checks", () => {
		expect(
			write(Schema.Array(Todo.annotate({ title: "Todo" })), [one]),
		).toEqual([{ id: 1, title: "renamed" }]);
		expect(
			write(Schema.Array(Todo.check(Schema.makeFilter(() => true))), [one]),
		).toEqual([{ id: 1, title: "renamed" }]);
	});

	it("not in another schema with the same fields, nor inside Option", () => {
		expect(
			write(
				Schema.Array(
					Schema.Struct({ ...Todo.fields, done: Schema.Boolean }),
				),
				[{ ...one, done: false }],
			),
		).toBe("not reached");
		expect(
			write(Schema.Struct({ todo: Schema.Option(Todo) }), {
				todo: Option.some(one),
			}),
		).toBe("not reached");
	});

	it("returns the same objects where nothing changes", () => {
		const value = { pages: [[two], [one]] };
		const schema = Schema.Struct({
			pages: Schema.Array(Schema.Array(Todo)),
		});

		const next = write(schema, value) as typeof value;

		expect(write(schema, value, (todo) => todo)).toBe(value);
		expect(next.pages[0]).toBe(value.pages[0]);
	});
});

describe("the review's edge cases", () => {
	const User = Schema.Struct({ id: Schema.Finite, name: Schema.String });

	it("removes from a non-empty array, but not its last item", () => {
		const schema = Schema.NonEmptyArray(Todo);

		expect(write(schema, [one, two], drop)).toEqual([two]);
		expect(write(schema, [one], drop)).toEqual([one]);
	});

	it("reaches a Schema.Class container under optionalKey and mutableKey", () => {
		class Page extends Schema.Class<Page>("EdgePage")({
			items: Schema.Array(Todo),
		}) {}
		const renamed = { items: [{ id: 1, title: "renamed" }] };

		expect(
			write(Schema.Struct({ page: Schema.optionalKey(Page) }), {
				page: new Page({ items: [one] }),
			}),
		).toEqual({ page: renamed });
		expect(
			write(Schema.Struct({ page: Schema.mutableKey(Page) }), {
				page: new Page({ items: [one] }),
			}),
		).toEqual({ page: renamed });
	});

	it("gives an index signature only the keys it takes", () => {
		const schema = Schema.StructWithRest(
			Schema.Struct({ owner: User, cursor: Schema.NullOr(Schema.String) }),
			[
				Schema.Record(
					Schema.TemplateLiteral(["todo_", Schema.String]),
					Todo,
				),
				Schema.Record(
					Schema.TemplateLiteral(["user_", Schema.String]),
					User,
				),
			],
		);
		const value = {
			owner: { id: 1, name: "Ada" },
			cursor: null,
			todo_a: one,
			user_a: { id: 1, name: "Grace" },
		};

		expect(write(schema, value)).toEqual({
			...value,
			todo_a: { id: 1, title: "renamed" },
		});
		expect(write(schema, value, drop)).toEqual({
			owner: value.owner,
			cursor: null,
			user_a: value.user_a,
		});
	});

	it("leaves a tuple's elements after its rest", () => {
		const schema = Schema.TupleWithRest(Schema.Tuple([]), [Todo, User]);
		const user = { id: 1, name: "Ada" };

		expect(write(schema, [one, two, user])).toEqual([
			{ id: 1, title: "renamed" },
			two,
			user,
		]);
		expect(write(schema, [one, two, user], drop)).toEqual([two, user]);
	});

	it("keeps a Schema.Class entity's class when f returns a plain copy", () => {
		class TodoClass extends Schema.Class<TodoClass>("PlainCopyTodo")({
			id: Schema.Finite,
			title: Schema.String,
		}) {
			get label() {
				return `#${this.id} ${this.title}`;
			}
		}

		const renamed = write(
			Schema.Array(TodoClass),
			[new TodoClass(one), new TodoClass(two)],
			(todo) => ({ ...(todo as TodoClass), title: "renamed" }),
			TodoClass.ast,
		) as ReadonlyArray<TodoClass>;

		expect(renamed[0]).toBeInstanceOf(TodoClass);
		expect(renamed[0]?.label).toBe("#1 renamed");
	});

	it("passes a class over the entity's struct to f, and removes it whole", () => {
		class TodoClass extends Schema.Class<TodoClass>("EdgeTodo")(Todo) {}
		const schema = Schema.Array(TodoClass);
		const seen: Array<unknown> = [];

		const renamed = write(schema, [new TodoClass(one)], (todo) => {
			seen.push(todo);
			return rename(todo);
		}) as ReadonlyArray<TodoClass>;

		expect(seen[0]).toBeInstanceOf(TodoClass);
		expect(renamed[0]).toBeInstanceOf(TodoClass);
		expect(renamed[0]?.title).toBe("renamed");
		expect(
			write(schema, [new TodoClass(one), new TodoClass(two)], drop),
		).toEqual([new TodoClass(two)]);
	});
});

describe("removing an entity", () => {
	it("drops it from arrays and records, and empties optional and NullOr fields", () => {
		expect(write(Schema.Array(Todo), [one, two], drop)).toEqual([two]);
		expect(
			write(Schema.Record(Schema.String, Todo), { a: one }, drop),
		).toEqual({});
		expect(
			write(
				Schema.Struct({ todo: Schema.optionalKey(Todo) }),
				{ todo: one },
				drop,
			),
		).toEqual({});
		expect(
			write(
				Schema.Struct({ todo: Schema.NullOr(Todo) }),
				{ todo: one },
				drop,
			),
		).toEqual({ todo: null });
	});

	it("leaves it where the schema can't do without it", () => {
		const value = { todo: one, pair: [one, "x"] };

		expect(
			write(
				Schema.Struct({
					todo: Todo,
					pair: Schema.Tuple([Todo, Schema.String]),
				}),
				value,
				drop,
			),
		).toBe(value);
		expect(write(Todo, one, drop)).toBe(Remove);
	});
});

/** A list family and a detail family whose values hold todos. */
const todoQueries = () => {
	let runs = 0;
	const list = Query.family({
		key: ["todos", "list"],
		run: (page: number) =>
			Effect.sync(() => {
				runs++;
				return page === 1 ? [one, two] : [two];
			}),
		schema: { success: Schema.Array(Todo) },
		staleTime: "1 hour",
	});
	const detail = Query.family({
		key: ["todos", "detail"],
		run: (id: number) =>
			Effect.succeed<Todo>(id === 1 ? one : { id, title: `todo ${id}` }),
		schema: { success: Todo },
		staleTime: "1 hour",
	});
	return { list, detail, runs: () => runs };
};

describe("Entity.update", () => {
	it("writes every cached copy, in use or not, and leaves the rest alone", async () => {
		const client = await makeClient();
		const { list, detail } = todoQueries();
		await client.fetch(list(1));
		await client.fetch(list(2));
		await client.fetch(detail(1));
		const unmount = use(client.registry, list(1));
		const untouched = await client.fetch(list(2));

		await client.runPromise(
			Entity.update(Todos, 1, (todo) => ({ ...todo, title: "renamed" })),
		);

		expect(await client.fetch(list(1))).toEqual([
			{ id: 1, title: "renamed" },
			two,
		]);
		expect(await client.fetch(detail(1))).toEqual({
			id: 1,
			title: "renamed",
		});
		expect(await client.fetch(list(2))).toBe(untouched);
		unmount();
	});

	it("skips a query without a schema, and one without a value", async () => {
		const client = await makeClient();
		const bare = Query.make({ key: ["bare"], run: Effect.succeed([one]) });
		const { detail } = todoQueries();
		await client.fetch(bare);

		await client.runPromise(
			Entity.update(Todos, 1, (todo) => ({ ...todo, title: "renamed" })),
		);

		expect(await client.fetch(bare)).toEqual([one]);
		expect(Option.isNone(await client.runPromise(Query.get(detail(1))))).toBe(
			true,
		);
	});

	it("writes an infinite query's loaded pages", async () => {
		const client = await makeClient();
		const Page = Schema.Struct({
			items: Schema.Array(Todo),
			next: Schema.NullOr(Schema.Finite),
		});
		const pages = InfiniteQuery.make({
			key: ["todos", "pages"],
			run: (cursor: number) =>
				Effect.succeed({
					items: cursor === 0 ? [two] : [one],
					next: cursor === 0 ? 1 : null,
				}),
			initialPageParam: 0,
			nextPageParam: (last: typeof Page.Type) => last.next,
			schema: { page: Page },
			staleTime: "1 hour",
		});
		await client.runPromise(InfiniteQuery.fetchNextPage(pages));
		await client.runPromise(InfiniteQuery.fetchNextPage(pages));

		await client.runPromise(
			Entity.update(Todos, 1, (todo) => ({ ...todo, title: "renamed" })),
		);

		const data = await client.fetch(pages);
		expect(data.pages.map((page) => page.items)).toEqual([
			[two],
			[{ id: 1, title: "renamed" }],
		]);
		expect(data.pageParams).toEqual([0, 1]);
	});

	it("writes an Effetch endpoint's queries, through its output", async () => {
		const client = await makeClient({
			layer: servicesLayer("hello", () =>
				Response.json([{ id: 1, title: "fetched" }]),
			),
		});
		const api = fromClient(TestApi);
		const todos = api.query(
			Fetch.endpoint("GET /todos", { output: Schema.Array(Todo) }),
			{ staleTime: "1 hour" },
		);
		await client.fetch(todos());

		await client.runPromise(
			Entity.update(Todos, 1, (todo) => ({ ...todo, title: "renamed" })),
		);

		expect(await client.fetch(todos())).toEqual([
			{ id: 1, title: "renamed" },
		]);
	});

	it("is undone with the rest of a failed mutation's optimistic writes", async () => {
		const client = await makeClient();
		const { list, detail } = todoQueries();
		await client.fetch(list(1));
		await client.fetch(detail(1));
		let during: unknown;
		const failing = Mutation.make({
			run: () =>
				Effect.andThen(
					Effect.promise(async () => {
						during = await client.fetch(detail(1));
					}),
					Effect.fail("offline" as const),
				),
			optimistic: () =>
				Entity.update(Todos, 1, (todo) => ({
					...todo,
					title: "optimistic",
				})),
		});

		await client.runPromiseExit(Mutation.run(failing));

		expect(during).toEqual({ id: 1, title: "optimistic" });
		expect(await client.fetch(list(1))).toEqual([one, two]);
		expect(await client.fetch(detail(1))).toEqual(one);
	});

	it("doesn't reach another client's cache", async () => {
		const first = await makeClient();
		const second = await makeClient();
		const { list } = todoQueries();
		await first.fetch(list(1));
		await second.fetch(list(1));

		await first.runPromise(
			Entity.update(Todos, 1, (todo) => ({ ...todo, title: "renamed" })),
		);

		expect(await second.fetch(list(1))).toEqual([one, two]);
	});

	it("is sent with a server render, and reaches a hydrated query once it's read", async () => {
		const { list } = todoQueries();
		const server = await makeClient();
		await server.fetch(list(1));
		await server.runPromise(
			Entity.update(Todos, 2, (todo) => ({
				...todo,
				title: "on the server",
			})),
		);
		const sent = JSON.parse(JSON.stringify(QueryClient.dehydrate(server)));
		await dispose(server);

		const browser = await makeClient();
		QueryClient.hydrate(browser, sent);
		// Until a query reads it, a value from the server is JSON under a
		// hash, with no schema to search.
		await browser.runPromise(
			Entity.update(Todos, 1, (todo) => ({ ...todo, title: "too early" })),
		);
		const unmount = use(browser.registry, list(1));
		await browser.runPromise(
			Entity.update(Todos, 1, (todo) => ({
				...todo,
				title: "in the browser",
			})),
		);

		expect(await browser.fetch(list(1))).toEqual([
			{ id: 1, title: "in the browser" },
			{ id: 2, title: "on the server" },
		]);
		unmount();
	});
});

describe("what an entity write leaves", () => {
	it("writes nothing when f throws part-way", async () => {
		const client = await makeClient();
		const { list, detail } = todoQueries();
		await client.fetch(list(1));
		await client.fetch(list(2));
		await client.fetch(detail(1));
		let calls = 0;
		const failing = Mutation.make({
			run: () => Effect.void,
			optimistic: () =>
				Entity.update(Todos, 2, (todo) => {
					if (++calls === 2) {
						throw new Error("boom");
					}
					return { ...todo, title: "optimistic" };
				}),
		});

		await client.runPromiseExit(Mutation.run(failing));

		expect(await client.fetch(list(1))).toEqual([one, two]);
		expect(await client.fetch(list(2))).toEqual([two]);
	});

	it("keeps each query's age, so get still takes the copy fetched last", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		const client = await makeClient();
		const { list, detail } = todoQueries();
		await client.fetch(list(1));
		vi.setSystemTime(Date.now() + 1000);
		await client.runPromise(Query.set(detail(2), { id: 2, title: "newer" }));
		vi.setSystemTime(Date.now() + 1000);

		await client.runPromise(
			Entity.update(Todos, 1, (todo) => ({ ...todo, title: "renamed" })),
		);

		expect(await client.runPromise(Entity.get(Todos, 2))).toEqual(
			Option.some({ id: 2, title: "newer" }),
		);
		vi.useRealTimers();
	});

	it("leaves a failed query's failure showing", async () => {
		const client = await makeClient();
		let fail = false;
		const list = Query.make({
			key: ["todos", "failing"],
			run: Effect.suspend(() =>
				fail ? Effect.fail("offline") : Effect.succeed([one]),
			),
			schema: { success: Schema.Array(Todo), error: Schema.String },
		});
		const unmount = use(client.registry, list);
		await client.fetch(list);
		fail = true;
		await client.runPromise(Query.refetch(list));
		expect(AsyncResult.isFailure(client.registry.get(list))).toBe(true);

		await client.runPromise(
			Entity.update(Todos, 1, (todo) => ({ ...todo, title: "renamed" })),
		);

		const result = client.registry.get(list);
		expect(AsyncResult.isFailure(result)).toBe(true);
		expect(AsyncResult.value(result)).toEqual(Option.some([one]));
		unmount();
	});

	it("leaves a stale query stale, and an invalidated one to its refetch", async () => {
		const client = await makeClient();
		let runs = 0;
		const list = Query.make({
			key: ["todos", "stale"],
			run: Effect.sync(() => {
				runs++;
				return [one];
			}),
			schema: { success: Schema.Array(Todo) },
		});
		await client.fetch(list);
		await client.runPromise(Query.invalidate(list));

		await client.runPromise(
			Entity.update(Todos, 1, (todo) => ({ ...todo, title: "renamed" })),
		);
		const unmount = use(client.registry, list);

		await vi.waitFor(() => expect(runs).toBe(2));
		unmount();
	});
});

describe("Entity.set, remove and get", () => {
	it("set replaces copies with the same id, and adds it nowhere", async () => {
		const client = await makeClient();
		const { list } = todoQueries();
		await client.fetch(list(2));

		await client.runPromise(Entity.set(Todos, { id: 1, title: "new" }));
		await client.runPromise(Entity.set(Todos, { id: 2, title: "saved" }));

		expect(await client.fetch(list(2))).toEqual([{ id: 2, title: "saved" }]);
	});

	it("remove drops it from lists, and leaves a detail query's value", async () => {
		const client = await makeClient();
		const { list, detail } = todoQueries();
		await client.fetch(list(1));
		await client.fetch(detail(1));

		await client.runPromise(Entity.remove(Todos, 1));

		expect(await client.fetch(list(1))).toEqual([two]);
		expect(await client.fetch(detail(1))).toEqual(one);
	});

	it("get reads the copy from the query written last", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		const client = await makeClient();
		const { list, detail } = todoQueries();
		await client.fetch(detail(1));
		vi.setSystemTime(Date.now() + 1000);
		await client.fetch(list(1));
		vi.setSystemTime(Date.now() + 1000);
		await client.runPromise(Query.set(detail(1), { id: 1, title: "newest" }));

		expect(await client.runPromise(Entity.get(Todos, 1))).toEqual(
			Option.some({ id: 1, title: "newest" }),
		);
		expect(await client.runPromise(Entity.get(Todos, 3))).toEqual(
			Option.none(),
		);
		vi.useRealTimers();
	});

	it("get is a detail query's placeholder", async () => {
		const client = await makeClient();
		const { list } = todoQueries();
		await client.fetch(list(1));
		const detail = Query.family({
			key: ["todos", "slow"],
			run: (id: number) => Effect.as(Effect.never, { id, title: "" }),
			schema: { success: Todo },
			placeholder: (id) => Entity.get(Todos, id),
		});

		expect(client.registry.get(detail(2))).toMatchObject({
			_tag: "Success",
			value: two,
			waiting: true,
		});
	});
});
