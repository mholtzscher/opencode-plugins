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
  JsonValue,
  Question,
  Questions,
} from "../types.js";
import {
  boundedJson,
  content,
  fields,
  invalid,
  isBoundedJsonValue,
  nonblank,
  record,
} from "./json.js";

const validateChoiceCriteria = (
  criteriaInput: JsonValue,
  path: string
): void => {
  const criteria = record(criteriaInput, path);
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
};
const validateQuestion = (q: Record<string, JsonValue>, path: string): void => {
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
        return invalid(
          criteriaPath,
          `Score requires ${MIN_SCORE_LEVELS} to ${MAX_SCORE_LEVELS} ordered levels.`
        );
      }
      for (const [index, level] of q.criteria.entries()) {
        content(level, `${criteriaPath}/${index}`);
      }
      return;
    }
    default: {
      invalid(
        `${path}/type`,
        'Question type must be "noul", "choice", or "score".'
      );
    }
  }
};
const normalizeQuestion = (
  questionInput: JsonValue,
  path: string
): Question => {
  const q = record(questionInput, path);
  if (q.type !== "choice" || !Array.isArray(q.criteria)) {
    validateQuestion(q, path);
    // SAFETY: validateQuestion checks the discriminant, exact fields, criteria shape, and content before this validated record crosses the boundary.
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
      return invalid(
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
  // SAFETY: validateQuestion checks the normalized discriminant, exact fields, and every criterion value before the cast.
  return normalized as Question;
};
const questionMap = (
  questionsInput: JsonValue,
  path = "/questions"
): Questions => {
  const map = record(questionsInput, path);
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
};
export const parseQuestions = (
  questionsInput: JsonValue,
  limits?: { maxBytes: number; maxDepth: number }
): Questions => {
  if (!isBoundedJsonValue(questionsInput, limits)) {
    return invalid("/questions");
  }
  return questionMap(questionsInput);
};
export const isEvidence = (
  stateInput: JsonValue | EvidenceState | undefined
): stateInput is EvidenceState =>
  stateInput !== null &&
  stateInput !== undefined &&
  !Array.isArray(stateInput) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(stateInput)) &&
  Object.getOwnPropertyDescriptor(stateInput, "type")?.value === "evidence";
const paths = (pathsInput: JsonValue, path: string): void => {
  if (
    !Array.isArray(pathsInput) ||
    pathsInput.length === 0 ||
    pathsInput.length > MAX_EVIDENCE_PATHS ||
    pathsInput.some((item) => !nonblank(item) || item.includes("\0"))
  ) {
    invalid(
      path,
      `Expected 1–${MAX_EVIDENCE_PATHS} nonblank literal paths without null characters.`
    );
  }
};
export const validateState = (stateInput: JsonValue, path = "/state"): void => {
  if (!isEvidence(stateInput)) {
    content(stateInput, path);
    return;
  }
  const state = record(stateInput, path);
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
      return invalid(
        `${path}/diffs`,
        `Expected 1–${MAX_EVIDENCE_DIFFS} Git diffs.`
      );
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
        return invalid(
          `${diffPath}/base`,
          "Expected a nonblank Git revision not starting with a hyphen or containing null characters."
        );
      }
      if (Object.hasOwn(diff, "paths")) {
        paths(diff.paths, `${diffPath}/paths`);
      }
    }
  }
};
export const parseState = (
  stateInput: JsonValue,
  path = "/state"
): Content | EvidenceState => {
  validateState(stateInput, path);
  // SAFETY: validateState establishes either nonblank Content or the complete evidence object contract before returning the unchanged JSON value.
  return stateInput as Content | EvidenceState;
};
export const parseInput = (rawInput: JsonValue): ClassifyInput => {
  boundedJson(rawInput);
  const input = record(rawInput);
  fields(input, ["state", "questions", "classifier"]);
  if (
    Object.hasOwn(input, "questions") === Object.hasOwn(input, "classifier")
  ) {
    invalid("", "Supply exactly one of questions or classifier.");
  }
  if (Object.hasOwn(input, "questions")) {
    if (!Object.hasOwn(input, "state")) {
      return invalid("/state", "Ad hoc classification requires state.");
    }
    return {
      questions: questionMap(input.questions),
      state: parseState(input.state),
    };
  }
  if (!(nonblank(input.classifier) && NAME_PATTERN.test(input.classifier))) {
    return invalid(
      "/classifier",
      `Classifier names must match ${NAME_PATTERN.source}.`
    );
  }
  if (Object.hasOwn(input, "state")) {
    return { classifier: input.classifier, state: parseState(input.state) };
  }
  return { classifier: input.classifier };
};
