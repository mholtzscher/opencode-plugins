import type { Tool } from "@opencode/schema/tool";
import { Effect } from "effect";

import type { ClassifyOptions } from "./config.js";
import type { BackendSelection } from "./selection.js";
import { Classification } from "./service.js";

/** Capture selection once before classification, including evidence reads and retries. */
export const routeClassification = (
  options: ClassifyOptions,
  selection: BackendSelection,
  services: ReadonlyMap<string, typeof Classification.Service>
) =>
  Classification.of({
    classify: Effect.fn("Classification.route")(function* routeRequest(
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Classification validates external tool input in the selected service.
      value: unknown,
      context: Tool.Context
    ) {
      const selected = yield* selection
        .get(context.sessionID)
        .pipe(Effect.result);
      if (selected._tag === "Failure") {
        return {
          error: {
            attempts: 0,
            code: "INVALID_CONFIG" as const,
            durationMs: 0,
            message: selected.failure.message,
            provider: options.backends[options.defaultBackend].provider,
            retryable: false,
          },
          ok: false as const,
        };
      }
      const { backend } = selected.success;
      const service = services.get(backend);
      if (service === undefined) {
        return {
          error: {
            attempts: 0,
            backend,
            code: "INTERNAL_ERROR" as const,
            durationMs: 0,
            message: "Classify backend service is unavailable.",
            provider: options.backends[backend].provider,
            retryable: false,
          },
          ok: false as const,
        };
      }
      const outcome = yield* service.classify(value, context);
      return outcome.ok
        ? { ok: true as const, result: { ...outcome.result, backend } }
        : { error: { ...outcome.error, backend }, ok: false as const };
    }),
  });
