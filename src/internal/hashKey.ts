import * as Formatter from "effect/Formatter";

import { NonJsonKeyError } from "../HydrationError.js";
import type { Key as QueryKey } from "../Query.js";

const isPlainObject = (value: object): boolean => {
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

/**
 * The string a query is found by across the wire (DESIGN.md §3.12): its key
 * as JSON with object keys sorted, as TanStack's `hashKey`, after a prefix
 * that keeps it apart from other serializable atoms and tells kinds of
 * queries with one key apart. Throws {@link NonJsonKeyError} for a segment
 * that isn't JSON.
 */
export const hashKey = (key: QueryKey, kind?: string | undefined): string => {
	const canonical = (value: unknown): unknown => {
		if (
			value === null ||
			typeof value === "string" ||
			typeof value === "boolean" ||
			(typeof value === "number" && Number.isFinite(value))
		) {
			return value;
		}
		if (Array.isArray(value)) {
			return value.map((item) =>
				item === undefined ? notJson(item) : canonical(item),
			);
		}
		if (typeof value === "object" && isPlainObject(value)) {
			const record = value as Record<string, unknown>;
			return Object.fromEntries(
				Object.keys(record)
					.filter((name) => record[name] !== undefined)
					.sort()
					.map((name) => [name, canonical(record[name])]),
			);
		}
		return notJson(value);
	};
	const notJson = (segment: unknown): never => {
		throw new NonJsonKeyError({
			key,
			segment,
			message: `The query key ${Formatter.format(key)} can't be sent to the browser: ${Formatter.format(segment)} isn't JSON`,
		});
	};
	const prefix =
		kind === undefined ? "effetch-query" : `effetch-query/${kind}`;
	return `${prefix}:${JSON.stringify(key.map(canonical))}`;
};
