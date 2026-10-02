import { Context, Effect } from "effect";

import { ClassificationError } from "../errors.js";
import type {
  DecisionRequest,
  DecisionResponse,
  ProviderID,
  Questions,
  QuestionType,
} from "../types.js";

export interface DecisionAdapter {
  decide: (
    request: DecisionRequest
  ) => Effect.Effect<DecisionResponse, ClassificationError>;
  /** Check availability and capabilities without reading evidence, credentials, or the network. */
  preflight: (questions: Questions) => Effect.Effect<void, ClassificationError>;
  readonly provider: ProviderID;
}

export class DecisionBackend extends Context.Service<
  DecisionBackend,
  DecisionAdapter
>()("classify/providers/DecisionBackend") {}

export const createPreflight =
  (supportedTypes: readonly QuestionType[]): DecisionAdapter["preflight"] =>
  (questions) =>
    Object.values(questions).every((question) =>
      supportedTypes.includes(question.type)
    )
      ? Effect.void
      : Effect.fail(
          new ClassificationError(
            "UNSUPPORTED_TYPE",
            "Configured provider does not support the requested question type."
          )
        );
