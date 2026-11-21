#!/usr/bin/env node
// Plain tsc, not a bundler: bundlers rewrite `export * as Query` into a
// synthetic namespace whose name leaks into consumers' hovers.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "dist");
const bin = (name) => path.join(root, "node_modules", ".bin", name);

rmSync(outDir, { recursive: true, force: true });
execFileSync(bin("tsc"), ["-p", "tsconfig.build.json"], {
	cwd: root,
	stdio: "inherit",
});

// TypeScript doesn't show the JSDoc of `export * as Query` in a hover: an
// editor shows the module's path instead. A `declare namespace` carries its
// JSDoc, so the entry's .d.ts declares each namespace with its members, as
// Effetch's does. The JavaScript keeps `export * as`; each member stays
// declared in its own module, where Go to Definition lands.
const declareNamespaces = (file) => {
	const program = ts.createProgram([file], {
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		noEmit: true,
		skipLibCheck: true,
	});
	const checker = program.getTypeChecker();
	const source = program.getSourceFile(file);
	let imports = "";
	let body = "";
	let last = 0;
	for (const statement of source.statements) {
		if (
			!ts.isExportDeclaration(statement) ||
			statement.exportClause === undefined ||
			!ts.isNamespaceExport(statement.exportClause)
		) {
			continue;
		}
		const name = statement.exportClause.name.text;
		// `export type * as` has no runtime namespace to declare.
		if (statement.isTypeOnly) {
			throw new Error(`Can't declare the type-only namespace ${name}`);
		}
		const module = checker.getSymbolAtLocation(statement.moduleSpecifier);
		if (module === undefined) {
			throw new Error(`Can't resolve the module of namespace ${name}`);
		}
		const members = checker
			.getExportsOfModule(module)
			.map((member) => member.name)
			.sort();
		// Imported under the namespace's name, so `make` from two modules
		// don't collide.
		imports += `import { ${members.map((member) => `${member} as ${name}_${member}`).join(", ")} } from ${statement.moduleSpecifier.getText(source)};\n`;
		body += `${source.text.slice(last, statement.getStart(source))}declare namespace ${name} {\n\texport { ${members.map((member) => `${name}_${member} as ${member}`).join(", ")} };\n}\nexport { ${name} };`;
		last = statement.end;
	}
	writeFileSync(file, imports + body + source.text.slice(last));
};

declareNamespaces(path.join(outDir, "index.d.ts"));

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
