// @vitest-environment happy-dom
import path from "node:path";

import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { getRouter } from "../../../examples/tanstack-start/src/router.js";
import { readBrowserToken } from "../../../examples/tanstack-start/src/session.js";
import {
	fullAppSuite,
	heading,
	screen,
	signedIn,
} from "../harness/app-suite.js";
import { setCookie } from "../harness/dom.js";
import { startApp } from "../harness/start-app.js";

const app = startApp({
	root: path.join(import.meta.dirname, "../../../examples/tanstack-start"),
	getRouter,
	readBrowserToken,
});

fullAppSuite(app);

afterEach(() => {
	setCookie(undefined);
});

it("shows a todo from a list at once, while its own fetch is in progress", async () => {
	const browser = await app.open("/todos", signedIn);
	await heading("All todos");
	const release = browser.hold();
	try {
		fireEvent.click(
			screen().getByRole("link", { name: "Read a chapter of a book" }),
		);

		expect(await heading("Read a chapter of a book")).toBeDefined();
		expect(
			screen().getByRole<HTMLButtonElement>("button", {
				name: "Mark as done",
			}).disabled,
		).toBe(true);
	} finally {
		release();
	}
	await waitFor(() =>
		expect(
			screen().getByRole<HTMLButtonElement>("button", {
				name: "Mark as done",
			}).disabled,
		).toBe(false),
	);
});

it("offers no Try again for a todo that doesn't exist", async () => {
	await app.open("/todos/999", signedIn);

	expect(await heading("Couldn't load this todo")).toBeDefined();
	expect(screen().queryByRole("button", { name: "Try again" })).toBeNull();
});

it("shows Saving… while a change is in progress", async () => {
	const browser = await app.open("/", signedIn);
	await heading("My todos");
	expect(screen().getByRole("status").textContent).toBe("");
	const release = browser.hold();
	try {
		fireEvent.click(
			screen().getByRole("checkbox", { name: "Plan the team offsite" }),
		);

		await waitFor(() =>
			expect(screen().getByRole("status").textContent).toBe("Saving…"),
		);
	} finally {
		release();
	}
	await waitFor(() =>
		expect(screen().getByRole("status").textContent).toBe(""),
	);
});

it("shows a progress bar while a fetch is in progress", async () => {
	const browser = await app.open("/", signedIn);
	await heading("My todos");
	expect(screen().queryByRole("progressbar")).toBeNull();
	const release = browser.hold();
	try {
		fireEvent.click(screen().getByRole("button", { name: "Refresh" }));

		expect(await screen().findByRole("progressbar")).toBeDefined();
	} finally {
		release();
	}
	await waitFor(() => expect(screen().queryByRole("progressbar")).toBeNull());
});

it("titles each page", async () => {
	for (const [url, title, cookie] of [
		["/", "My todos · Todos", signedIn],
		["/todos", "All todos · Todos", signedIn],
		["/todos/3", "Todo #3 · Todos", signedIn],
		["/login", "Sign in · Todos", undefined],
	] as const) {
		const { html } = await app.get(url, cookie);

		expect(html).toContain(`<title>${title}</title>`);
	}
});
