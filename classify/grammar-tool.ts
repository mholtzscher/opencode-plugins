import { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";

import { grammarInfo, NodeTypeInfo } from "./code-grammar.js";
import { ClassificationError } from "./errors.js";
import { NonblankSchema } from "./schemas.js";

const inputSchema = Schema.Struct({
  node: Schema.optional(NonblankSchema),
  path: NonblankSchema,
}).annotate({ parseOptions: { onExcessProperty: "error" as const } });

const outputSchema = Schema.Union([
  Schema.Struct({
    language: Schema.String,
    nodes: Schema.Array(
      Schema.Struct({
        named: Schema.Boolean,
        queryable: Schema.Boolean,
        type: Schema.String,
      })
    ),
  }),
  Schema.Struct({
    definitions: Schema.Array(
      Schema.Struct({ ...NodeTypeInfo.fields, queryable: Schema.Boolean })
    ),
    language: Schema.String,
  }),
]);

export const grammarTool = {
  description:
    'Inspect the installed Tree-sitter grammar for classify code evidence. Supply path (only its extension is used; no source file is read). Omit node to list node types; supply an exact node name to get fields, allowed children, and subtypes from pinned node-types.json. Use queryable entries: named nodes use (node_type), anonymous tokens use quoted strings. Build raw TSQuery patterns and capture desired source with @evidence. Example: ((method_declaration name: (field_identifier) @_name) @evidence (#eq? @_name "Get")). Built-in text predicates are supported; custom predicates and directives are rejected. Capture comments and enclosing nodes explicitly.',
  execute: Effect.fn("classify_grammar")(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Tool input is decoded at this boundary.
    function* execute(input: unknown) {
      const { path, node } = yield* Schema.decodeUnknownEffect(inputSchema)(
        input
      ).pipe(
        Effect.mapError(
          () =>
            new Tool.Error({
              message: "Supply path and an optional exact node name.",
            })
        )
      );
      const output = yield* Effect.tryPromise({
        catch: (error) =>
          new Tool.Error({
            message:
              error instanceof ClassificationError
                ? error.message
                : "Grammar metadata could not be loaded.",
          }),
        try: () => grammarInfo(path, node),
      });
      return { output };
    }
  ),
  // Publish portable schemas for the live host; execution still validates with the native codec.
  input: Schema.toJsonSchemaDocument(inputSchema).schema,
  name: "classify_grammar",
  output: Schema.toJsonSchemaDocument(outputSchema).schema,
} satisfies Tool.Info;
