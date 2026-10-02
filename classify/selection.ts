import type { Plugin } from "@opencode/plugin/effect";
import { Effect, Schema } from "effect";

import type { ClassifyOptions } from "./config.js";
import type { BackendProfile } from "./rpc.js";
import { NameSchema } from "./schemas.js";

const selectionKey = (sessionID: string) => `selection/${sessionID}`;
const storedSelection = Schema.decodeUnknownEffect(
  Schema.Union([NameSchema, Schema.Undefined])
);
const messages = {
  unavailable: "Classify backend selection is unavailable.",
  unknown_backend:
    "Unknown classify backend. Use /classify-backend reset to return to the default.",
  unsupported_backend: "This classify backend is not implemented.",
};

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is a schema class builder, not an error instance constructor.
export class SelectionError extends Schema.TaggedError<SelectionError>()(
  "SelectionError",
  {
    message: Schema.String,
    reason: Schema.Literals([
      "unavailable",
      "unknown_backend",
      "unsupported_backend",
    ]),
  }
) {
  constructor(reason: keyof typeof messages) {
    super({ message: messages[reason], reason });
  }
}

const storageFailure = Effect.fn("BackendSelection.storageFailure")(
  function* storageFailure(
    operation: "storage.get" | "storage.set" | "storage.remove",
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Host storage failures are untyped defects.
    defect: unknown
  ) {
    yield* Effect.logError(
      "Classify backend selection storage failed.",
      defect
    ).pipe(Effect.annotateLogs({ operation }));
    return yield* Effect.fail(new SelectionError("unavailable"));
  }
);

/** Storage is authoritative so every connected client sees the same selection. */
export const createSelection = (
  options: ClassifyOptions,
  storage: Plugin.Context["storage"]
) => {
  const list = () =>
    Object.entries(options.backends).map(([id, backend]): BackendProfile => {
      const profile = {
        available: backend.provider !== "openai-decisions",
        id,
        provider: backend.provider,
      };
      return backend.model === undefined
        ? profile
        : { ...profile, model: backend.model };
    });
  const validate = (backend: string) => {
    if (!Object.hasOwn(options.backends, backend)) {
      return Effect.fail(new SelectionError("unknown_backend"));
    }
    return Effect.void;
  };
  const get = Effect.fn("BackendSelection.get")(function* getSelection(
    sessionID: string
  ) {
    const value = yield* storage
      .get(selectionKey(sessionID))
      .pipe(
        Effect.catchDefect((defect) => storageFailure("storage.get", defect))
      );
    const stored = yield* storedSelection(value).pipe(
      Effect.mapError(() => new SelectionError("unavailable"))
    );
    const backend = stored ?? options.defaultBackend;
    yield* validate(backend);
    return {
      backend,
      defaultBackend: options.defaultBackend,
      overridden: stored !== undefined,
      sessionID,
    };
  });
  const set = Effect.fn("BackendSelection.set")(function* setSelection(
    sessionID: string,
    backend?: string
  ) {
    const selected = backend ?? options.defaultBackend;
    yield* validate(selected);
    if (options.backends[selected].provider === "openai-decisions") {
      return yield* Effect.fail(new SelectionError("unsupported_backend"));
    }
    const write =
      backend === undefined
        ? storage.remove(selectionKey(sessionID))
        : storage.set(selectionKey(sessionID), backend);
    yield* write.pipe(
      Effect.catchDefect((defect) =>
        storageFailure(
          backend === undefined ? "storage.remove" : "storage.set",
          defect
        )
      )
    );
    return {
      backend: selected,
      defaultBackend: options.defaultBackend,
      overridden: backend !== undefined,
      sessionID,
    };
  });
  return { get, list, set };
};

export type BackendSelection = ReturnType<typeof createSelection>;
