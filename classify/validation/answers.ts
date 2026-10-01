import {
  DISTRIBUTION_TOLERANCE,
  MAX_CHOICES,
  MAX_LABEL_LENGTH,
  MAX_SCORE_LEVELS,
  MIN_CHOICES,
  MIN_SCORE_LEVELS,
} from "../limits.js";
import type { Answer, DecisionResponse, JsonValue } from "../types.js";
import { content, exactKeys, invalid, nonblank, record } from "./json.js";

const isFiniteNumber = (value: JsonValue): value is number =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Numeric answer fields require a runtime primitive check after JSON decoding.
  typeof value === "number" && Number.isFinite(value);
const isWholeNumber = (value: JsonValue): value is number =>
  isFiniteNumber(value) && Number.isInteger(value);
const numberIn = (value: JsonValue, max = 1): number => {
  if (!isFiniteNumber(value) || value < 0 || value > max) {
    return invalid();
  }
  return value;
};
const distribution = (
  value: JsonValue,
  keys: string[]
): Record<string, number> => {
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
};
export type AnswerContract =
  | { type: "noul" }
  | { type: "choice"; labels: string[] }
  | { type: "score"; levels: number };

// Shared measurements; callers own field policies and request agreement.
export const validateAnswer = (
  value: JsonValue,
  contract: AnswerContract
): Answer => {
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
    if (!nonblank(answer.choice) || !keys.includes(answer.choice)) {
      return invalid();
    }
    return {
      choice: answer.choice,
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
};
export const validateUsage = (value: JsonValue): DecisionResponse["usage"] => {
  const usage = record(value);
  const { input_tokens, output_tokens } = usage;
  if (!isWholeNumber(input_tokens) || input_tokens < 0) {
    return invalid();
  }
  if (!isWholeNumber(output_tokens) || output_tokens < 0) {
    return invalid();
  }
  return {
    input_tokens,
    output_tokens,
  };
};
