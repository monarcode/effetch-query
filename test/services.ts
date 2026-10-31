import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

// The test suite is one TypeScript program, so this augmentation applies to
// every test: queries and clients in the tests run with `Greeting`.
declare module "@monarcode/effetch-query" {
	interface Register {
		readonly services: Greeting;
	}
}

export class Greeting extends Context.Service<
	Greeting,
	{ readonly text: string }
>()("test/Greeting") {}

export const greetingLayer = (text: string): Layer.Layer<Greeting> =>
	Layer.succeed(Greeting, { text });
