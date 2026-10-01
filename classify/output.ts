import {
  DISTRIBUTION_TOLERANCE,
  MAX_BYTES,
  MAX_CHOICES,
  MAX_JSON_DEPTH,
  MAX_LABEL_LENGTH,
  MAX_QUESTIONS,
  MAX_SCORE_LEVELS,
  MIN_CHOICES,
  MIN_SCORE_LEVELS,
  NAME_PATTERN,
} from "./limits.js";
import { providerIDs } from "./providers/ids.js";
import { ERROR_CODES } from "./types.js";
import type { ClassifyOutput, JsonValue } from "./types.js";
import { validateAnswer, validateUsage } from "./validation/answers.js";
import {
  fields,
  isBoundedJsonValue,
  nonblank,
  record,
} from "./validation/json.js";

const probability = { maximum: 1, minimum: 0, type: "number" };
const nonnegative = { minimum: 0, type: "number" };
const count = { minimum: 0, type: "integer" };
const provider = { enum: providerIDs };
const name = { pattern: NAME_PATTERN.source, type: "string" };
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
  maxProperties: MAX_CHOICES,
  minProperties: MIN_CHOICES,
  type: "object",
};
const confidence = {
  ...probability,
  description:
    "Provider-native uncertainty metric; not probability of correctness or necessarily comparable across providers.",
};
const scoreIndices = {
  enum: Array.from({ length: MAX_SCORE_LEVELS }, (_, index) => String(index)),
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
        choice: { ...text, maxLength: MAX_LABEL_LENGTH },
        confidence,
        probabilities: {
          ...probabilities,
          propertyNames: { ...text, maxLength: MAX_LABEL_LENGTH },
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
          maxProperties: MAX_SCORE_LEVELS,
          minProperties: MIN_SCORE_LEVELS,
          propertyNames: scoreIndices,
          type: "object",
        },
        probabilities: {
          ...probabilities,
          maxProperties: MAX_SCORE_LEVELS,
          minProperties: MIN_SCORE_LEVELS,
          propertyNames: scoreIndices,
        },
        scale: {
          additionalProperties: false,
          properties: {
            max: {
              maximum: MAX_SCORE_LEVELS - 1,
              minimum: MIN_SCORE_LEVELS - 1,
              type: "integer",
            },
            min: { const: 0 },
          },
          required: ["min", "max"],
          type: "object",
        },
        score: { maximum: MAX_SCORE_LEVELS - 1, minimum: 0, type: "number" },
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
  description: `Classification output. Distributions have absolute sum error below ${DISTRIBUTION_TOLERANCE}. Choice must belong to its distribution. Score scale, legend, and distribution use the same contiguous zero-based indices; score is within scale bounds. Native values are never rounded or renormalized.`,
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
              maxProperties: MAX_QUESTIONS,
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

const assert: (condition: boolean) => asserts condition = (condition) => {
  if (!condition) {
    throw new TypeError("Invalid classification output.");
  }
};
const isCount = (value: JsonValue, min = 0): value is number =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Parsed JSON numbers must be distinguished to enforce integer metadata.
  typeof value === "number" && Number.isInteger(value) && value >= min;
const isNonnegative = (value: JsonValue): value is number =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Parsed JSON numbers must be distinguished to enforce finite nonnegative metadata.
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const metadata = (
  value: Record<string, JsonValue>,
  minAttempts: number
): void => {
  assert(
    isCount(value.attempts, minAttempts) && isNonnegative(value.durationMs)
  );
  assert(provider.enum.some((id) => id === value.provider));
  if (Object.hasOwn(value, "requestID")) {
    assert(
      nonblank(value.requestID) && REQUEST_ID_PATTERN.test(value.requestID)
    );
  }
};
const validateOutputAnswer = (value: JsonValue): void => {
  const a = record(value);
  if (a.type === "noul") {
    fields(a, ["type", "noul"]);
    validateAnswer(a, { type: "noul" });
    return;
  }
  if (a.type === "choice") {
    fields(a, ["type", "choice", "confidence", "probabilities"]);
    validateAnswer(a, {
      labels: Object.keys(record(a.probabilities)),
      type: "choice",
    });
    return;
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
  validateAnswer(a, {
    levels: Object.keys(legend).length,
    type: "score",
  });
};

const validateSuccess = (value: JsonValue): void => {
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
    assert(nonblank(result.classifier) && NAME_PATTERN.test(result.classifier));
  }
  fields(record(result.usage), ["input_tokens", "output_tokens"]);
  validateUsage(result.usage);
  assert(nonblank(result.model));
  const answers = record(result.answers);
  const entries = Object.entries(answers);
  assert(entries.length >= 1 && entries.length <= MAX_QUESTIONS);
  let nativeBytes = Buffer.byteLength(JSON.stringify(answers));
  for (const [id, answerValue] of entries) {
    assert(NAME_PATTERN.test(id));
    validateOutputAnswer(answerValue);
    // Exclude the public score scale from the native response byte budget.
    const a = record(answerValue);
    if (a.type === "score") {
      nativeBytes -=
        Buffer.byteLength(',"scale":') +
        Buffer.byteLength(JSON.stringify(a.scale));
    }
  }
  // Keep the native byte limit without reconstructing a response or request.
  nativeBytes +=
    Buffer.byteLength('{"answers":,"model":,"usage":}') +
    Buffer.byteLength(JSON.stringify(result.model)) +
    Buffer.byteLength(JSON.stringify(result.usage));
  assert(nativeBytes <= MAX_BYTES);
};
const validateFailure = (value: JsonValue): void => {
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
    nonblank(error.code) && ERROR_CODES.some((code) => code === error.code)
  );
  assert(
    nonblank(error.message) &&
      (error.retryable === true || error.retryable === false)
  );
  if (Object.hasOwn(error, "path")) {
    assert(
      error.path === "" ||
        (nonblank(error.path) && POINTER_PATTERN.test(error.path))
    );
  }
  if (Object.hasOwn(error, "status")) {
    assert(isCount(error.status, 100) && error.status <= 599);
  }
  if (Object.hasOwn(error, "retryAfterMs")) {
    assert(isNonnegative(error.retryAfterMs));
  }
};

const validateClassifyOutput = (
  value: JsonValue
): value is JsonValue & ClassifyOutput => {
  try {
    const output = record(value);
    assert(output.ok === true || output.ok === false);
    fields(output, output.ok ? ["ok", "result"] : ["ok", "error"]);
    if (output.ok) {
      validateSuccess(output.result);
    } else {
      validateFailure(output.error);
    }
    return true;
  } catch {
    return false;
  }
};

/** Parse Code Mode's JSON string (or an already decoded object), validating without changing values. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Code Mode supplies an untrusted value that this boundary must decode and validate.
export const parseClassifyOutput = (raw: unknown): ClassifyOutput => {
  try {
    // String inputs are Code Mode's serialized output; structured values arrive as JSON-domain objects.
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The parser accepts both serialized and already-decoded JSON output.
    const decoded: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    // Allow the envelope and additive metadata around a maximum-size native response.
    if (
      !isBoundedJsonValue(decoded, {
        maxBytes: MAX_BYTES + 8192,
        maxDepth: MAX_JSON_DEPTH + 1,
      }) ||
      !validateClassifyOutput(decoded)
    ) {
      throw new TypeError("Invalid classification output.");
    }
    return decoded;
  } catch {
    // Never include JSON parser errors, upstream values, or submitted content.
    // Causes may contain private JSON or upstream values.
    throw new TypeError("Invalid classification output.");
  }
};
