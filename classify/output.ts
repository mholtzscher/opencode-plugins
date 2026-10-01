import {
  boundedJson,
  fields,
  MAX_BYTES,
  NAME_PATTERN,
  nonblank,
  parseQuestions,
  record,
  validateResponse,
} from "./schema.js";
import {
  type ClassifyOutput,
  type Content,
  ERROR_CODES,
  type Question,
} from "./types.js";

const probability = { maximum: 1, minimum: 0, type: "number" };
const nonnegative = { minimum: 0, type: "number" };
const count = { minimum: 0, type: "integer" };
const provider = { enum: ["typesafe", "laya", "openai-decisions"] };
const name = { pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$", type: "string" };
const requestID = { pattern: "^[A-Za-z0-9._:-]{1,256}$", type: "string" };
const REQUEST_ID_PATTERN = new RegExp(requestID.pattern, "u");
const POINTER_PATTERN = /^(?:\/(?:[^~]|~[01])*)*$/u;
const text = { pattern: "\\S", type: "string" };
const content = {
  anyOf: [
    text,
    { minProperties: 1, type: "object" },
    { minItems: 1, type: "array" },
  ],
};
const probabilities = {
  additionalProperties: probability,
  maxProperties: 255,
  minProperties: 2,
  type: "object",
};
const confidence = {
  ...probability,
  description:
    "Provider-native uncertainty metric; not probability of correctness or necessarily comparable across providers.",
};
const answer = {
  oneOf: [
    {
      additionalProperties: false,
      properties: {
        noul: {
          ...probability,
          description: "Probability of yes, not a boolean or confidence score.",
        },
        type: { const: "noul" },
      },
      required: ["type", "noul"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        choice: { ...text, maxLength: 128 },
        confidence,
        probabilities: {
          ...probabilities,
          propertyNames: { ...text, maxLength: 128 },
        },
        type: { const: "choice" },
      },
      required: ["type", "choice", "confidence", "probabilities"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        confidence,
        legend: {
          additionalProperties: content,
          maxProperties: 10,
          minProperties: 2,
          propertyNames: { pattern: "^[0-9]$" },
          type: "object",
        },
        probabilities: {
          ...probabilities,
          maxProperties: 10,
          propertyNames: { pattern: "^[0-9]$" },
        },
        scale: {
          additionalProperties: false,
          properties: {
            max: { maximum: 9, minimum: 1, type: "integer" },
            min: { const: 0 },
          },
          required: ["min", "max"],
          type: "object",
        },
        score: { maximum: 9, minimum: 0, type: "number" },
        type: { const: "score" },
      },
      required: [
        "type",
        "score",
        "scale",
        "legend",
        "confidence",
        "probabilities",
      ],
      type: "object",
    },
  ],
};

/** Structural schema. The parser also checks distribution sums and cross-field consistency. */
export const classifyOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  description:
    "Classification output. Distributions have absolute sum error below 0.02. Choice must belong to its distribution. Score scale, legend, and distribution use the same contiguous zero-based indices; score is within scale bounds. Native values are never rounded or renormalized.",
  oneOf: [
    {
      additionalProperties: false,
      properties: {
        ok: { const: true },
        result: {
          additionalProperties: false,
          properties: {
            answers: {
              additionalProperties: answer,
              maxProperties: 64,
              minProperties: 1,
              propertyNames: name,
              type: "object",
            },
            attempts: { minimum: 1, type: "integer" },
            classifier: name,
            durationMs: nonnegative,
            model: text,
            provider,
            requestID,
            usage: {
              additionalProperties: false,
              properties: { input_tokens: count, output_tokens: count },
              required: ["input_tokens", "output_tokens"],
              type: "object",
            },
          },
          required: [
            "answers",
            "attempts",
            "durationMs",
            "model",
            "provider",
            "usage",
          ],
          type: "object",
        },
      },
      required: ["ok", "result"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        error: {
          additionalProperties: false,
          properties: {
            attempts: count,
            code: { enum: ERROR_CODES },
            durationMs: nonnegative,
            message: text,
            path: { pattern: POINTER_PATTERN.source, type: "string" },
            provider,
            requestID,
            retryAfterMs: nonnegative,
            retryable: { type: "boolean" },
            status: { maximum: 599, minimum: 100, type: "integer" },
          },
          required: [
            "attempts",
            "code",
            "durationMs",
            "message",
            "provider",
            "retryable",
          ],
          type: "object",
        },
        ok: { const: false },
      },
      required: ["ok", "error"],
      type: "object",
    },
  ],
};

function assert(condition: boolean): asserts condition {
  if (!condition) {
    throw new TypeError("Invalid classification output.");
  }
}
function isCount(value: unknown, min = 0): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}
function isNonnegative(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function metadata(value: Record<string, unknown>, minAttempts: number): void {
  assert(
    isCount(value.attempts, minAttempts) && isNonnegative(value.durationMs)
  );
  assert(
    typeof value.provider === "string" && provider.enum.includes(value.provider)
  );
  if (Object.hasOwn(value, "requestID")) {
    assert(
      typeof value.requestID === "string" &&
        REQUEST_ID_PATTERN.test(value.requestID)
    );
  }
}
function outputQuestion(value: unknown): Question {
  const a = record(value);
  const instructions = "Validate classification output.";
  if (a.type === "noul") {
    fields(a, ["type", "noul"]);
    return { instructions, type: "noul" };
  }
  if (a.type === "choice") {
    fields(a, ["type", "choice", "confidence", "probabilities"]);
    return {
      criteria: Object.fromEntries(
        Object.keys(record(a.probabilities)).map((key) => [key, null])
      ),
      instructions,
      type: "choice",
    };
  }
  assert(a.type === "score");
  fields(a, [
    "type",
    "score",
    "scale",
    "legend",
    "confidence",
    "probabilities",
  ]);
  const legend = record(a.legend);
  const scale = record(a.scale);
  fields(scale, ["min", "max"]);
  assert(scale.min === 0 && scale.max === Object.keys(legend).length - 1);
  return {
    criteria: Object.keys(legend).map(
      (_, index) => legend[String(index)]
    ) as Content[],
    instructions,
    type: "score",
  };
}

function validateSuccess(value: unknown): void {
  const result = record(value);
  fields(result, [
    "answers",
    "attempts",
    "classifier",
    "durationMs",
    "model",
    "provider",
    "requestID",
    "usage",
  ]);
  metadata(result, 1);
  if (Object.hasOwn(result, "classifier")) {
    assert(
      typeof result.classifier === "string" &&
        NAME_PATTERN.test(result.classifier)
    );
  }
  fields(record(result.usage), ["input_tokens", "output_tokens"]);
  const answers = record(result.answers);
  const questions = parseQuestions(
    Object.fromEntries(
      Object.entries(answers).map(([id, a]) => [id, outputQuestion(a)])
    ),
    // Synthetic questions can be larger than native probability maps (null vs 0).
    { maxBytes: MAX_BYTES * 2, maxDepth: 32 }
  );
  const nativeAnswers = Object.fromEntries(
    Object.entries(answers).map(([id, a]) => {
      const native = record(a);
      return [
        id,
        Object.fromEntries(
          Object.entries(native).filter(([key]) => key !== "scale")
        ),
      ];
    })
  );
  validateResponse(
    { answers: nativeAnswers, model: result.model, usage: result.usage },
    { questions, state: "Output validation" },
    result.provider === "laya" ? "laya" : "typesafe"
  );
}
function validateFailure(value: unknown): void {
  const error = record(value);
  fields(error, [
    "attempts",
    "code",
    "durationMs",
    "message",
    "path",
    "provider",
    "requestID",
    "retryable",
    "retryAfterMs",
    "status",
  ]);
  metadata(error, 0);
  assert(
    typeof error.code === "string" &&
      (ERROR_CODES as readonly string[]).includes(error.code)
  );
  assert(nonblank(error.message) && typeof error.retryable === "boolean");
  if (Object.hasOwn(error, "path")) {
    assert(typeof error.path === "string" && POINTER_PATTERN.test(error.path));
  }
  if (Object.hasOwn(error, "status")) {
    assert(isCount(error.status, 100) && (error.status as number) <= 599);
  }
  if (Object.hasOwn(error, "retryAfterMs")) {
    assert(isNonnegative(error.retryAfterMs));
  }
}

/** Parse Code Mode's JSON string (or an already decoded object), validating without changing values. */
export function parseClassifyOutput(raw: unknown): ClassifyOutput {
  try {
    const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    // Allow the envelope and additive metadata around a maximum-size native response.
    boundedJson(value, { maxBytes: MAX_BYTES + 8192, maxDepth: 33 });
    const output = record(value);
    assert(typeof output.ok === "boolean");
    fields(output, output.ok ? ["ok", "result"] : ["ok", "error"]);
    if (output.ok) {
      validateSuccess(output.result);
    } else {
      validateFailure(output.error);
    }
    return value as ClassifyOutput;
  } catch {
    // Never include JSON parser errors, upstream values, or submitted content.
    // biome-ignore lint/style/useErrorCause: Causes may contain private JSON or upstream values.
    throw new TypeError("Invalid classification output.");
  }
}
