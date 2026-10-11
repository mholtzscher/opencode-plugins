import { Rpc } from "@opencode/plugin/rpc";
import { Session } from "@opencode/schema/session";
import { Schema } from "effect";

import { NameSchema, NonblankSchema } from "./classification-schemas.js";
import { providerIDs } from "./providers/ids.js";

export const SelectionSchema = Schema.Struct({
  backend: NameSchema,
  defaultBackend: NameSchema,
  overridden: Schema.Boolean,
  sessionID: NonblankSchema,
});

export const BackendProfileSchema = Schema.Struct({
  available: Schema.Boolean,
  id: NameSchema,
  model: Schema.optionalKey(NonblankSchema),
  provider: Schema.Literals(providerIDs),
});

export const GetSelectionSchema = Schema.Struct({ sessionID: Session.ID });
export const SetSelectionSchema = Schema.Struct({
  backend: Schema.optionalKey(NameSchema),
  sessionID: Session.ID,
});
export type BackendProfile = typeof BackendProfileSchema.Type;
export type SetSelectionInput = typeof SetSelectionSchema.Type;
export const BackendProfilesSchema = Schema.Array(BackendProfileSchema);
export const RemovedBackendErrorSchema = Schema.Struct({
  data: Schema.Struct({ defaultBackend: NameSchema }),
  type: Schema.Literal("unknown_backend"),
});

const emptyObject = {
  additionalProperties: false,
  properties: {},
  type: "object",
} as const;
// RPC's portable JSON Schema compiler rejects regex patterns. Keep the wire
// shapes simple; the server/client boundaries use the stricter native codecs.
const stringJson = { type: "string" } as const;
const selectionJson = {
  additionalProperties: false,
  properties: {
    backend: stringJson,
    defaultBackend: stringJson,
    overridden: { type: "boolean" },
    sessionID: stringJson,
  },
  required: ["backend", "defaultBackend", "overridden", "sessionID"],
  type: "object",
} as const;
const getSelectionJson = {
  additionalProperties: false,
  properties: { sessionID: stringJson },
  required: ["sessionID"],
  type: "object",
} as const;
const setSelectionJson = {
  ...getSelectionJson,
  properties: { backend: stringJson, sessionID: stringJson },
} as const;
const profilesJson = {
  items: {
    additionalProperties: false,
    properties: {
      available: { type: "boolean" },
      id: stringJson,
      model: stringJson,
      provider: { enum: providerIDs, type: "string" },
    },
    required: ["available", "id", "provider"],
    type: "object",
  },
  type: "array",
} as const;

const errors = {
  unavailable: emptyObject,
};

export const ClassifyBackends = Rpc.define({
  events: { changed: { schema: selectionJson } },
  id: "classify-backends",
  methods: {
    getSelection: {
      errors: {
        ...errors,
        unknown_backend: {
          additionalProperties: false,
          properties: { defaultBackend: stringJson },
          required: ["defaultBackend"],
          type: "object",
        },
      },
      input: getSelectionJson,
      output: selectionJson,
    },
    list: {
      errors,
      input: emptyObject,
      output: profilesJson,
    },
    setSelection: {
      errors: {
        ...errors,
        unknown_backend: emptyObject,
        unsupported_backend: emptyObject,
      },
      input: setSelectionJson,
      output: selectionJson,
    },
  },
});

/** Inline-only decisions for server-side consumers, without session messages. */
export const ClassifyDecisions = Rpc.define({
  events: {},
  id: "classify-decisions",
  methods: {
    decide: {
      errors,
      input: {
        additionalProperties: false,
        properties: {
          questions: { additionalProperties: true, type: "object" },
          sessionID: stringJson,
          state: stringJson,
        },
        required: ["sessionID", "state", "questions"],
        type: "object",
      },
      output: { additionalProperties: true, type: "object" },
    },
  },
});
