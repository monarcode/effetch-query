import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { identity } from "effect/Function";

import type * as Mutation from "../Mutation.js";
import * as Query from "../Query.js";
import * as QueryClient from "../QueryClient.js";
import { resolveMutationOptions } from "./defaults.js";
import { emit } from "./events.js";
import { runHook } from "./hooks.js";
import { makeRecorded, OptimisticWrites } from "./optimistic.js";
import { ConfigAtom, StateAtom } from "./runtime.js";

export const MutationTypeId = "~@monarcode/effetch-query/Mutation" as const;
export type MutationTypeId = typeof MutationTypeId;

const InternalsId = "~@monarcode/effetch-query/Mutation/internals";

interface MutationWithOptions<Variables, A, E> extends Mutation.Mutation<
	Variables,
	A,
	E
> {
	readonly [InternalsId]: Mutation.MakeOptions<Variables, A, E>;
}

const variance = { _Variables: identity, _A: identity, _E: identity };

export const makeMutation = <Variables, A, E>(
	options: Mutation.MakeOptions<Variables, A, E>,
): Mutation.Mutation<Variables, A, E> => {
	const mutation: MutationWithOptions<Variables, A, E> = {
		[MutationTypeId]: variance,
		[InternalsId]: options,
	};
	return mutation;
};

export const options = <Variables, A, E>(
	mutation: Mutation.Mutation<Variables, A, E>,
): Mutation.MakeOptions<Variables, A, E> =>
	(mutation as MutationWithOptions<Variables, A, E>)[InternalsId];

/**
 * One run of a mutation, in the order of DESIGN.md §4.7. Its optimistic
 * writes are rolled back unless `run` succeeds: when it fails, and when the
 * run ends before then, interrupted or with `optimistic` dying. An
 * interrupted run calls no more callbacks or hooks.
 */
export const execute = <Variables, A, E>(
	mutation: Mutation.Mutation<Variables, A, E>,
	variables: Variables,
): Effect.Effect<A, E, QueryClient.Requirements> =>
	QueryClient.QueryClient.use(({ registry }) => {
		const definition = options(mutation);
		const { mutations } = registry.get(ConfigAtom);
		const { retry } = resolveMutationOptions(definition, mutations.defaults);
		const recorded = makeRecorded();
		const event = { mutation, variables };
		const run = Effect.suspend(() => definition.run(variables));
		const program = Effect.gen(function* () {
			if (definition.optimistic !== undefined) {
				yield* Effect.provideService(
					definition.optimistic(variables),
					OptimisticWrites,
					recorded.writes,
				);
				recorded.close();
			}
			yield* runHook("mutations", mutations.onMutate, event);
			const exit = yield* Effect.exit(
				retry === undefined ? run : Effect.retry(run, retry),
			);
			if (Exit.isSuccess(exit)) {
				recorded.keep();
				if (definition.onSuccess !== undefined) {
					yield* definition.onSuccess(exit.value, variables);
				}
				const { invalidates = [] } = definition;
				yield* Effect.forEach(
					typeof invalidates === "function"
						? invalidates(exit.value, variables)
						: invalidates,
					Query.invalidate,
					{ discard: true },
				);
				yield* runHook("mutations", mutations.onSuccess, {
					...event,
					value: exit.value,
				});
			} else if (Cause.hasInterruptsOnly(exit.cause)) {
				return yield* exit;
			} else {
				recorded.rollback();
				if (definition.onFailure !== undefined) {
					yield* definition.onFailure(exit.cause, variables);
				}
				yield* runHook("mutations", mutations.onFailure, {
					...event,
					cause: exit.cause,
				});
			}
			if (definition.onSettled !== undefined) {
				yield* definition.onSettled(exit, variables);
			}
			yield* runHook("mutations", mutations.onSettled, { ...event, exit });
			return yield* exit;
		});
		const state = registry.get(StateAtom);
		return Effect.withFiber((fiber) => {
			const runId = fiber.id;
			emit(state, { _tag: "MutationStarted", mutation, runId, variables });
			// After a success the writes are kept, and after a failure they're
			// already undone, so this rolls back a run that ended before either.
			return program.pipe(
				Effect.provideService(OptimisticWrites, undefined),
				Effect.ensuring(Effect.sync(recorded.rollback)),
				Effect.onExit((exit) =>
					Effect.sync(() =>
						emit(state, {
							_tag: "MutationSettled",
							mutation,
							runId,
							exit,
						}),
					),
				),
			);
		});
	});
