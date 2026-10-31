// @vitest-environment happy-dom
import type { QueryClient } from "@monarcode/effetch-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { App } from "./App.js";
import { makeQueryClient } from "./client.js";
import { type FakeApi, makeFakeApi } from "./fake-api.js";

const clients: Array<QueryClient.QueryClient> = [];

afterEach(async () => {
	cleanup();
	await Promise.all(clients.splice(0).map((client) => client.dispose()));
});

const start = async () => {
	const api = makeFakeApi([
		{ id: 1, title: "Write the README", done: false },
		{ id: 2, title: "Ship the alpha", done: false },
	]);
	const client = makeQueryClient(api.layer);
	clients.push(client);
	render(<App client={client} />);
	await screen.findByText("Write the README");
	return api;
};

const checkbox = (title: string) =>
	screen.getByRole<HTMLInputElement>("checkbox", { name: `Done: ${title}` });

const toggle = (api: FakeApi, title: string) => {
	const release = api.hold();
	fireEvent.click(checkbox(title));
	return release;
};

it("shows the list from the API", async () => {
	await start();

	expect(screen.getByText("Ship the alpha")).toBeTruthy();
});

it("toggles a todo at once, then keeps the server's copy", async () => {
	const api = await start();

	const release = toggle(api, "Write the README");

	await waitFor(() => expect(checkbox("Write the README").checked).toBe(true));
	expect(api.todos.get(1)?.done).toBe(false);
	release();
	await waitFor(() => expect(api.todos.get(1)?.done).toBe(true));
	expect(checkbox("Write the README").checked).toBe(true);
});

it("undoes a toggle the server rejects", async () => {
	const api = await start();
	api.failNext(500);

	const release = toggle(api, "Ship the alpha");

	await waitFor(() => expect(checkbox("Ship the alpha").checked).toBe(true));
	release();
	await screen.findByText("Couldn't save Ship the alpha");
	expect(checkbox("Ship the alpha").checked).toBe(false);
});

it("shows a missing todo, and loads it again on retry", async () => {
	const api = await start();
	const removed = api.todos.get(2);
	api.todos.delete(2);

	fireEvent.click(screen.getByRole("button", { name: "Ship the alpha" }));

	await screen.findByText("This todo doesn't exist.");
	if (removed !== undefined) {
		api.todos.set(2, removed);
	}
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	await screen.findByRole("heading", { name: "Ship the alpha" });
});

it("refreshes the list on demand", async () => {
	const api = await start();
	api.todos.set(3, { id: 3, title: "Plan the beta", done: false });

	const release = api.hold();
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

	await screen.findByRole("button", { name: "Refreshing…" });
	release();
	await screen.findByText("Plan the beta");
	expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
});
