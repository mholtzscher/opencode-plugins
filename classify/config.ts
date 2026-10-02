import { Effect, Schema } from "effect";

import { BackendSchema, normalizeBackend } from "./backend-config.js";
import { ClassificationError } from "./errors.js";
import {
  nameKeys,
  NonblankSchema,
  QuestionsStructure,
  StateStructure,
} from "./schemas.js";
import { boundedCodec } from "./validation/codec.js";

const strict = { parseOptions: { onExcessProperty: "error" as const } };
const ClassifierDefinitionSchema = Schema.Struct({
  description: NonblankSchema.check(Schema.isMaxLength(512)),
  questions: QuestionsStructure,
  state: Schema.optional(StateStructure),
}).annotate(strict);

const ClassifiersSchema = Schema.Record(
  Schema.String,
  ClassifierDefinitionSchema
)
  .check(Schema.isMaxProperties(32), nameKeys)
  .annotate(strict);

const BackendsSchema = Schema.Record(Schema.String, BackendSchema)
  .check(Schema.isMinProperties(1), Schema.isMaxProperties(32), nameKeys)
  .check(Schema.makeFilter((backends) => !Object.hasOwn(backends, "reset")))
  .annotate(strict);

export const OptionsSchema = boundedCodec(
  Schema.Struct({
    backends: BackendsSchema,
    classifiers: ClassifiersSchema.pipe(
      Schema.withDecodingDefaultKey(Effect.succeed({}))
    ),
    defaultBackend: NonblankSchema,
    maxRetries: Schema.Int.check(
      Schema.isBetween({ maximum: 2, minimum: 0 })
    ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(1))),
    timeoutMs: Schema.Int.check(
      Schema.isBetween({ maximum: 300_000, minimum: 1000 })
    ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(30_000))),
  })
    .check(
      Schema.makeFilter((options) =>
        Object.hasOwn(options.backends, options.defaultBackend)
      )
    )
    .annotate(strict)
);

export type ClassifyOptions = typeof OptionsSchema.Type;
export type { BackendOptions } from "./backend-config.js";
export type ClassifierDefinition = typeof ClassifierDefinitionSchema.Type;

// Normalization can add bytes to an otherwise valid configuration.
const validateSnapshotBounds = Schema.decodeUnknownEffect(
  boundedCodec(Schema.Unknown)
);

const deepFreeze = <Value>(value: Value): Value => {
  if (Object.isExtensible(value)) {
    for (const child of Object.values(new Object(value))) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
};

const invalidConfig = () =>
  new ClassificationError(
    "INVALID_CONFIG",
    "Invalid classify options. Check backend, limits, and classifier definitions; use an environment variable name or key-file path, never literal credentials."
  );

/** Plugin options are fixed at load time. */
export const loadOptions = Effect.fn("loadOptions")(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Plugin options are external input decoded by the options schema.
  function* loadOptions(value: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(OptionsSchema)(value);
    const normalized = yield* Effect.try((): ClassifyOptions => ({
      ...decoded,
      backends: Object.fromEntries(
        Object.entries(decoded.backends).map(([name, backend]) => [
          name,
          normalizeBackend(backend),
        ])
      ),
    }));
    yield* validateSnapshotBounds(normalized);
    return yield* Effect.try(() => deepFreeze(structuredClone(normalized)));
  },
  Effect.mapError(invalidConfig)
);
