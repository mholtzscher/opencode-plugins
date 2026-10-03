import { Parser, Query } from "web-tree-sitter";
import type { Language } from "web-tree-sitter";

import type { CodeLanguage } from "./code-grammar.js";
import { MAX_BYTES, MAX_CODE_CAPTURES } from "./limits.js";

export interface CodeQueryRequest {
  language: CodeLanguage;
  query: string;
  source: string;
}

// oxlint-disable-next-line typescript/consistent-type-definitions -- Captures must be closed JSON values; interfaces allow declaration merging and lack JsonValue's index compatibility.
type Capture = {
  content: string;
  endIndex: number;
  endLine: number;
  nodeType: string;
  startIndex: number;
  startLine: number;
};

export type CodeQueryResponse =
  | { ok: true; captures: Capture[] }
  | { ok: false; message: string };

export class CodeQueryError extends Error {
  override name = "CodeQueryError";
}

export const runCodeQuery = (
  language: Language,
  source: string,
  queryText: string
): Capture[] => {
  let query: Query;
  try {
    query = new Query(language, queryText);
  } catch {
    throw new CodeQueryError(
      "Invalid Tree-sitter query. Use classify_grammar to inspect node types and fields."
    );
  }
  try {
    if (!query.captureNames.includes("evidence")) {
      throw new CodeQueryError(
        "Code query must capture source with @evidence."
      );
    }
    if (
      query.predicates.some((predicates) => predicates.length > 0) ||
      [
        query.setProperties,
        query.assertedProperties,
        query.refutedProperties,
      ].some((properties) =>
        properties.some(
          (property) => property && Object.keys(property).length > 0
        )
      )
    ) {
      throw new CodeQueryError(
        "Unsupported query predicate or directive. Use built-in text predicates such as #eq? and #match?."
      );
    }
    const parser = new Parser();
    try {
      parser.setLanguage(language);
      const tree = parser.parse(source);
      if (!tree) {
        throw new CodeQueryError("Code could not be parsed.");
      }
      try {
        if (tree.rootNode.hasError) {
          throw new CodeQueryError(
            "Code evidence contains syntax errors or syntax unsupported by its grammar."
          );
        }
        const captures = query.captures(tree.rootNode, { matchLimit: 4096 });
        if (query.didExceedMatchLimit()) {
          throw new CodeQueryError(
            "Code query exceeded its in-progress match limit. Narrow the query."
          );
        }
        const result: Capture[] = [];
        const seen = new Set<string>();
        let bytes = 0;
        for (const { name, node } of captures) {
          const key = `${node.startIndex}:${node.endIndex}`;
          if (name !== "evidence" || seen.has(key)) {
            continue;
          }
          seen.add(key);
          if (result.length >= MAX_CODE_CAPTURES) {
            throw new CodeQueryError(
              "Code query exceeds the 128-capture limit. Narrow the query."
            );
          }
          const content = source.slice(node.startIndex, node.endIndex);
          bytes += Buffer.byteLength(content);
          if (bytes > MAX_BYTES) {
            throw new CodeQueryError(
              "Code captures exceed the 1 MiB request limit."
            );
          }
          result.push({
            content,
            endIndex: node.endIndex,
            endLine:
              node.endPosition.row + (node.endPosition.column === 0 ? 0 : 1),
            nodeType: node.type,
            startIndex: node.startIndex,
            startLine: node.startPosition.row + 1,
          });
        }
        if (result.length === 0) {
          throw new CodeQueryError("Code query matched no @evidence captures.");
        }
        return result.toSorted(
          (a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex
        );
      } finally {
        tree.delete();
      }
    } finally {
      parser.delete();
    }
  } finally {
    query.delete();
  }
};
