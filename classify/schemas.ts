import { Predicate, Schema, SchemaGetter } from "effect";

import type { ClassifierDefinition } from "./config.js";
import { FailureSchema, RequestIDSchema } from "./errors.js";
import {
  DISTRIBUTION_TOLERANCE,
  MAX_BYTES,
  MAX_CHOICES,
  MAX_EVIDENCE_DIFFS,
  MAX_EVIDENCE_PATHS,
  MAX_JSON_DEPTH,
  MAX_LABEL_LENGTH,
  MAX_QUESTIONS,
  MAX_SCORE_LEVELS,
  MIN_CHOICES,
  MIN_SCORE_LEVELS,
  NAME_PATTERN,
} from "./limits.js";
import { providerIDs } from "./providers/ids.js";
import type { JsonValue } from "./types.js";
import { boundedCodec, CONTENT_MESSAGE } from "./validation/codec.js";

export { boundedCodec, schemaIssueDetails } from "./validation/codec.js";

const strict = { parseOptions: { onExcessProperty: "error" as const } };
export const NonblankSchema = Schema.String.check(
  Schema.isPattern(/\S/u, { message: CONTENT_MESSAGE })
);
export const NameSchema = Schema.String.check(Schema.isPattern(NAME_PATTERN));
export const ProbabilitySchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isBetween({ maximum: 1, minimum: 0 })
);
export const CountSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const NonnegativeSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
);

export const JsonValueSchema: Schema.Codec<JsonValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number.check(Schema.isFinite()),
    Schema.String,
    Schema.Array(JsonValueSchema).pipe(Schema.mutable),
    Schema.Record(Schema.String, JsonValueSchema),
  ])
).annotate({ identifier: "ClassifyJsonValue" });

export const ContentSchema = Schema.Union([
  NonblankSchema,
  Schema.Record(Schema.String, JsonValueSchema).check(
    Schema.isMinProperties(1, { message: CONTENT_MESSAGE })
  ),
  Schema.Array(JsonValueSchema)
    .pipe(Schema.mutable)
    .check(Schema.isMinLength(1, { message: CONTENT_MESSAGE })),
]);

const LabelSchema = NonblankSchema.check(Schema.isMaxLength(MAX_LABEL_LENGTH));
const ChoiceMapSchema = Schema.Record(
  Schema.String,
  Schema.NullOr(ContentSchema)
)
  .check(
    Schema.isMinProperties(MIN_CHOICES),
    Schema.isMaxProperties(MAX_CHOICES),
    Schema.makeFilter(
      (value) =>
        Object.keys(value).every(
          (key) => key.trim().length > 0 && key.length <= MAX_LABEL_LENGTH
        ),
      {
        message:
          "Choice labels must be nonblank strings of at most 128 characters.",
        toJsonSchema: () => ({
          propertyNames: {
            maxLength: MAX_LABEL_LENGTH,
            pattern: "\\S",
            type: "string",
          },
        }),
      }
    )
  )
  .annotate(strict);
const ChoiceListSchema = Schema.Array(
  Schema.Struct({
    description: Schema.NullOr(ContentSchema),
    label: LabelSchema,
  }).annotate(strict)
)
  .pipe(Schema.mutable)
  .check(
    Schema.isMinLength(MIN_CHOICES),
    Schema.isMaxLength(MAX_CHOICES),
    Schema.makeFilter(
      (entries) =>
        new Set(entries.map((entry) => entry.label)).size === entries.length,
      { message: "Choice labels must be distinct nonblank strings." }
    )
  );
const ChoiceCriteriaSchema = Schema.Union([
  ChoiceMapSchema,
  ChoiceListSchema,
]).pipe(
  Schema.decodeTo(ChoiceMapSchema, {
    decode: SchemaGetter.transform((value) =>
      Array.isArray(value)
        ? Object.fromEntries(
            value.map((entry) => [entry.label, entry.description])
          )
        : value
    ),
    encode: SchemaGetter.passthrough(),
  })
);
const NoulQuestionSchema = Schema.Struct({
  criteria: Schema.optional(
    Schema.Struct({
      false: Schema.optional(ContentSchema),
      true: Schema.optional(ContentSchema),
    })
      .check(
        Schema.isMinProperties(1, {
          message: 'Noul criteria must define "true", "false", or both.',
        })
      )
      .annotate(strict)
  ),
  instructions: ContentSchema,
  type: Schema.Literal("noul"),
}).annotate(strict);
const ChoiceQuestionSchema = Schema.Struct({
  criteria: ChoiceCriteriaSchema,
  instructions: ContentSchema,
  type: Schema.Literal("choice"),
}).annotate(strict);
const ScoreQuestionSchema = Schema.Struct({
  criteria: Schema.Array(ContentSchema)
    .pipe(Schema.mutable)
    .check(
      Schema.isMinLength(MIN_SCORE_LEVELS, {
        message: "Score requires 2 to 10 ordered levels.",
      }),
      Schema.isMaxLength(MAX_SCORE_LEVELS, {
        message: "Score requires 2 to 10 ordered levels.",
      })
    ),
  instructions: ContentSchema,
  type: Schema.Literal("score"),
}).annotate(strict);
export const QuestionSchema = Schema.Union([
  NoulQuestionSchema,
  ChoiceQuestionSchema,
  ScoreQuestionSchema,
]);
export const nameKeys = Schema.makeFilter<Record<string, JsonValue>>(
  (value) => Object.keys(value).every((key) => NAME_PATTERN.test(key)),
  {
    message: `Question IDs must match ${NAME_PATTERN.source}.`,
    toJsonSchema: () => ({ propertyNames: { pattern: NAME_PATTERN.source } }),
  }
);
export const QuestionsStructure = Schema.Record(Schema.String, QuestionSchema)
  .check(
    Schema.isMinProperties(1),
    Schema.isMaxProperties(MAX_QUESTIONS),
    nameKeys
  )
  .annotate(strict);

const PathSchema = NonblankSchema.check(
  Schema.makeFilter((value) => !value.includes("\0"), {
    message: "Expected nonblank literal paths without null characters.",
  })
);
const PathsSchema = Schema.Array(PathSchema)
  .pipe(Schema.mutable)
  .check(Schema.isMinLength(1), Schema.isMaxLength(MAX_EVIDENCE_PATHS));
const RevisionSchema = NonblankSchema.check(
  Schema.makeFilter(
    (value) => !value.startsWith("-") && !value.includes("\0"),
    {
      message:
        "Expected a nonblank Git revision not starting with a hyphen or containing null characters.",
      toJsonSchema: () => ({ pattern: "^[^-]" }),
    }
  )
);
export const EvidenceSchema = Schema.Struct({
  diffs: Schema.optional(
    Schema.Array(
      Schema.Struct({
        base: RevisionSchema,
        paths: Schema.optional(PathsSchema),
      }).annotate(strict)
    )
      .pipe(Schema.mutable)
      .check(Schema.isMinLength(1), Schema.isMaxLength(MAX_EVIDENCE_DIFFS))
  ),
  files: Schema.optional(PathsSchema),
  text: Schema.optional(ContentSchema),
  type: Schema.Literal("evidence"),
})
  .check(
    Schema.makeFilter(
      (value) =>
        ["text", "files", "diffs"].some((key) => Object.hasOwn(value, key)),
      {
        message: "Evidence requires text, files, or diffs.",
        toJsonSchema: () => ({
          anyOf: [
            { required: ["text"] },
            { required: ["files"] },
            { required: ["diffs"] },
          ],
        }),
      }
    )
  )
  .annotate(strict);
const LiteralStateSchema = ContentSchema.check(
  Schema.makeFilter(
    (value) =>
      Array.isArray(value) ||
      Predicate.isString(value) ||
      Object.getOwnPropertyDescriptor(value, "type")?.value !== "evidence",
    {
      message: "Evidence requires text, files, or diffs.",
      toJsonSchema: () => ({
        not: {
          properties: { type: { const: "evidence" } },
          required: ["type"],
          type: "object",
        },
      }),
    }
  )
);
export const StateStructure = Schema.Union([
  EvidenceSchema,
  LiteralStateSchema,
]);

const AdHocSchema = Schema.Struct({
  questions: QuestionsStructure,
  state: StateStructure,
}).annotate(strict);
export const buildInputSchema = (
  classifiers: Record<string, ClassifierDefinition>
) => {
  const names = Object.keys(classifiers);
  const callerState = names.filter(
    (name) => !Object.hasOwn(classifiers[name], "state")
  );
  const presetState = names.filter((name) =>
    Object.hasOwn(classifiers[name], "state")
  );
  return boundedCodec(
    Schema.Union([
      AdHocSchema,
      ...(callerState.length === 0
        ? []
        : [
            Schema.Struct({
              classifier: Schema.Literals(callerState),
              state: StateStructure,
            }).annotate(strict),
          ]),
      ...(presetState.length === 0
        ? []
        : [
            Schema.Struct({
              classifier: Schema.Literals(presetState),
            }).annotate(strict),
          ]),
    ])
  );
};

export const UsageSchema = Schema.Struct({
  input_tokens: CountSchema,
  output_tokens: CountSchema,
});
const DistributionSchema = Schema.Record(
  Schema.String,
  ProbabilitySchema
).check(
  Schema.makeFilter(
    (value) =>
      Math.abs(Object.values(value).reduce((sum, p) => sum + p, 0) - 1) <
      DISTRIBUTION_TOLERANCE,
    {
      message:
        "Probabilities must sum to one within the distribution tolerance.",
    }
  )
);
const sameKeys = (value: Record<string, JsonValue>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
export const NoulAnswerSchema = Schema.Struct({
  noul: ProbabilitySchema.annotate({
    description: "Probability of yes, not a boolean or confidence score.",
  }),
  type: Schema.Literal("noul"),
});
const ConfidenceSchema = ProbabilitySchema.annotate({
  description:
    "Provider-native uncertainty metric; not probability of correctness or necessarily comparable across providers.",
});
const ChoiceAnswerSchema = Schema.Struct({
  choice: LabelSchema,
  confidence: ConfidenceSchema,
  probabilities: DistributionSchema.check(
    Schema.isMinProperties(MIN_CHOICES),
    Schema.isMaxProperties(MAX_CHOICES),
    Schema.makeFilter(
      (value) =>
        Object.keys(value).every(
          (key) => key.trim().length > 0 && key.length <= MAX_LABEL_LENGTH
        ),
      {
        toJsonSchema: () => ({
          propertyNames: {
            maxLength: MAX_LABEL_LENGTH,
            pattern: "\\S",
            type: "string",
          },
        }),
      }
    )
  ),
  type: Schema.Literal("choice"),
}).check(
  Schema.makeFilter((value) => Object.hasOwn(value.probabilities, value.choice))
);
const scoreIndexNames = Array.from({ length: MAX_SCORE_LEVELS }, (_, index) =>
  String(index)
);
const scoreIndices = Schema.makeFilter<Record<string, JsonValue>>(
  (value) => Object.keys(value).every((key) => scoreIndexNames.includes(key)),
  { toJsonSchema: () => ({ propertyNames: { enum: scoreIndexNames } }) }
);
const NativeScoreSchema = Schema.Struct({
  confidence: ConfidenceSchema,
  legend: Schema.Record(Schema.String, ContentSchema).check(
    Schema.isMinProperties(MIN_SCORE_LEVELS),
    Schema.isMaxProperties(MAX_SCORE_LEVELS),
    scoreIndices
  ),
  probabilities: DistributionSchema.check(
    Schema.isMinProperties(MIN_SCORE_LEVELS),
    Schema.isMaxProperties(MAX_SCORE_LEVELS),
    scoreIndices
  ),
  score: NonnegativeSchema,
  type: Schema.Literal("score"),
});
const scoreAgreement = Schema.makeFilter<typeof NativeScoreSchema.Type>(
  (value) => {
    const keys = Array.from(
      { length: Object.keys(value.legend).length },
      (_, index) => String(index)
    );
    return (
      sameKeys(value.legend, keys) &&
      sameKeys(value.probabilities, keys) &&
      value.score <= keys.length - 1
    );
  }
);
export const ScoreAnswerSchema = Schema.Struct({
  ...NativeScoreSchema.fields,
  scale: Schema.Struct({
    max: Schema.Int.check(
      Schema.isBetween({
        maximum: MAX_SCORE_LEVELS - 1,
        minimum: MIN_SCORE_LEVELS - 1,
      })
    ),
    min: Schema.Literal(0),
  }),
}).check(
  scoreAgreement,
  Schema.makeFilter(
    (value) => value.scale.max === Object.keys(value.legend).length - 1
  )
);
export const AnswerSchema = Schema.Union([
  NoulAnswerSchema,
  ChoiceAnswerSchema,
  ScoreAnswerSchema,
]).annotate({ identifier: "ClassifyAnswer" });

export const buildAnswerSchema = (question: typeof QuestionSchema.Type) => {
  switch (question.type) {
    case "choice": {
      const labels = Object.keys(question.criteria);
      return ChoiceAnswerSchema.check(
        Schema.makeFilter((value) => sameKeys(value.probabilities, labels))
      );
    }
    case "score": {
      const levels = question.criteria.length;
      return NativeScoreSchema.check(
        scoreAgreement,
        Schema.makeFilter(
          (value) => Object.keys(value.legend).length === levels
        )
      ).pipe(
        Schema.decodeTo(ScoreAnswerSchema, {
          decode: SchemaGetter.transform((value) => ({
            ...value,
            scale: { max: levels - 1, min: 0 as const },
          })),
          encode: SchemaGetter.transform(
            ({ scale: _scale, ...value }) => value
          ),
        })
      );
    }
    case "noul": {
      return NoulAnswerSchema;
    }
    default: {
      throw new TypeError("Invalid question type.");
    }
  }
};

const ProviderSchema = Schema.Literals(providerIDs);
const ResultSchema = Schema.Struct({
  answers: Schema.Record(Schema.String, AnswerSchema).check(
    Schema.isMinProperties(1),
    Schema.isMaxProperties(MAX_QUESTIONS),
    nameKeys
  ),
  attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  classifier: Schema.optionalKey(NameSchema),
  durationMs: NonnegativeSchema,
  model: NonblankSchema,
  provider: ProviderSchema,
  requestID: Schema.optionalKey(RequestIDSchema),
  usage: UsageSchema,
}).check(
  Schema.makeFilter((value) => {
    const answers = Object.fromEntries(
      Object.entries(value.answers).map(([id, answer]) => {
        if (answer.type !== "score") {
          return [id, answer];
        }
        const { scale: _scale, ...native } = answer;
        return [id, native];
      })
    );
    return (
      Buffer.byteLength(
        JSON.stringify({ answers, model: value.model, usage: value.usage })
      ) <= MAX_BYTES
    );
  })
);
export const ClassifyOutputStructure = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), result: ResultSchema }),
  Schema.Struct({ error: FailureSchema, ok: Schema.Literal(false) }),
]).annotate({
  ...strict,
  description: `Classification output. Distributions have absolute sum error below ${DISTRIBUTION_TOLERANCE}. Choice must belong to its distribution. Score scale, legend, and distribution use the same contiguous zero-based indices; score is within scale bounds. Native values are never rounded or renormalized.`,
});

export const ClassifyOutputSchema = boundedCodec(ClassifyOutputStructure, {
  maxBytes: MAX_BYTES + 8192,
  maxDepth: MAX_JSON_DEPTH + 1,
});

export type SchemaQuestion = typeof QuestionSchema.Type;
export type SchemaQuestions = typeof QuestionsStructure.Type;
export type SchemaClassifyInput =
  | typeof AdHocSchema.Type
  | {
      readonly classifier: string;
      readonly state?: typeof StateStructure.Type;
    };
export type SchemaClassifyOutput = typeof ClassifyOutputSchema.Type;
