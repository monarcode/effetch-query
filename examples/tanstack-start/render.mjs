// Renders pages with the built app in a process of its own, as a server
// would, apart from the tests' browser environment, and prints each response
// as JSON. The tests run it: `node render.mjs / /todos/2`.
const { default: server } = await import("./dist/server/server.js");

const pages = [];
for (const url of process.argv.slice(2)) {
	const response = await server.fetch(new Request(`http://localhost${url}`));
	pages.push({
		url,
		status: response.status,
		location: response.headers.get("location"),
		html: await response.text(),
	});
}
process.stdout.write(JSON.stringify(pages));
