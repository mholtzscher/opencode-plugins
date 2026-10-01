import {
  MAX_CHOICES,
  MAX_EVIDENCE_DIFFS,
  MAX_EVIDENCE_PATHS,
  MAX_LABEL_LENGTH,
  MAX_QUESTIONS,
  MAX_SCORE_LEVELS,
  MIN_CHOICES,
  MIN_SCORE_LEVELS,
  NAME_PATTERN,
} from "../limits.js";
import type {
  ClassifyInput,
  Content,
  EvidenceState,
  Question,
  Questions,
} from "../types.js";
import {
  boundedJson,
  content,
  fields,
  invalid,
  nonblank,
  record,
} from "./json.js";

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
