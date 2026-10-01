import {
  DISTRIBUTION_TOLERANCE,
  MAX_CHOICES,
  MAX_LABEL_LENGTH,
  MAX_SCORE_LEVELS,
  MIN_CHOICES,
  MIN_SCORE_LEVELS,
} from "../limits.js";
import type { Answer, DecisionResponse } from "../types.js";
import { content, exactKeys, invalid, nonblank, record } from "./json.js";

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
