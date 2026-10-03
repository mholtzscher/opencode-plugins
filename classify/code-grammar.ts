import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { Schema } from "effect";
import { Language, Parser, Query } from "web-tree-sitter";

import { ClassificationError } from "./errors.js";

export type CodeLanguage =
  | "go"
  | "javascript"
  | "kotlin"
  | "tsx"
  | "typescript";
const require = createRequire(import.meta.url);
const extensions = new Map<string, CodeLanguage>([
  [".cjs", "javascript"],
  [".cts", "typescript"],
  [".go", "go"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".kt", "kotlin"],
  [".kts", "kotlin"],
  [".mjs", "javascript"],
  [".mts", "typescript"],
  [".ts", "typescript"],
  [".tsx", "tsx"],
]);

export const codeLanguage = (filePath: string): CodeLanguage => {
  const language = extensions.get(path.extname(filePath).toLowerCase());
  if (!language) {
    throw new ClassificationError(
      "EVIDENCE_ERROR",
      "No Tree-sitter grammar is registered for this file extension."
    );
  }
  return language;
};

let initialized: Promise<void> | undefined;
const languages = new Map<CodeLanguage, Promise<Language>>();
const initialize = async () => {
  try {
    await Parser.init();
  } catch (error) {
    initialized = undefined;
    throw error;
  }
};

export const loadCodeLanguage = (language: CodeLanguage) => {
  let loaded = languages.get(language);
  if (!loaded) {
    loaded = (async () => {
      try {
        initialized ??= initialize();
        await initialized;
        return await Language.load(
          require.resolve(`tree-sitter-wasms/out/tree-sitter-${language}.wasm`)
        );
      } catch (error) {
        languages.delete(language);
        throw error;
      }
    })();
    languages.set(language, loaded);
  }
  return loaded;
};

const NodeReference = Schema.Struct({
  named: Schema.Boolean,
  type: Schema.String,
});
const NodeChildren = Schema.Struct({
  multiple: Schema.Boolean,
  required: Schema.Boolean,
  types: Schema.Array(NodeReference),
});
export const NodeTypeInfo = Schema.Struct({
  children: Schema.optional(NodeChildren),
  fields: Schema.optional(Schema.Record(Schema.String, NodeChildren)),
  named: Schema.Boolean,
  subtypes: Schema.optional(Schema.Array(NodeReference)),
  type: Schema.String,
});

export const grammarInfo = async (filePath: string, node?: string) => {
  const language = codeLanguage(filePath);
  const grammar = await loadCodeLanguage(language);
  const text = await readFile(
    new URL(`grammars/${language}.json`, import.meta.url),
    "utf-8"
  );
  const types = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.Array(NodeTypeInfo))
  )(text);
  const queryable = (entry: typeof NodeReference.Type) => {
    try {
      const query = new Query(
        grammar,
        `${entry.named ? `(${entry.type})` : JSON.stringify(entry.type)} @evidence`
      );
      query.delete();
      return true;
    } catch {
      return false;
    }
  };
  if (node !== undefined) {
    const definitions = types.filter((entry) => entry.type === node);
    if (definitions.length === 0) {
      throw new ClassificationError(
        "EVIDENCE_ERROR",
        "Node type not found. Omit node to list available types."
      );
    }
    return {
      definitions: definitions.map((entry) => ({
        ...entry,
        queryable: queryable(entry),
      })),
      language,
    };
  }
  return {
    language,
    nodes: types.map((entry) => ({
      named: entry.named,
      queryable: queryable(entry),
      type: entry.type,
    })),
  };
};
