// @vitest-environment happy-dom
import path from "node:path";

import { getRouter } from "../../../examples/tanstack-start/src/router.js";
import { readBrowserToken } from "../../../examples/tanstack-start/src/session.js";
import { fullAppSuite } from "../harness/app-suite.js";
import { startApp } from "../harness/start-app.js";

fullAppSuite(
	startApp({
		root: path.join(import.meta.dirname, "../../../examples/tanstack-start"),
		getRouter,
		readBrowserToken,
	}),
);
