import { Schema } from "effect";

import { ClassifyOutputSchema, ClassifyOutputStructure } from "./schemas.js";
import type { ClassifyOutput } from "./types.js";

export { ClassifyOutputSchema } from "./schemas.js";

const document = Schema.toJsonSchemaDocument(ClassifyOutputStructure);

/** Structural schema. The parser also checks distribution sums and cross-field consistency. */
export const classifyOutputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  ...document.schema,
  $defs: document.definitions,
};

const validateOutput = Schema.decodeUnknownSync(ClassifyOutputSchema, {
  onExcessProperty: "error",
});

/** Parse Code Mode's JSON string (or an already decoded object), validating without changing values. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Code Mode supplies an untrusted value that this boundary must decode and validate.
export const parseClassifyOutput = (raw: unknown): ClassifyOutput => {
  try {
    // String inputs are Code Mode's serialized output; structured values arrive as JSON-domain objects.
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The parser accepts both serialized and already-decoded JSON output.
    const decoded: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    // The bounded codec checks size and depth before reading any member.
    validateOutput(decoded);
    // SAFETY: The codec accepted this exact value; callers receive it unchanged.
    return decoded as ClassifyOutput;
  } catch {
    // Never include JSON parser errors, upstream values, or submitted content.
    throw new TypeError("Invalid classification output.");
  }
};
