import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";

import { afterAll, beforeAll } from "vitest";

import { loadPage, setCookie } from "./dom.js";
import { makeFakeDummyJson } from "./fake.js";
import { type LocalServer, serve } from "./server.js";

/** A built app's response. */
export interface Page {
	readonly status: number;
	readonly location: string | null;
	readonly html: string;
}

export interface BuiltApp {
	/** Requests `url` from the built app, outside the browser environment. */
	readonly get: (url: string, cookie?: string) => Promise<Page>;
	/** Loads the built app's page into happy-dom, at the app's address. */
	readonly load: (url: string, cookie?: string) => Promise<void>;
}

export interface BuiltAppOptions {
	/** The Node script that builds the example, and its arguments. */
	readonly build: ReadonlyArray<string>;
	readonly framework: "tanstack-start" | "react-router";
	/** The built server entry. */
	readonly entry: string;
}

/**
 * Builds an example against a fake dummyjson served over HTTP, then serves
 * the build in a process of its own, as a server would.
 */
export const serveBuiltApp = (options: BuiltAppOptions): BuiltApp => {
	let dummyjson: LocalServer | undefined;
	let app: ChildProcess | undefined;
	let origin = "";

	beforeAll(async () => {
		dummyjson = await serve(makeFakeDummyJson().handle);
		execFileSync(process.execPath, options.build, {
			stdio: "inherit",
			env: { ...process.env, VITE_DUMMYJSON_URL: dummyjson.url },
		});
		const server = spawn(
			process.execPath,
			[
				path.join(import.meta.dirname, "serve.mjs"),
				options.framework,
				options.entry,
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		app = server;
		// The app logs the failures the tests cause, such as a missing todo:
		// its log is kept, and shown only if it doesn't start.
		let log = "";
		server.stderr.on("data", (chunk) => {
			log = (log + String(chunk)).slice(-10_000);
		});
		origin = await new Promise<string>((resolve, reject) => {
			let output = "";
			server.stdout.on("data", (chunk) => {
				output += String(chunk);
				if (output.includes("\n")) {
					resolve(output.trim());
				}
			});
			server.once("exit", (code) =>
				reject(new Error(`The app exited with ${code}:\n${log}`)),
			);
		});
	}, 120_000);

	afterAll(async () => {
		app?.kill();
		await dummyjson?.close();
	});

	const get = (url: string, cookie?: string) =>
		new Promise<Page>((resolve, reject) => {
			http
				.get(
					`${origin}${url}`,
					{ headers: cookie === undefined ? {} : { cookie } },
					(response) => {
						let html = "";
						response.setEncoding("utf8");
						response.on("data", (chunk) => {
							html += chunk;
						});
						response.on("end", () =>
							resolve({
								status: response.statusCode ?? 0,
								location: response.headers.location ?? null,
								html,
							}),
						);
					},
				)
				.on("error", reject);
		});

	return {
		get,
		load: async (url, cookie) => {
			const { html } = await get(url, cookie);
			await loadPage(url, html, origin);
			setCookie(cookie);
		},
	};
};
