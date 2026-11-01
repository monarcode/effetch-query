import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Struct from "effect/Struct";

/**
 * An in-memory dummyjson.com, for the examples' tests: the todos and auth
 * endpoints the apps call, answered as dummyjson answers them. Like the real
 * one, it saves nothing: a write returns its result and leaves the todos as
 * they were.
 */
export interface FakeDummyJson {
	/** Answers a request as dummyjson would. */
	readonly handle: (request: Request) => Promise<Response>;
	/** The fake as the `HttpClient` an app's layer is given. */
	readonly layer: Layer.Layer<HttpClient.HttpClient>;
	/** How many `GET` requests it has answered. */
	readonly reads: () => number;
	/** Holds every response until the returned function is called. */
	readonly hold: () => () => void;
	/** Answers the next request with this status, as a server error would. */
	readonly failNext: (status: number) => void;
}

export interface FakeTodo {
	readonly id: number;
	readonly todo: string;
	readonly completed: boolean;
	readonly userId: number;
}

const users = [
	{
		id: 1,
		username: "emilys",
		password: "emilyspass",
		email: "emily.johnson@x.dummyjson.com",
		firstName: "Emily",
		lastName: "Johnson",
		gender: "female",
		image: "https://dummyjson.com/icon/emilys/128",
	},
	{
		id: 2,
		username: "michaelw",
		password: "michaelwpass",
		email: "michael.williams@x.dummyjson.com",
		firstName: "Michael",
		lastName: "Williams",
		gender: "male",
		image: "https://dummyjson.com/icon/michaelw/128",
	},
] as const;

const titles = [
	"Water the plants",
	"Plan the team offsite",
	"Read a chapter of a book",
	"Call the dentist",
	"Write the release notes",
	"Back up the laptop",
	"Book train tickets",
	"Review the pull request",
	"Buy a birthday present",
	"Clean out the fridge",
	"Update the budget",
	"Go for a run",
	"Fix the leaking tap",
	"Reply to the newsletter",
	"Learn a new recipe",
	"Renew the passport",
	"Sort the photo library",
	"Prepare the slides",
	"Pay the electricity bill",
	"Organise the desk",
	"Try a new coffee place",
	"Practise the guitar",
	"Draft the blog post",
	"Wash the car",
	"Plan the weekend hike",
];

/** The fake's todos: the first three are emilys'. */
export const fakeTodos: ReadonlyArray<FakeTodo> = titles.map((todo, index) => ({
	id: index + 1,
	todo,
	completed: index % 3 === 1,
	userId: index < 3 ? 1 : 2,
}));

/** The access token the fake gives a user when they sign in. */
export const tokenOf = (username: string) => `fake-token-${username}`;

const json = (body: unknown, status = 200) => Response.json(body, { status });

const profile = (user: (typeof users)[number]) =>
	Struct.omit(user, ["password"]);

const page = (todos: ReadonlyArray<FakeTodo>, params: URLSearchParams) => {
	const skip = Number(params.get("skip") ?? 0);
	const limit = Number(params.get("limit") ?? 30);
	return {
		todos: limit === 0 ? todos.slice(skip) : todos.slice(skip, skip + limit),
		total: todos.length,
		skip,
		limit,
	};
};

const answer = async (request: Request): Promise<Response> => {
	const url = new URL(request.url);
	const parts = url.pathname.split("/").filter(Boolean);
	const method = request.method;
	const body = async () => {
		const text = await request.text();
		return text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
	};

	if (parts[0] === "auth") {
		if (method === "POST" && parts[1] === "login") {
			const { username, password } = await body();
			const user = users.find(
				(candidate) =>
					candidate.username === username &&
					candidate.password === password,
			);
			return user === undefined
				? json({ message: "Invalid credentials" }, 400)
				: json({
						...profile(user),
						accessToken: tokenOf(user.username),
						refreshToken: `${tokenOf(user.username)}-refresh`,
					});
		}
		if (method === "GET" && parts[1] === "me") {
			const header = request.headers.get("authorization");
			if (header === null) {
				return json({ message: "Access Token is required" }, 401);
			}
			const user = users.find(
				(candidate) => header === `Bearer ${tokenOf(candidate.username)}`,
			);
			return user === undefined
				? json({ message: "Invalid/expired Token!" }, 401)
				: json(profile(user));
		}
	}

	if (parts[0] === "todos") {
		if (parts.length === 1 && method === "GET") {
			return json(page(fakeTodos, url.searchParams));
		}
		if (parts[1] === "user" && parts[2] !== undefined && method === "GET") {
			const userId = Number(parts[2]);
			return json(
				page(
					fakeTodos.filter((todo) => todo.userId === userId),
					url.searchParams,
				),
			);
		}
		const id = Number(parts[1]);
		const todo = fakeTodos.find((candidate) => candidate.id === id);
		if (todo === undefined) {
			return json({ message: `Todo with id '${parts[1]}' not found` }, 404);
		}
		if (method === "GET") {
			return json(todo);
		}
		if (method === "PATCH" || method === "PUT") {
			return json({ ...todo, ...(await body()) });
		}
		if (method === "DELETE") {
			return json({
				...todo,
				isDeleted: true,
				deletedOn: new Date().toISOString(),
			});
		}
	}

	return json({ message: `Route ${method} ${url.pathname} not found` }, 404);
};

export const makeFakeDummyJson = (): FakeDummyJson => {
	const failures: Array<number> = [];
	let reads = 0;
	let held = Promise.resolve();

	const handle = async (request: Request) => {
		await held;
		if (request.method === "GET") {
			reads += 1;
		}
		const status = failures.shift();
		return status === undefined
			? answer(request)
			: json({ message: "The server failed" }, status);
	};

	const client = HttpClient.make((request, url) =>
		Effect.promise(async () => {
			const body =
				request.body._tag === "Uint8Array"
					? new TextDecoder().decode(request.body.body)
					: undefined;
			const response = await handle(
				new Request(url, {
					method: request.method,
					headers: request.headers,
					...(body === undefined ? {} : { body }),
				}),
			);
			return HttpClientResponse.fromWeb(request, response);
		}),
	);

	return {
		handle,
		layer: Layer.succeed(HttpClient.HttpClient, client),
		reads: () => reads,
		hold: () => {
			let release!: () => void;
			held = new Promise((resolve) => {
				release = resolve;
			});
			return () => {
				release();
				held = Promise.resolve();
			};
		},
		failNext: (status) => {
			failures.push(status);
		},
	};
};
