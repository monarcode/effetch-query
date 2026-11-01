// The access token lives in a cookie the browser can read, so the browser
// can call dummyjson.com itself. A production app would keep it in an
// httpOnly cookie, and send its calls through its own server.
const name = "session";

/** The token in a `Cookie` header, or in `document.cookie`. */
export const readToken = (cookies: string | null): string | undefined =>
	cookies
		?.split("; ")
		.find((cookie) => cookie.startsWith(`${name}=`))
		?.slice(name.length + 1) || undefined;

/** The token in the browser's cookie, if there is one. */
export const readBrowserToken = (): string | undefined =>
	readToken(document.cookie);

export const writeSessionCookie = (token: string): void => {
	document.cookie = `${name}=${token}; path=/; max-age=3600; samesite=lax`;
};

export const clearSessionCookie = (): void => {
	document.cookie = `${name}=; path=/; max-age=0`;
};
