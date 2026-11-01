// Serves a built example on a free port, in a process of its own, as its
// server would. The tests give it the framework and the built server entry,
// and read its address from the first line it prints. Node runs the
// TypeScript it imports.
import { pathToFileURL } from "node:url";

import { createRequestHandler } from "react-router";

import { serve } from "./server.ts";

const [framework, entry = ""] = process.argv.slice(2);
const build = await import(pathToFileURL(entry).href);

const server = await serve(
	framework === "react-router"
		? createRequestHandler(build, "production")
		: (request) => build.default.fetch(request),
);
process.stdout.write(`${server.url}\n`);
