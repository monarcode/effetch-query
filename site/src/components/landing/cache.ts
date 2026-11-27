/*
 * The stage's model of one cached query and the API behind it, as the docs
 * describe them. The first component to read the query starts a fetch;
 * another reading it while the fetch runs joins it, and one reading it while
 * the value is fresh gets the value with no request. A value is fresh for
 * `staleTime` after it lands, then stale: a component mounting, an
 * invalidation, or the page regaining focus then refetches it in the
 * background, and every reader keeps showing the old value until the new
 * one lands. A paused reader keeps what it shows and doesn't count as a
 * use. Times are seconds.
 */

/** From a request leaving to its value landing in the cache. */
export const FETCH = 1.1;
/** How long the mutation's request takes. */
export const PATCH = 0.7;

export interface Todo {
	readonly id: number;
	readonly title: string;
	readonly done: boolean;
}

/** Why a fetch started. */
export type Cause = "mount" | "invalidate" | "mutation" | "focus" | "resume";

export interface Reader {
	readonly id: number;
	readonly kind: string;
	/** The value it shows, by version; 0 before the first lands. */
	shown: number;
	paused: boolean;
}

/** Something that happened, for the page to light. */
export type CacheEvent =
	| { readonly type: "fetch"; readonly cause: Cause }
	| { readonly type: "land"; readonly version: number }
	| { readonly type: "cached"; readonly reader: number }
	| { readonly type: "patch"; readonly todo: number }
	| { readonly type: "patched"; readonly todo: number };

/** The API's todos when the page opens. */
export const TODOS: readonly Todo[] = [
	{ id: 1, title: "Write the release notes", done: true },
	{ id: 2, title: "Review the cache PR", done: false },
	{ id: 3, title: "Book a room for the demo", done: false },
];

/** The simulated API, and two todos a teammate adds later. */
class Api {
	private todos = [...TODOS];
	private readonly later = [
		{ id: 4, title: "Reply to the design review", done: false },
		{ id: 5, title: "Ship 0.1.0", done: false },
	];

	list(): readonly Todo[] {
		return this.todos.map((todo) => ({ ...todo }));
	}

	/** The mutation's PATCH: sets a todo's `done`, as its body says. */
	set(id: number, done: boolean) {
		this.todos = this.todos.map((todo) =>
			todo.id === id ? { ...todo, done } : todo,
		);
	}

	/** Someone else adds a todo, which the next fetch finds. */
	teammate() {
		const next = this.later.shift();
		if (next) this.todos = [...this.todos, next];
	}
}

export class Cache {
	staleTime: number;
	requests = 0;
	patches = 0;
	version = 0;
	landedAt = Number.NEGATIVE_INFINITY;
	fetching:
		| {
				readonly start: number;
				readonly cause: Cause;
				/** What the API sent: the request reads it when it leaves. */
				readonly value: readonly Todo[];
		  }
		| undefined;
	/** Marked out of date: stale whatever `staleTime` says, until a fetch lands. */
	invalidated = false;
	readers: Reader[] = [];
	/** Each version's value, for readers still showing an old one. */
	readonly values = new Map<number, readonly Todo[]>();
	/** Mutations in flight, by todo: when each left, and the `done` it sends. */
	readonly pending = new Map<number, { start: number; done: boolean }>();
	private readonly api = new Api();
	/** A mutation landed during a fetch, so the query fetches again after. */
	private refetch = false;
	private nextId = 0;
	private readonly listeners = new Set<(event: CacheEvent) => void>();

	constructor(staleTime: number) {
		this.staleTime = staleTime;
	}

	on(listener: (event: CacheEvent) => void) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(event: CacheEvent) {
		for (const listener of this.listeners) listener(event);
	}

	/** Seconds of freshness left; 0 when stale or before the first value. */
	freshFor(now: number) {
		if (this.version === 0 || this.invalidated) return 0;
		return Math.max(0, this.staleTime - (now - this.landedAt));
	}

	isStale(now: number) {
		return this.version > 0 && this.freshFor(now) === 0;
	}

	/** Whether a component that isn't paused reads the query. */
	inUse() {
		return this.readers.some((reader) => !reader.paused);
	}

	private fetch(now: number, cause: Cause) {
		if (this.fetching) return false;
		this.fetching = { start: now, cause, value: this.api.list() };
		this.requests += 1;
		this.emit({ type: "fetch", cause });
		return true;
	}

	/** A component starts reading the query. */
	mount(now: number, kind: string) {
		const reader: Reader = {
			id: this.nextId++,
			kind,
			shown: this.version,
			paused: false,
		};
		this.readers.push(reader);
		if (this.version > 0) this.emit({ type: "cached", reader: reader.id });
		if (this.version === 0 || this.isStale(now)) this.fetch(now, "mount");
		return reader;
	}

	unmount(id: number) {
		this.readers = this.readers.filter((reader) => reader.id !== id);
	}

	/** Pauses or resumes a reader; resuming refetches a stale value. */
	pause(now: number, id: number, paused: boolean) {
		const reader = this.readers.find((each) => each.id === id);
		if (!reader || reader.paused === paused) return;
		reader.paused = paused;
		if (paused) return;
		reader.shown = this.version;
		if (this.isStale(now)) this.fetch(now, "resume");
	}

	/** Marks the value stale, and refetches it if a component reads it. */
	invalidate(now: number, cause: Cause = "invalidate") {
		this.invalidated = true;
		if (cause === "invalidate") this.api.teammate();
		return this.inUse() && this.fetch(now, cause);
	}

	/** The page came back into focus: a stale value refetches. */
	focus(now: number) {
		return this.inUse() && this.isStale(now) && this.fetch(now, "focus");
	}

	/**
	 * Runs the component's mutation, which sends the `done` the component
	 * shows flipped, and invalidates the query.
	 */
	toggle(now: number, todo: number, done: boolean) {
		if (this.pending.has(todo)) return;
		this.pending.set(todo, { start: now, done });
		this.patches += 1;
		this.emit({ type: "patch", todo });
	}

	/** Lands the requests whose time has come. */
	tick(now: number) {
		for (const [todo, patch] of this.pending)
			if (now >= patch.start + PATCH) {
				this.pending.delete(todo);
				this.api.set(todo, patch.done);
				this.emit({ type: "patched", todo });
				// The mutation's `invalidates: [todos]`. A fetch already in
				// flight left before the change, so it fetches again after.
				if (this.fetching) this.refetch = true;
				else this.invalidate(now, "mutation");
			}
		if (!this.fetching || now < this.fetching.start + FETCH) return;
		this.landedAt = this.fetching.start + FETCH;
		this.invalidated = false;
		this.version += 1;
		this.values.set(this.version, this.fetching.value);
		this.fetching = undefined;
		for (const reader of this.readers)
			if (!reader.paused) reader.shown = this.version;
		for (const version of this.values.keys())
			if (!this.readers.some((reader) => reader.shown === version))
				if (version !== this.version) this.values.delete(version);
		this.emit({ type: "land", version: this.version });
		if (this.refetch) {
			this.refetch = false;
			this.invalidate(now, "mutation");
		}
	}
}
