import { parentPort } from "node:worker_threads";

import { loadCodeLanguage } from "./code-grammar.js";
import { CodeQueryError, runCodeQuery } from "./code-query.js";
import type { CodeQueryRequest, CodeQueryResponse } from "./code-query.js";

const port = parentPort;
if (!port) {
  throw new Error("Code query worker requires a parent port.");
}
port.once("message", async ({ language, source, query }: CodeQueryRequest) => {
  let response: CodeQueryResponse;
  try {
    const grammar = await loadCodeLanguage(language);
    response = { captures: runCodeQuery(grammar, source, query), ok: true };
  } catch (error) {
    response = {
      message:
        error instanceof CodeQueryError
          ? error.message
          : "Tree-sitter query execution failed.",
      ok: false,
    };
  }
  port.postMessage(response);
  port.close();
});
