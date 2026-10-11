import type { Tool } from "@opencode/schema/tool";
import { Effect } from "effect";

import { Classification } from "./classification.js";
import type { ClassificationContext } from "./classification.js";
import type { ClassifyOptions } from "./config.js";
import { preserveInterruption } from "./outcome.js";
import { FileSearch } from "./search.js";
import type { BackendSelection } from "./selection.js";

/** Capture a session's backend once for either operation, including reads and retries. */
const selectBackendService = Effect.fn("BackendSelection.selectService")(
  function* selectBackendService<Service>(
    options: ClassifyOptions,
    selection: BackendSelection,
    services: ReadonlyMap<string, Service>,
    context: Pick<Tool.Context, "sessionID">
  ) {
    const selected = yield* selection
      .get(context.sessionID)
      .pipe(preserveInterruption, Effect.result);
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
    return { backend, ok: true as const, service };
  }
);

export const routeClassification = (
  options: ClassifyOptions,
  selection: BackendSelection,
  services: ReadonlyMap<string, typeof Classification.Service>
) =>
  Classification.of({
    classify: Effect.fn("Classification.route")(
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Classification validates external input in the selected service.
      function* routeRequest(value: unknown, context: ClassificationContext) {
        const selected = yield* selectBackendService(
          options,
          selection,
          services,
          context
        );
        if (!selected.ok) {
          return selected;
        }
        const { backend, service } = selected;
        const outcome = yield* service.classify(value, context);
        return outcome.ok
          ? { ok: true as const, result: { ...outcome.result, backend } }
          : { error: { ...outcome.error, backend }, ok: false as const };
      }
    ),
  });

export const routeSearch = (
  options: ClassifyOptions,
  selection: BackendSelection,
  services: ReadonlyMap<string, typeof FileSearch.Service>
) =>
  FileSearch.of({
    search: Effect.fn("FileSearch.route")(
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Search validates external input in the selected service.
      function* routeRequest(value: unknown, context: Tool.Context) {
        const selected = yield* selectBackendService(
          options,
          selection,
          services,
          context
        );
        if (!selected.ok) {
          return selected;
        }
        const { backend, service } = selected;
        const outcome = yield* service.search(value, context);
        return outcome.ok
          ? { ok: true as const, result: { ...outcome.result, backend } }
          : { error: { ...outcome.error, backend }, ok: false as const };
      }
    ),
  });
