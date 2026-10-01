import type { ClassifyOptions } from "../config.js";
import type {
  DecisionRequest,
  DecisionResponse,
  ProviderID,
  QuestionType,
} from "../types.js";
import { unavailableOpenAI } from "./openai-decisions.js";
import { createSystemOneAdapter } from "./system-one.js";
export interface DecisionAdapter {
  decide: (
    request: DecisionRequest,
    signal: AbortSignal
  ) => Promise<DecisionResponse>;
  readonly provider: ProviderID;
  readonly supportedTypes: readonly QuestionType[];
}
export function createAdapter(options: ClassifyOptions): DecisionAdapter {
  return options.backend.provider === "openai-decisions"
    ? unavailableOpenAI()
    : createSystemOneAdapter(options);
}
