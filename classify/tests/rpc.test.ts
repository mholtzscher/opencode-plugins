import { expect, test } from "bun:test";

import { Session } from "@opencode/schema/session";
import { Schema, SchemaRepresentation } from "effect";

import {
  BackendProfilesSchema,
  ClassifyBackends,
  GetSelectionSchema,
  SelectionSchema,
  SetSelectionSchema,
} from "../rpc.js";

test("RPC definitions are portable JSON Schema, not runtime validator objects", () => {
  const portable = Schema.decodeUnknownSync(Schema.Json)(ClassifyBackends);
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- This regression checks the actual JSON transport, not an in-memory clone.
  expect(JSON.parse(JSON.stringify(portable))).toEqual(ClassifyBackends);
  expect(ClassifyBackends.events.changed.schema.type).toBe("object");
  for (const method of Object.values(ClassifyBackends.methods)) {
    expect(method.input).not.toHaveProperty("~standard");
    expect(method.output).not.toHaveProperty("~standard");
    for (const error of Object.values(method.errors)) {
      expect(error.type).toBe("object");
    }
  }
});

test("portable RPC schemas compile with the host's restrictive pattern policy", () => {
  const schemas = [
    ClassifyBackends.events.changed.schema,
    ...Object.values(ClassifyBackends.methods).flatMap((method) => [
      method.input,
      method.output,
      ...Object.values(method.errors),
    ]),
  ];
  for (const schema of schemas) {
    expect(() =>
      SchemaRepresentation.fromJsonSchemaDocument(
        {
          definitions: {},
          dialect: "draft-2020-12",
          schema,
        },
        { patterns: "error" }
      )
    ).not.toThrow();
  }
});

test("RPC boundaries decode session inputs and selection outputs explicitly", () => {
  const get = Schema.decodeUnknownSync(GetSelectionSchema);
  const set = Schema.decodeUnknownSync(SetSelectionSchema);
  expect(get({ sessionID: "ses_rpc" })).toEqual({
    sessionID: Session.ID.make("ses_rpc"),
  });
  expect(() => get({ sessionID: {} })).toThrow();
  expect(() => get({ sessionID: "not-a-session" })).toThrow();
  expect(set({ backend: "local", sessionID: "ses_rpc" })).toHaveProperty(
    "backend",
    "local"
  );
  expect(() => set({ backend: "1bad", sessionID: "ses_rpc" })).toThrow();
  expect(
    Schema.decodeUnknownSync(SelectionSchema)({
      backend: "local",
      defaultBackend: "local",
      overridden: false,
      sessionID: "ses_rpc",
    })
  ).toHaveProperty("backend", "local");
  expect(
    Schema.decodeUnknownSync(BackendProfilesSchema)([
      { available: true, id: "local", model: "nimble", provider: "ollama" },
    ])
  ).toHaveLength(1);
});
