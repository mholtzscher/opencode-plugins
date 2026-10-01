import type { ClassifyOptions } from "../config.js";
import type {
  DecisionRequest,
  DecisionResponse,
  ProviderID,
  Questions,
  QuestionType,
} from "../types.js";
import { providers } from "./registry.js";

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
  providers[options.backend.provider].createAdapter(options);
