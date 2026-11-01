import { fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { Page } from "./built-app.js";
import { setCookie } from "./dom.js";
import { type FakeDummyJson, tokenOf } from "./fake.js";

/** A full example app, as the shared tests drive it. */
export interface FullApp {
	/** Requests `url` from the built app, outside the browser environment. */
	readonly get: (url: string, cookie?: string) => Promise<Page>;
	/**
	 * Loads the built app's page and hydrates it with the app from source,
	 * over a fake dummyjson of its own, which it returns: its reads are the
	 * browser's.
	 */
	readonly open: (url: string, cookie?: string) => Promise<FakeDummyJson>;
	/** The app's own reading of the session cookie. */
	readonly readBrowserToken: () => string | undefined;
}

const signedIn = `session=${tokenOf("emilys")}`;

// Not testing-library's `screen`: loading a page swaps in a new body.
const screen = () => within(document.body);

const checkbox = (title: string) =>
	screen().getByRole<HTMLInputElement>("checkbox", { name: title });

const heading = (name: string) => screen().findByRole("heading", { name });

/**
 * The tests the full examples pass: tanstack-start and react-router are one
 * app, with the same pages and behaviour, as tanstack-start-httpclient is.
 */
export const fullAppSuite = (app: FullApp): void => {
	afterEach(() => {
		setCookie(undefined);
		vi.restoreAllMocks();
	});

	it("sends a signed-out visitor to sign in, on the server", async () => {
		const { status, location } = await app.get("/");

		expect([302, 307]).toContain(status);
		expect(location).toBe("/login");
	});

	it("renders the user's todos on the server, and hydrates them without a fetch", async () => {
		const { status, html } = await app.get("/", signedIn);
		expect(status).toBe(200);
		expect(html).toContain("Water the plants");
		expect(html).toContain("Emily Johnson");

		const errors = vi.spyOn(console, "error");
		const browser = await app.open("/", signedIn);

		expect(await heading("My todos")).toBeDefined();
		expect(screen().getAllByRole("checkbox")).toHaveLength(3);
		expect(screen().getByText("Emily Johnson")).toBeDefined();
		expect(errors).not.toHaveBeenCalled();
		expect(browser.reads()).toBe(0);
	});

	it("signs in, and lands on the user's todos", async () => {
		await app.open("/login");

		fireEvent.click(await screen().findByRole("button", { name: "Sign in" }));

		expect(await heading("My todos")).toBeDefined();
		expect(screen().getByText("Emily Johnson")).toBeDefined();
		expect(app.readBrowserToken()).toBe(tokenOf("emilys"));
	});

	it("shows dummyjson's message for a failed sign in", async () => {
		await app.open("/login");
		fireEvent.change(await screen().findByLabelText("Password"), {
			target: { value: "wrong" },
		});

		fireEvent.click(screen().getByRole("button", { name: "Sign in" }));

		expect((await screen().findByRole("alert")).textContent).toBe(
			"Invalid credentials",
		);
		expect(app.readBrowserToken()).toBeUndefined();
	});

	it("toggles a todo at once, and keeps the server's answer", async () => {
		const browser = await app.open("/", signedIn);
		await heading("My todos");
		const release = browser.hold();

		fireEvent.click(checkbox("Water the plants"));

		await waitFor(() =>
			expect(checkbox("Water the plants").checked).toBe(true),
		);
		release();
		await waitFor(() =>
			expect(checkbox("Water the plants").disabled).toBe(false),
		);
		expect(checkbox("Water the plants").checked).toBe(true);
	});

	it("undoes a toggle the server rejects", async () => {
		const browser = await app.open("/", signedIn);
		await heading("My todos");
		browser.failNext(500);

		fireEvent.click(checkbox("Plan the team offsite"));

		expect((await screen().findByRole("alert")).textContent).toBe(
			"The server failed",
		);
		expect(checkbox("Plan the team offsite").checked).toBe(true);
	});

	it("deletes a todo at once", async () => {
		await app.open("/", signedIn);
		const row = checkbox("Read a chapter of a book").closest("li");
		expect(row).not.toBeNull();

		fireEvent.click(
			within(row as HTMLElement).getByRole("button", { name: "Delete" }),
		);

		await waitFor(() =>
			expect(screen().queryByText("Read a chapter of a book")).toBeNull(),
		);
	});

	it("refetches the user's todos on refresh", async () => {
		const browser = await app.open("/", signedIn);
		await heading("My todos");

		fireEvent.click(screen().getByRole("button", { name: "Refresh" }));

		await waitFor(() => expect(browser.reads()).toBe(1));
		expect(
			await screen().findByRole("button", { name: "Refresh" }),
		).toBeDefined();
	});

	it("keeps a change when navigating away and back", async () => {
		const browser = await app.open("/", signedIn);
		await heading("My todos");
		fireEvent.click(checkbox("Water the plants"));
		await waitFor(() =>
			expect(checkbox("Water the plants").disabled).toBe(false),
		);

		fireEvent.click(screen().getByRole("link", { name: "All todos" }));
		await heading("All todos");
		fireEvent.click(screen().getByRole("link", { name: "My todos" }));
		await heading("My todos");

		expect(checkbox("Water the plants").checked).toBe(true);
		// The user's todos were cached; only "All todos" was fetched.
		expect(browser.reads()).toBe(1);
	});

	it("streams a todo the loader started without waiting for it", async () => {
		const { html } = await app.get("/todos/3", signedIn);
		expect(html).toContain("Read a chapter of a book");
		// The todo was sent as a promise, still loading when the page was.
		expect(html).toContain("resultPromise");

		const errors = vi.spyOn(console, "error");
		const browser = await app.open("/todos/3", signedIn);

		expect(await heading("Read a chapter of a book")).toBeDefined();
		expect(errors).not.toHaveBeenCalled();
		expect(browser.reads()).toBe(0);
	});

	it("shows a missing todo's error, with dummyjson's message", async () => {
		await app.open("/todos/999", signedIn);

		expect(await heading("Couldn't load this todo")).toBeDefined();
		expect(screen().getByText("Todo with id '999' not found")).toBeDefined();
	});

	it("loads a todo again with Try again", async () => {
		const browser = await app.open("/todos", signedIn);
		await heading("All todos");
		browser.failNext(500);

		fireEvent.click(
			screen().getByRole("link", { name: "Read a chapter of a book" }),
		);
		expect(await heading("Couldn't load this todo")).toBeDefined();
		expect(screen().getByText("The server failed")).toBeDefined();
		fireEvent.click(screen().getByRole("button", { name: "Try again" }));

		expect(await heading("Read a chapter of a book")).toBeDefined();
	});

	it("shows dummyjson's message when a page fails to load", async () => {
		const browser = await app.open("/", signedIn);
		await heading("My todos");
		browser.failNext(500);

		fireEvent.click(screen().getByRole("link", { name: "All todos" }));

		expect(await heading("Something went wrong")).toBeDefined();
		expect(screen().getByText("The server failed")).toBeDefined();
	});

	it("loads more todos, ten at a time", async () => {
		await app.open("/todos", signedIn);
		await heading("All todos");
		expect(screen().getAllByRole("checkbox")).toHaveLength(10);

		fireEvent.click(screen().getByRole("button", { name: "Load more" }));

		expect(screen().getAllByRole("checkbox")).toHaveLength(10);
		await waitFor(() =>
			expect(screen().getAllByRole("checkbox")).toHaveLength(20),
		);
	});

	it("signs out, back to the sign-in page", async () => {
		await app.open("/", signedIn);

		fireEvent.click(
			await screen().findByRole("button", { name: "Sign out" }),
		);

		expect(await heading("Sign in")).toBeDefined();
		expect(app.readBrowserToken()).toBeUndefined();
	});

	it("shows a page that doesn't exist as not found", async () => {
		for (const url of ["/nothing-here", "/todos/not-a-number"]) {
			const { status, html } = await app.get(url, signedIn);

			expect(status).toBe(404);
			expect(html).toContain("Page not found");
		}
	});
};
