import { expect, vi } from "vitest";

/**
 * Loads a server-rendered page into happy-dom and runs its inline scripts in
 * order, as a browser does, which hands the app its server state. happy-dom
 * runs no scripts itself, so each is evaluated globally, in place, with
 * itself as `document.currentScript`: TanStack's take themselves out, as
 * they do in a browser. The page's bundle isn't loaded: the tests hydrate
 * with the app from source.
 */
export const loadPage = async (
	url: string,
	html: string,
	origin = "http://localhost",
): Promise<void> => {
	const happyDOM = Reflect.get(window, "happyDOM");
	happyDOM.setURL(`${origin}${url}`);
	happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
	const page = new DOMParser().parseFromString(html, "text/html");
	for (const { name, value } of Array.from(page.documentElement.attributes)) {
		document.documentElement.setAttribute(name, value);
	}
	document.documentElement.innerHTML = page.documentElement.innerHTML;
	const inline = Array.from(
		document.querySelectorAll("script:not([src])"),
	).filter((script) => script.getAttribute("type") !== "module");
	for (const script of inline) {
		Object.defineProperty(document, "currentScript", {
			configurable: true,
			get: () => script,
		});
		// oxlint-disable-next-line no-eval -- the page's own scripts, run as the browser runs them
		(0, eval)(script.textContent);
	}
	Reflect.deleteProperty(document, "currentScript");
	// React reveals streamed content on a later frame, as the browser would.
	await vi.waitFor(() =>
		expect(document.querySelector("[id^='S:']")).toBeNull(),
	);
};

/** Sets a cookie, such as `session=…`, or without one clears the session. */
export const setCookie = (cookie: string | undefined): void => {
	document.cookie =
		cookie === undefined
			? "session=; path=/; max-age=0"
			: `${cookie}; path=/`;
};
