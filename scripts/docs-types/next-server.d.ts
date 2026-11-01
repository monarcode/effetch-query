// What the README's Next.js recipe uses from `next/server`, as Next 16
// declares it, so check-docs compiles the recipe without installing Next.
export declare function after<T>(
	task: Promise<T> | (() => T | Promise<T>),
): void;
