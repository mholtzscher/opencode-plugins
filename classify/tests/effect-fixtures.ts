import type { Tool } from "@opencode/schema/tool";
import { Effect, Layer, Schema } from "effect";

import { buildInputSchema } from "../classification-schemas.js";
import { Classification, classificationLayer } from "../classification.js";
import type { ClassifierDefinition, ClassifyOptions } from "../config.js";
import { EvidenceAccess } from "../evidence.js";
import { decodeResponse } from "../protocols/response.js";
import type { NativeDecoder } from "../protocols/response.js";
import { DecisionBackend } from "../providers/backend.js";
import type { DecisionAdapter } from "../providers/backend.js";
import { cloudflare } from "../providers/cloudflare.js";
import { laya } from "../providers/laya.js";
import { ollama } from "../providers/ollama.js";
import { typesafe } from "../providers/typesafe.js";
import type { DecisionRequest, JsonValue } from "../types.js";
import { parseInput } from "../validation/input.js";

// SAFETY: Service tests only forward this context to the injected evidence service.
export const toolContext = (): Tool.Context => ({}) as Tool.Context;

export const classify = (
  options: ClassifyOptions,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Tests exercise invalid input through the classification service.
  value: unknown,
  context: Tool.Context
) =>
  Effect.gen(function* invokeClassification() {
    const classification = yield* Classification;
    return yield* classification.classify(value, context);
  }).pipe(Effect.provide(classificationLayer(options)));

export const evidenceLayer = (
  resolve: Parameters<typeof EvidenceAccess.of>[0]["resolve"] = () =>
    Effect.die(new Error("Unexpected evidence resolution"))
) => Layer.succeed(EvidenceAccess, EvidenceAccess.of({ resolve }));

export const decisionLayer = (adapter: DecisionAdapter) =>
  Layer.succeed(DecisionBackend, DecisionBackend.of(adapter));

export const decoders = {
  cloudflare: cloudflare.decode,
  laya: laya.decode,
  ollama: ollama.decode,
  typesafe: typesafe.decode,
};

/** Runs native response validation synchronously; failures throw the sanitized error. */
export const validateResponse = (
  value: JsonValue,
  request: DecisionRequest,
  decode: NativeDecoder
) => Effect.runSync(decodeResponse(value, request, decode));

/** Runs input validation synchronously; failures throw the sanitized error. */
export const parseInputSync = (
  value: JsonValue,
  classifiers: Readonly<Record<string, ClassifierDefinition>> = {}
) => Effect.runSync(parseInput(value, classifiers));

export const parseQuestions = (questions: JsonValue) => {
  const parsed = parseInputSync({ questions, state: "x" });
  if (parsed.questions === undefined) {
    throw new TypeError("Expected ad hoc questions");
  }
  return parsed.questions;
};

/** The ad hoc branch of the JSON Schema the host derives from the registered input codec. */
export const adHocInputJsonSchema = () => {
  const { schema } = Schema.toJsonSchemaDocument(buildInputSchema({}));
  if (!("anyOf" in schema) || !Array.isArray(schema.anyOf)) {
    throw new TypeError("Expected an input union");
  }
  return schema.anyOf[0];
};
