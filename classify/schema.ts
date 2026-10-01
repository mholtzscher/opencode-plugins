import type { ClassifierDefinition } from "./config.js";
import {
  type Answer,
  ClassificationError,
  type ClassifyInput,
  type Content,
  type DecisionRequest,
  type DecisionResponse,
  type EvidenceState,
  type Question,
  type Questions,
} from "./types.js";

export const MAX_BYTES = 1024 * 1024;
export const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const invalid: () => never = () => {
  throw new ClassificationError(
    "INVALID_INPUT",
    "Input does not satisfy the classification contract."
  );
};
export function record(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    return invalid();
  }
  return value as Record<string, unknown>;
}
export function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    invalid();
  }
}
export function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Validate before cloning or serializing, so cycles, accessors and excessive depth
// cannot reach JSON.stringify. The byte budget also bounds wide traversals.
export function boundedJson(value: unknown): void {
  const ancestors = new Set<object>();
  let budget = 0;
  const visitArray = (item: unknown[], depth: number): void => {
    if (Object.getOwnPropertyNames(item).length !== item.length + 1) {
      invalid();
    }
    budget += Math.max(0, item.length - 1);
    for (let i = 0; i < item.length; i += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
      if (!(descriptor?.enumerable && "value" in descriptor)) {
        throw new ClassificationError(
          "INVALID_INPUT",
          "Input must contain JSON values, not accessors."
        );
      }
      visit(descriptor.value, depth + 1);
    }
  };
  const visitObject = (item: object, depth: number): void => {
    if (ancestors.has(item) || Object.getOwnPropertySymbols(item).length > 0) {
      invalid();
    }
    ancestors.add(item);
    budget += 2;
    if (Array.isArray(item)) {
      visitArray(item, depth);
    } else {
      record(item);
      budget += Math.max(0, Object.keys(item).length - 1);
      for (const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(item)
      )) {
        if (!(descriptor.enumerable && "value" in descriptor)) {
          invalid();
        }
        budget += Buffer.byteLength(JSON.stringify(key)) + 1;
        visit(descriptor.value, depth + 1);
      }
    }
    ancestors.delete(item);
  };
  const visit = (item: unknown, depth: number): void => {
    if (depth > 32) {
      invalid();
    }
    if (item === null || typeof item === "boolean") {
      budget += String(item).length;
    } else if (typeof item === "string") {
      budget += Buffer.byteLength(JSON.stringify(item));
    } else if (typeof item === "number" && Number.isFinite(item)) {
      budget += String(item).length;
    } else if (typeof item === "object" && item !== null) {
      visitObject(item, depth);
    } else {
      invalid();
    }
    if (budget > MAX_BYTES) {
      invalid();
    }
  };
  visit(value, 0);
}
function content(value: unknown): Content {
  if (nonblank(value)) {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value as Content;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    Object.keys(record(value)).length > 0
  ) {
    return value as Content;
  }
  return invalid();
}
function normalizeQuestion(value: unknown): Question {
  const q = record(value);
  if (q.type !== "choice" || !Array.isArray(q.criteria)) {
    validateQuestion(q);
    return q as Question;
  }
  if (q.criteria.length < 2 || q.criteria.length > 255) {
    invalid();
  }
  const labels = new Set<string>();
  const entries = q.criteria.map((item) => {
    const entry = record(item);
    fields(entry, ["label", "description"]);
    if (
      !nonblank(entry.label) ||
      entry.label.length > 128 ||
      labels.has(entry.label)
    ) {
      invalid();
    }
    labels.add(entry.label);
    return [
      entry.label,
      entry.description === null ? null : content(entry.description),
    ] as const;
  });
  // Object.fromEntries defines own properties, including __proto__, without
  // invoking Object.prototype setters. Never assign these labels with map[key].
  const normalized = { ...q, criteria: Object.fromEntries(entries) };
  validateQuestion(normalized);
  return normalized as Question;
}
function questionMap(value: unknown): Questions {
  const map = record(value);
  const entries = Object.entries(map);
  if (entries.length < 1 || entries.length > 64) {
    invalid();
  }
  return Object.fromEntries(
    entries.map(([id, item]) => {
      if (!NAME_PATTERN.test(id)) {
        invalid();
      }
      return [id, normalizeQuestion(item)];
    })
  );
}
function validateQuestion(value: unknown): void {
  const q = record(value);
  fields(q, ["type", "instructions", "criteria"]);
  content(q.instructions);
  switch (q.type) {
    case "noul": {
      if (!Object.hasOwn(q, "criteria")) {
        return;
      }
      const criteria = record(q.criteria);
      fields(criteria, ["true", "false"]);
      if (Object.keys(criteria).length === 0) {
        invalid();
      }
      Object.values(criteria).forEach(content);
      return;
    }
    case "choice": {
      const criteria = record(q.criteria);
      const labels = Object.keys(criteria);
      if (labels.length < 2 || labels.length > 255) {
        invalid();
      }
      for (const label of labels) {
        if (!nonblank(label) || label.length > 128) {
          invalid();
        }
        if (criteria[label] !== null) {
          content(criteria[label]);
        }
      }
      return;
    }
    case "score": {
      if (
        !Array.isArray(q.criteria) ||
        q.criteria.length < 2 ||
        q.criteria.length > 10
      ) {
        throw new ClassificationError(
          "INVALID_INPUT",
          "Score requires 2 to 10 levels."
        );
      }
      q.criteria.forEach(content);
      return;
    }
    default:
      invalid();
  }
}
export function parseQuestions(value: unknown): Questions {
  boundedJson(value);
  return questionMap(value);
}
export function isEvidence(value: unknown): value is EvidenceState {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "type") &&
    (value as Record<string, unknown>).type === "evidence"
  );
}
function paths(value: unknown): void {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 64 ||
    value.some((path) => !nonblank(path) || path.includes("\0"))
  ) {
    invalid();
  }
}
function validateState(value: unknown): void {
  if (!isEvidence(value)) {
    content(value);
    return;
  }
  const state = record(value);
  fields(state, ["type", "text", "files", "diffs"]);
  if (!["text", "files", "diffs"].some((key) => Object.hasOwn(state, key))) {
    invalid();
  }
  if (Object.hasOwn(state, "text")) {
    content(state.text);
  }
  if (Object.hasOwn(state, "files")) {
    paths(state.files);
  }
  if (Object.hasOwn(state, "diffs")) {
    const { diffs } = state;
    if (!Array.isArray(diffs) || diffs.length === 0 || diffs.length > 16) {
      invalid();
    }
    for (const item of diffs as unknown[]) {
      const diff = record(item);
      fields(diff, ["base", "paths"]);
      if (
        !nonblank(diff.base) ||
        diff.base.startsWith("-") ||
        diff.base.includes("\0")
      ) {
        invalid();
      }
      if (Object.hasOwn(diff, "paths")) {
        paths(diff.paths);
      }
    }
  }
}
export function parseInput(value: unknown): ClassifyInput {
  boundedJson(value);
  const input = record(value);
  fields(input, ["state", "questions", "classifier"]);
  validateState(input.state);
  if (
    Object.hasOwn(input, "questions") === Object.hasOwn(input, "classifier")
  ) {
    invalid();
  }
  if (Object.hasOwn(input, "questions")) {
    return {
      questions: questionMap(input.questions),
      state: input.state as ClassifyInput["state"],
    };
  }
  if (!(nonblank(input.classifier) && NAME_PATTERN.test(input.classifier))) {
    invalid();
  }
  return input as ClassifyInput;
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    invalid();
  }
}
function numberIn(value: unknown, max = 1): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max
  ) {
    return invalid();
  }
  return value;
}
function distribution(value: unknown, keys: string[]): Record<string, number> {
  const map = record(value);
  exactKeys(map, keys);
  const entries = Object.entries(map).map(
    ([key, probability]) => [key, numberIn(probability)] as const
  );
  if (
    Math.abs(
      entries.reduce((sum, [, probability]) => sum + probability, 0) - 1
    ) >= 0.02
  ) {
    invalid();
  }
  return Object.fromEntries(entries);
}
function validateAnswer(value: unknown, question: Question): Answer {
  const answer = record(value);
  if (answer.type !== question.type) {
    invalid();
  }
  if (question.type === "noul") {
    return { noul: numberIn(answer.noul), type: "noul" };
  }
  if (question.type === "choice") {
    const keys = Object.keys(question.criteria);
    if (typeof answer.choice !== "string" || !keys.includes(answer.choice)) {
      invalid();
    }
    return {
      choice: answer.choice as string,
      confidence: numberIn(answer.confidence),
      probabilities: distribution(answer.probabilities, keys),
      type: "choice",
    };
  }
  const keys = question.criteria.map((_, index) => String(index));
  const legend = record(answer.legend);
  exactKeys(legend, keys);
  return {
    confidence: numberIn(answer.confidence),
    legend: Object.fromEntries(
      Object.entries(legend).map(([index, level]) => [index, content(level)])
    ),
    probabilities: distribution(answer.probabilities, keys),
    score: numberIn(answer.score, keys.length - 1),
    type: "score",
  };
}
export function validateResponse(
  value: unknown,
  request: DecisionRequest,
  provider: "typesafe" | "kev"
): DecisionResponse {
  try {
    boundedJson(value);
    const response = record(value);
    if (provider === "kev" && response.truncated === true) {
      throw new ClassificationError(
        "INPUT_TRUNCATED",
        "Kev reported truncated input."
      );
    }
    if (!nonblank(response.model)) {
      invalid();
    }
    const upstream = record(response.answers);
    exactKeys(upstream, Object.keys(request.questions));
    const answers: Record<string, Answer> = Object.create(null);
    for (const [id, question] of Object.entries(request.questions)) {
      answers[id] = validateAnswer(upstream[id], question);
    }
    const usage = record(response.usage);
    for (const field of ["input_tokens", "output_tokens"]) {
      if (
        typeof usage[field] !== "number" ||
        !Number.isInteger(usage[field]) ||
        (usage[field] as number) < 0
      ) {
        invalid();
      }
    }
    return {
      answers,
      model: response.model as string,
      usage: {
        input_tokens: usage.input_tokens as number,
        output_tokens: usage.output_tokens as number,
      },
    };
  } catch (error) {
    if (
      error instanceof ClassificationError &&
      error.failure.code === "INPUT_TRUNCATED"
    ) {
      throw error;
    }
    // biome-ignore lint/style/useErrorCause: Causes can contain upstream payloads and must not escape validation.
    throw new ClassificationError(
      "INVALID_RESPONSE",
      "Provider returned an invalid classification response."
    );
  }
}

export function buildToolInputSchema(
  classifiers: Record<string, ClassifierDefinition>
) {
  const c = {
    anyOf: [
      { minLength: 1, type: "string" },
      { minProperties: 1, type: "object" },
      { minItems: 1, type: "array" },
    ],
  };
  const pathList = {
    items: { minLength: 1, type: "string" },
    maxItems: 64,
    minItems: 1,
    type: "array",
  };
  const state = {
    anyOf: [
      {
        ...c,
        not: {
          properties: { type: { const: "evidence" } },
          required: ["type"],
          type: "object",
        },
      },
      {
        additionalProperties: false,
        anyOf: [
          { required: ["text"] },
          { required: ["files"] },
          { required: ["diffs"] },
        ],
        properties: {
          diffs: {
            items: {
              additionalProperties: false,
              properties: {
                base: { minLength: 1, pattern: "^[^-]", type: "string" },
                paths: pathList,
              },
              required: ["base"],
              type: "object",
            },
            maxItems: 16,
            minItems: 1,
            type: "array",
          },
          files: pathList,
          text: c,
          type: { const: "evidence" },
        },
        required: ["type"],
        type: "object",
      },
    ],
  };
  const question = {
    oneOf: [
      {
        additionalProperties: false,
        properties: {
          criteria: {
            additionalProperties: false,
            minProperties: 1,
            properties: { false: c, true: c },
            type: "object",
          },
          instructions: c,
          type: { const: "noul" },
        },
        required: ["type", "instructions"],
        type: "object",
      },
      {
        additionalProperties: false,
        properties: {
          criteria: {
            anyOf: [
              {
                additionalProperties: { anyOf: [c, { type: "null" }] },
                maxProperties: 255,
                minProperties: 2,
                propertyNames: { maxLength: 128, minLength: 1, type: "string" },
                type: "object",
              },
              {
                items: {
                  additionalProperties: false,
                  properties: {
                    description: { anyOf: [c, { type: "null" }] },
                    label: { maxLength: 128, minLength: 1, type: "string" },
                  },
                  required: ["label", "description"],
                  type: "object",
                },
                maxItems: 255,
                minItems: 2,
                type: "array",
              },
            ],
          },
          instructions: c,
          type: { const: "choice" },
        },
        required: ["type", "instructions", "criteria"],
        type: "object",
      },
      {
        additionalProperties: false,
        properties: {
          criteria: { items: c, maxItems: 10, minItems: 2, type: "array" },
          instructions: c,
          type: { const: "score" },
        },
        required: ["type", "instructions", "criteria"],
        type: "object",
      },
    ],
  };
  const adHoc = {
    additionalProperties: false,
    properties: {
      questions: {
        additionalProperties: question,
        maxProperties: 64,
        minProperties: 1,
        propertyNames: { pattern: NAME_PATTERN.source },
        type: "object",
      },
      state,
    },
    required: ["state", "questions"],
    type: "object" as const,
  };
  const names = Object.keys(classifiers);
  return names.length === 0
    ? adHoc
    : {
        oneOf: [
          adHoc,
          {
            additionalProperties: false,
            properties: {
              classifier: { enum: names, type: "string" },
              state,
            },
            required: ["state", "classifier"],
            type: "object",
          },
        ],
        type: "object" as const,
      };
}
