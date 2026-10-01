import type { Questions } from "../types.js";

export const questions: Questions = {
  category: {
    criteria: { incident: "Failure", other: null },
    instructions: "Which category?",
    type: "choice",
  },
  severity: {
    criteria: ["None", { impact: "Some" }, "Unavailable"],
    instructions: ["Rate impact"],
    type: "score",
  },
  urgent: { instructions: { question: "Is this urgent?" }, type: "noul" },
};
export const input = {
  questions,
  state: { files: ["cache.ts"], message: "Production is down" },
};
export const response = () => ({
  answers: {
    category: {
      choice: "incident",
      confidence: 0.8,
      probabilities: { incident: 0.9, other: 0.1 },
      type: "choice" as const,
    },
    severity: {
      confidence: 0.4,
      legend: { "0": "None", "1": { impact: "Some" }, "2": "Unavailable" },
      probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
      score: 1.6,
      type: "score" as const,
    },
    urgent: { noul: 0.98, type: "noul" as const },
  },
  model: "resolved-model",
  usage: { input_tokens: 312, output_tokens: 48 },
});
export const normalizedResponse = () => {
  const native = response();
  return {
    ...native,
    answers: {
      ...native.answers,
      severity: {
        ...native.answers.severity,
        scale: { max: 2, min: 0 as const },
      },
    },
    attempts: 1,
  };
};
export const examples = [
  { backend: { provider: "typesafe" } },
  {
    backend: { baseURL: "http://127.0.0.1:8000", provider: "laya" },
    classifiers: {
      "incident-triage": {
        description:
          "Check whether a report describes an active production incident.",
        questions: {
          active: {
            instructions:
              "Does state.message describe an active production incident?",
            type: "noul",
          },
        },
      },
    },
  },
  {
    backend: {
      apiKeyEnv: "LAYA_API_KEY",
      baseURL: "http://127.0.0.1:8000",
      model: "english",
      provider: "laya",
    },
    classifiers: {
      "change-kind": {
        description: "Categorize a code-change summary into one allowed label.",
        questions: {
          kind: {
            criteria: {
              bugfix: "Corrects existing behavior",
              feature: "Adds a new capability",
              maintenance: "Upkeep without a behavior change",
              unknown: "Insufficient evidence",
            },
            instructions: "Which category best describes this change?",
            type: "choice",
          },
        },
      },
      "incident-triage": {
        description:
          "Assess whether a report describes an incident and rate its impact.",
        questions: {
          active: {
            instructions:
              "Does this report describe an active production incident?",
            type: "noul",
          },
          impact: {
            criteria: [
              "No user impact",
              "Some users affected",
              "Production unavailable",
            ],
            instructions: "Rate the user impact described in the report.",
            type: "score",
          },
        },
      },
    },
    maxRetries: 0,
    timeoutMs: 120_000,
  },
  {
    backend: {
      apiKeyEnv: "COMPANY_LAYA_API_KEY",
      baseURL: "https://laya.example.com",
      provider: "laya",
    },
    maxRetries: 0,
    timeoutMs: 60_000,
  },
  { backend: { provider: "openai-decisions" } },
  {
    backend: {
      accountID: "0123456789abcdef0123456789abcdef",
      model: "clef",
      provider: "cloudflare",
    },
  },
];
