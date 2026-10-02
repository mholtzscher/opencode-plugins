import { Effect, Schema } from "effect";

import type { ClassifierDefinition } from "../config.js";
import { ClassificationError } from "../errors.js";
import { buildInputSchema } from "../schemas.js";
import type { ClassifyInput, EvidenceState, JsonValue } from "../types.js";
import { schemaIssueDetails } from "./codec.js";

const invalidInput = (error: Schema.SchemaError): ClassificationError => {
  const { message, path } = schemaIssueDetails(error.issue);
  return new ClassificationError("INVALID_INPUT", message, false, { path });
};

/** Decodes with the same configured schema the host advertises, so named-classifier rules live in one place. */
export const parseInput = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the input boundary; the codec is the parser.
  raw: unknown,
  classifiers: Readonly<Record<string, ClassifierDefinition>>
): Effect.Effect<ClassifyInput, ClassificationError> =>
  Schema.decodeUnknownEffect(buildInputSchema(classifiers), {
    onExcessProperty: "error",
  })(raw).pipe(Effect.mapError(invalidInput));

export const isEvidence = (
  stateInput: JsonValue | EvidenceState | undefined
): stateInput is EvidenceState =>
  stateInput !== null &&
  stateInput !== undefined &&
  !Array.isArray(stateInput) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(stateInput)) &&
  Object.getOwnPropertyDescriptor(stateInput, "type")?.value === "evidence";
