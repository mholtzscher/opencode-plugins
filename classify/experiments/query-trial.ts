import { appendFile } from "node:fs/promises";

import { extractCode } from "../code-evidence.js";
import { corpus, expectedContent, readCorpusSource } from "./corpus.js";

const [id, query, journal] = process.argv.slice(2);
const entry = corpus.find((candidate) => candidate.id === id);
if (!entry || !query || !journal) {
  throw new Error(
    "Usage: bun experiments/query-trial.ts <case-id> <query> <journal-path>"
  );
}
const source = await readCorpusSource(entry);
let result;
try {
  const extracted = await extractCode(source, { path: entry.path, query });
  result = {
    captures: extracted.captures.map(({ startLine, endLine }) => ({
      endLine,
      startLine,
    })),
    correct:
      extracted.captures.length === 1 &&
      extracted.captures[0].content === expectedContent(source, entry),
    id,
    query,
  };
} catch (error) {
  result = {
    correct: false,
    error: error instanceof Error ? error.message : "Unknown error",
    id,
    query,
  };
}
await appendFile(journal, `${JSON.stringify(result)}\n`);
console.log(JSON.stringify(result));
