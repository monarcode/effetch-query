import * as Headers from "effect/http/Headers";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import * as Fetch from "@monarcode/effetch";

/**
 * How effetch's errors cross from server to browser (DESIGN.md §3.12), for
 * `failures: "include"`. Their own schemas can't: `HttpError`'s headers and
 * `NetworkError`'s platform `cause` aren't JSON, nor is `DecodeError`'s
 * issue. So each goes as a struct of what is, and comes back as the class:
 * an `HttpError` without headers, so `set-cookie` and the like never reach
 * the page, its body encoded with the endpoint's error schema; the others
 * without `cause` or `issue`. URLs and response text do go. A plugin's own
 * error has no schema here, so a query failing with one isn't sent.
 */
export const wireErrors = (
	body: Schema.Codec<unknown, unknown> | undefined,
): Schema.Codec<unknown, unknown> =>
	Schema.Union([
		Schema.TaggedStruct("HttpError", {
			method: Schema.String,
			url: Schema.String,
			status: Schema.Finite,
			text: Schema.String,
			body: Schema.optionalKey(body ?? Schema.Json),
		}).pipe(
			Schema.decodeTo(
				Schema.instanceOf(Fetch.HttpError),
				SchemaTransformation.transform({
					decode: ({ method, url, status, text, body }) =>
						new Fetch.HttpError({
							method,
							url,
							status,
							text,
							body,
							headers: Headers.empty,
						}),
					encode: ({ method, url, status, text, body }) => ({
						_tag: "HttpError" as const,
						method,
						url,
						status,
						text,
						...(body === undefined ? {} : { body }),
					}),
				}),
			),
		),
		Schema.TaggedStruct("NetworkError", {
			method: Schema.String,
			url: Schema.String,
		}).pipe(
			Schema.decodeTo(
				Schema.instanceOf(Fetch.NetworkError),
				SchemaTransformation.transform({
					decode: ({ method, url }) =>
						new Fetch.NetworkError({ method, url, cause: undefined }),
					encode: ({ method, url }) => ({
						_tag: "NetworkError" as const,
						method,
						url,
					}),
				}),
			),
		),
		Schema.TaggedStruct("DecodeError", {
			method: Schema.String,
			url: Schema.String,
			status: Schema.Finite,
			message: Schema.String,
		}).pipe(
			Schema.decodeTo(
				Schema.instanceOf(Fetch.DecodeError),
				SchemaTransformation.transform({
					decode: ({ method, url, status, message }) =>
						new Fetch.DecodeError({
							method,
							url,
							status,
							message,
							issue: undefined,
						}),
					encode: ({ method, url, status, message }) => ({
						_tag: "DecodeError" as const,
						method,
						url,
						status,
						message,
					}),
				}),
			),
		),
	]) as unknown as Schema.Codec<unknown, unknown>;
