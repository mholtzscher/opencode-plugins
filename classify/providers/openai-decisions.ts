import { Effect, Layer } from "effect";

import { ClassificationError } from "../errors.js";
import { DecisionBackend } from "./backend.js";

const unavailable = Effect.fail(
  new ClassificationError(
    "PROVIDER_UNAVAILABLE",
    "OpenAI Decisions is unavailable until its documented API adapter is implemented. Configure TypeSafe or Laya instead."
  )
);

export const openaiDecisionsLayer = Layer.succeed(
  DecisionBackend,
  DecisionBackend.of({
    decide: () => unavailable,
    preflight: () => unavailable,
    provider: "openai-decisions",
  })
);
