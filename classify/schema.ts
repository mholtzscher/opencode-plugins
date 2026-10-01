import type { ClassifierDefinition } from "./config.js";
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

function invalid(
  path = "",
  message = "Input does not satisfy the classification contract."
): never {
  throw new ClassificationError("INVALID_INPUT", message, false, { path });
}
export function record(value: unknown, path = ""): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    return invalid(path, "Expected a JSON object.");
  }
  return value as Record<string, unknown>;
}
export function fields(
  value: Record<string, unknown>,
  allowed: string[],
  path = ""
) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    invalid(path, "Object contains unsupported fields.");
  }
}
export function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Validate before cloning or serializing, so cycles, accessors and excessive depth
// cannot reach JSON.stringify. The byte budget also bounds wide traversals.
export function boundedJson(
  value: unknown,
  limits = { maxBytes: MAX_BYTES, maxDepth: MAX_JSON_DEPTH }
): void {
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
    if (depth > limits.maxDepth) {
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
    if (budget > limits.maxBytes) {
      invalid();
    }
  };
  visit(value, 0);
}
function content(value: unknown, path = ""): Content {
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
  return invalid(
    path,
    "Expected a nonblank string, nonempty JSON object, or nonempty JSON array."
  );
}
function normalizeQuestion(value: unknown, path: string): Question {
  const q = record(value, path);
  if (q.type !== "choice" || !Array.isArray(q.criteria)) {
    validateQuestion(q, path);
    return q as Question;
  }
  if (q.criteria.length < MIN_CHOICES || q.criteria.length > MAX_CHOICES) {
    invalid(
      `${path}/criteria`,
      `Choice requires ${MIN_CHOICES}–${MAX_CHOICES} distinct labels.`
    );
  }
  const labels = new Set<string>();
  const entries = q.criteria.map((item, index) => {
    const entryPath = `${path}/criteria/${index}`;
    const entry = record(item, entryPath);
    fields(entry, ["label", "description"], entryPath);
    if (
      !nonblank(entry.label) ||
      entry.label.length > MAX_LABEL_LENGTH ||
      labels.has(entry.label)
    ) {
      invalid(
        `${entryPath}/label`,
        `Choice labels must be distinct nonblank strings of at most ${MAX_LABEL_LENGTH} characters.`
      );
    }
    labels.add(entry.label);
    return [
      entry.label,
      entry.description === null
        ? null
        : content(entry.description, `${entryPath}/description`),
    ] as const;
  });
  // Object.fromEntries defines own properties, including __proto__, without
  // invoking Object.prototype setters. Never assign these labels with map[key].
  const normalized = { ...q, criteria: Object.fromEntries(entries) };
  validateQuestion(normalized, path);
  return normalized as Question;
}
function questionMap(value: unknown, path = "/questions"): Questions {
  const map = record(value, path);
  const entries = Object.entries(map);
  if (entries.length < 1 || entries.length > MAX_QUESTIONS) {
    invalid(path, `Supply 1–${MAX_QUESTIONS} independent questions.`);
  }
  return Object.fromEntries(
    entries.map(([id, item]) => {
      if (!NAME_PATTERN.test(id)) {
        invalid(path, `Question IDs must match ${NAME_PATTERN.source}.`);
      }
      return [id, normalizeQuestion(item, `${path}/${id}`)];
    })
  );
}
function validateChoiceCriteria(value: unknown, path: string): void {
  const criteria = record(value, path);
  const labels = Object.keys(criteria);
  if (labels.length < MIN_CHOICES || labels.length > MAX_CHOICES) {
    invalid(
      path,
      `Choice requires ${MIN_CHOICES}–${MAX_CHOICES} distinct labels.`
    );
  }
  for (const label of labels) {
    if (!nonblank(label) || label.length > MAX_LABEL_LENGTH) {
      invalid(
        path,
        `Choice labels must be nonblank strings of at most ${MAX_LABEL_LENGTH} characters.`
      );
    }
    if (criteria[label] !== null) {
      content(criteria[label], path);
    }
  }
}
function validateQuestion(value: unknown, path: string): void {
  const q = record(value, path);
  fields(q, ["type", "instructions", "criteria"], path);
  content(q.instructions, `${path}/instructions`);
  const criteriaPath = `${path}/criteria`;
  switch (q.type) {
    case "noul": {
      if (!Object.hasOwn(q, "criteria")) {
        return;
      }
      const criteria = record(q.criteria, criteriaPath);
      fields(criteria, ["true", "false"], criteriaPath);
      if (Object.keys(criteria).length === 0) {
        invalid(
          criteriaPath,
          'Noul criteria must define "true", "false", or both.'
        );
      }
      for (const [key, description] of Object.entries(criteria)) {
        content(description, `${criteriaPath}/${key}`);
      }
      return;
    }
    case "choice": {
      validateChoiceCriteria(q.criteria, criteriaPath);
      return;
    }
    case "score": {
      if (
        !Array.isArray(q.criteria) ||
        q.criteria.length < MIN_SCORE_LEVELS ||
        q.criteria.length > MAX_SCORE_LEVELS
      ) {
        invalid(
          criteriaPath,
          `Score requires ${MIN_SCORE_LEVELS} to ${MAX_SCORE_LEVELS} ordered levels.`
        );
      }
      q.criteria.forEach((level, index) => {
        content(level, `${criteriaPath}/${index}`);
      });
      return;
    }
    default:
      invalid(
        `${path}/type`,
        'Question type must be "noul", "choice", or "score".'
      );
  }
}
export function parseQuestions(
  value: unknown,
  limits?: { maxBytes: number; maxDepth: number }
): Questions {
  boundedJson(value, limits);
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
function paths(value: unknown, path: string): void {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_EVIDENCE_PATHS ||
    value.some((item) => !nonblank(item) || item.includes("\0"))
  ) {
    invalid(
      path,
      `Expected 1–${MAX_EVIDENCE_PATHS} nonblank literal paths without null characters.`
    );
  }
}
export function validateState(value: unknown, path = "/state"): void {
  if (!isEvidence(value)) {
    content(value, path);
    return;
  }
  const state = record(value, path);
  fields(state, ["type", "text", "files", "diffs"], path);
  if (!["text", "files", "diffs"].some((key) => Object.hasOwn(state, key))) {
    invalid(path, "Evidence requires text, files, or diffs.");
  }
  if (Object.hasOwn(state, "text")) {
    content(state.text, `${path}/text`);
  }
  if (Object.hasOwn(state, "files")) {
    paths(state.files, `${path}/files`);
  }
  if (Object.hasOwn(state, "diffs")) {
    const { diffs } = state;
    if (
      !Array.isArray(diffs) ||
      diffs.length === 0 ||
      diffs.length > MAX_EVIDENCE_DIFFS
    ) {
      invalid(`${path}/diffs`, `Expected 1–${MAX_EVIDENCE_DIFFS} Git diffs.`);
    }
    for (const [index, item] of diffs.entries()) {
      const diffPath = `${path}/diffs/${index}`;
      const diff = record(item, diffPath);
      fields(diff, ["base", "paths"], diffPath);
      if (
        !nonblank(diff.base) ||
        diff.base.startsWith("-") ||
        diff.base.includes("\0")
      ) {
        invalid(
          `${diffPath}/base`,
          "Expected a nonblank Git revision not starting with a hyphen or containing null characters."
        );
      }
      if (Object.hasOwn(diff, "paths")) {
        paths(diff.paths, `${diffPath}/paths`);
      }
    }
  }
}
export function parseInput(value: unknown): ClassifyInput {
  boundedJson(value);
  const input = record(value);
  fields(input, ["state", "questions", "classifier"]);
  if (
    Object.hasOwn(input, "questions") === Object.hasOwn(input, "classifier")
  ) {
    invalid("", "Supply exactly one of questions or classifier.");
  }
  if (Object.hasOwn(input, "questions")) {
    validateState(input.state);
    return {
      questions: questionMap(input.questions),
      state: input.state as Content | EvidenceState,
    };
  }
  if (!(nonblank(input.classifier) && NAME_PATTERN.test(input.classifier))) {
    invalid(
      "/classifier",
      `Classifier names must match ${NAME_PATTERN.source}.`
    );
  }
  if (Object.hasOwn(input, "state")) {
    validateState(input.state);
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
    ) >= DISTRIBUTION_TOLERANCE
  ) {
    invalid();
  }
  return Object.fromEntries(entries);
}
export type AnswerContract =
  | { type: "noul" }
  | { type: "choice"; labels: string[] }
  | { type: "score"; levels: number };

// Shared measurements; callers own field policies and request agreement.
export function validateAnswer(
  value: unknown,
  contract: AnswerContract
): Answer {
  const answer = record(value);
  if (answer.type !== contract.type) {
    invalid();
  }
  if (contract.type === "noul") {
    return { noul: numberIn(answer.noul), type: "noul" };
  }
  if (contract.type === "choice") {
    const keys = contract.labels;
    if (
      keys.length < MIN_CHOICES ||
      keys.length > MAX_CHOICES ||
      keys.some((key) => !nonblank(key) || key.length > MAX_LABEL_LENGTH)
    ) {
      invalid();
    }
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
  if (
    !Number.isInteger(contract.levels) ||
    contract.levels < MIN_SCORE_LEVELS ||
    contract.levels > MAX_SCORE_LEVELS
  ) {
    invalid();
  }
  const keys = Array.from({ length: contract.levels }, (_, index) =>
    String(index)
  );
  const legend = record(answer.legend);
  exactKeys(legend, keys);
  return {
    confidence: numberIn(answer.confidence),
    legend: Object.fromEntries(
      Object.entries(legend).map(([index, level]) => [index, content(level)])
    ),
    probabilities: distribution(answer.probabilities, keys),
    scale: { max: keys.length - 1, min: 0 },
    score: numberIn(answer.score, keys.length - 1),
    type: "score",
  };
}
export function validateUsage(value: unknown): DecisionResponse["usage"] {
  const usage = record(value);
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
    input_tokens: usage.input_tokens as number,
    output_tokens: usage.output_tokens as number,
  };
}
export function validateResponse(
  value: unknown,
  request: DecisionRequest,
  provider: "typesafe" | "laya",
  attempts = 1
): DecisionResponse {
  try {
    boundedJson(value);
    const response = record(value);
    if (provider === "laya" && response.truncated === true) {
      throw new ClassificationError(
        "INPUT_TRUNCATED",
        "Laya reported truncated input."
      );
    }
    if (!nonblank(response.model)) {
      invalid();
    }
    const upstream = record(response.answers);
    exactKeys(upstream, Object.keys(request.questions));
    const answers: Record<string, Answer> = Object.create(null);
    for (const [id, question] of Object.entries(request.questions)) {
      let contract: AnswerContract;
      switch (question.type) {
        case "choice":
          contract = {
            labels: Object.keys(question.criteria),
            type: question.type,
          };
          break;
        case "score":
          contract = { levels: question.criteria.length, type: question.type };
          break;
        default:
          contract = { type: question.type };
      }
      answers[id] = validateAnswer(upstream[id], contract);
    }
    const usage = validateUsage(response.usage);
    return {
      answers,
      attempts,
      model: response.model as string,
      usage,
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
    description:
      "A nonblank string, nonempty JSON object, or nonempty JSON array. Nested values must be JSON (finite numbers only).",
  };
  const pathList = {
    description: `1–${MAX_EVIDENCE_PATHS} literal paths; no glob expansion or URL fetching.`,
    items: { minLength: 1, type: "string" },
    maxItems: MAX_EVIDENCE_PATHS,
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
            description: `1–${MAX_EVIDENCE_DIFFS} Git diffs against the tracked working tree, including staged and unstaged changes but excluding untracked files.`,
            items: {
              additionalProperties: false,
              properties: {
                base: {
                  description: "Git revision to compare, for example HEAD.",
                  minLength: 1,
                  pattern: "^[^-]",
                  type: "string",
                },
                paths: {
                  ...pathList,
                  description:
                    "Optional literal paths relative to the session directory; cannot escape it. Omit for all tracked changes in the session's Git scope.",
                },
              },
              required: ["base"],
              type: "object",
            },
            maxItems: MAX_EVIDENCE_DIFFS,
            minItems: 1,
            type: "array",
          },
          files: {
            ...pathList,
            description: `1–${MAX_EVIDENCE_PATHS} regular UTF-8 text files on the server. Paths are absolute or relative to the session directory; native read permissions apply. Contents are read in full, never truncated.`,
          },
          text: c,
          type: { const: "evidence" },
        },
        required: ["type"],
        type: "object",
      },
    ],
    description:
      'Self-contained content to judge: a nonblank string, nonempty JSON object, or nonempty JSON array. No conversation history is included. Plain paths and URLs are inert; use { type: "evidence", text?, files?, diffs? } to resolve server-local evidence. In that wrapper, supply at least one of text, files, or diffs. The top-level type: "evidence" marker is reserved; put literal data with that marker under text.',
  };
  const instructions = {
    ...c,
    description:
      "The judgment to make against the shared state. Make each question independent of other answers; question IDs are response keys, not instructions.",
  };
  const question = {
    oneOf: [
      {
        additionalProperties: false,
        properties: {
          criteria: {
            additionalProperties: false,
            description:
              "Optional descriptions defining yes (true), no (false), or both. The answer is the probability of yes in [0, 1], not a boolean.",
            minProperties: 1,
            properties: { false: c, true: c },
            type: "object",
          },
          instructions,
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
                maxProperties: MAX_CHOICES,
                minProperties: MIN_CHOICES,
                propertyNames: {
                  maxLength: MAX_LABEL_LENGTH,
                  minLength: 1,
                  type: "string",
                },
                type: "object",
              },
              {
                items: {
                  additionalProperties: false,
                  properties: {
                    description: { anyOf: [c, { type: "null" }] },
                    label: {
                      maxLength: MAX_LABEL_LENGTH,
                      minLength: 1,
                      type: "string",
                    },
                  },
                  required: ["label", "description"],
                  type: "object",
                },
                maxItems: MAX_CHOICES,
                minItems: MIN_CHOICES,
                type: "array",
              },
            ],
            description: `${MIN_CHOICES}–${MAX_CHOICES} distinct nonblank labels of at most ${MAX_LABEL_LENGTH} characters, mapped to descriptions or null, or listed as { label, description }. Use the list form for __proto__. Include an explicit "unknown" option if needed; there is no automatic abstention. Backend limits may be tighter.`,
          },
          instructions,
          type: { const: "choice" },
        },
        required: ["type", "instructions", "criteria"],
        type: "object",
      },
      {
        additionalProperties: false,
        properties: {
          criteria: {
            description: `${MIN_SCORE_LEVELS}–${MAX_SCORE_LEVELS} ordered level descriptions, lowest to highest. The answer is a possibly fractional score in [0, criteria.length - 1], not a percentage.`,
            items: c,
            maxItems: MAX_SCORE_LEVELS,
            minItems: MIN_SCORE_LEVELS,
            type: "array",
          },
          instructions,
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
        description: `1–${MAX_QUESTIONS} independent judgments against the shared state. IDs are response keys matching ${NAME_PATTERN.source}. Do not also supply classifier.`,
        maxProperties: MAX_QUESTIONS,
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
  const callerStateNames = names.filter(
    (name) => !Object.hasOwn(classifiers[name], "state")
  );
  const presetStateNames = names.filter((name) =>
    Object.hasOwn(classifiers[name], "state")
  );
  return names.length === 0
    ? adHoc
    : {
        oneOf: [
          adHoc,
          ...(callerStateNames.length === 0
            ? []
            : [
                {
                  additionalProperties: false,
                  properties: {
                    classifier: {
                      description:
                        "Configured classifier name. Uses its stored questions unchanged; do not also supply questions.",
                      enum: callerStateNames,
                      type: "string",
                    },
                    state,
                  },
                  required: ["state", "classifier"],
                  type: "object",
                },
              ]),
          ...(presetStateNames.length === 0
            ? []
            : [
                {
                  additionalProperties: false,
                  properties: {
                    classifier: {
                      description:
                        "Configured classifier name. Uses its stored state and questions unchanged; do not supply state or questions. Evidence is resolved freshly in the session directory with native permissions.",
                      enum: presetStateNames,
                      type: "string",
                    },
                  },
                  required: ["classifier"],
                  type: "object",
                },
              ]),
        ],
        type: "object" as const,
      };
}
