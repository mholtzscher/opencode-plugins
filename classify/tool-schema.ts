import type { ClassifierDefinition } from "./config.js";
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
} from "./limits.js";

export const buildToolInputSchema = (
  classifiers: Record<string, ClassifierDefinition>
) => {
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
};
