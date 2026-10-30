#!/usr/bin/env node
// Plain tsc, not a bundler: bundlers rewrite `export * as Query` into a
// synthetic namespace whose name leaks into consumers' hovers.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "dist");
const bin = (name) => path.join(root, "node_modules", ".bin", name);

rmSync(outDir, { recursive: true, force: true });
execFileSync(bin("tsc"), ["-p", "tsconfig.build.json"], {
	cwd: root,
	stdio: "inherit",
});

const files = readdirSync(outDir, { recursive: true, encoding: "utf8" });
for (const file of files.filter((name) => /\.(d\.ts|js)$/.test(name))) {
	const target = path.join(outDir, file);
	const formatted = execFileSync(
		bin("oxfmt"),
		[`--stdin-filepath=${path.basename(file)}`],
		{ input: readFileSync(target, "utf8"), encoding: "utf8" },
	);
	writeFileSync(target, formatted);
}
