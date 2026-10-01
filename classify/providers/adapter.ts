import type { ClassifyOptions } from "../config.js";
import type {
  DecisionRequest,
  DecisionResponse,
  ProviderID,
  Questions,
  QuestionType,
} from "../types.js";
import { unavailableOpenAI } from "./openai-decisions.js";
import { createSystemOneAdapter } from "./system-one.js";

export interface DecisionAdapter {
  decide: (
    request: DecisionRequest,
    signal: AbortSignal
  ) => Promise<DecisionResponse>;
  /** Check availability and capabilities without reading evidence, credentials, or the network. */
  preflight: (questions: Questions, signal: AbortSignal) => void;
  readonly provider: ProviderID;
  readonly supportedTypes: readonly QuestionType[];
}
export const createAdapter = (options: ClassifyOptions): DecisionAdapter =>
  options.backend.provider === "openai-decisions"
    ? unavailableOpenAI()
    : createSystemOneAdapter(options);
