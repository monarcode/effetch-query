import type { Config } from "@react-router/dev/config";

export default {
	ssr: true,
	// The whole route manifest is in the page, so navigating needs no
	// request for it.
	routeDiscovery: { mode: "initial" },
} satisfies Config;
