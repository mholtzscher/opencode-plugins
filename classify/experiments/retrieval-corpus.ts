import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SourceRange {
  path: string;
  startLine: number;
  endLine: number;
}

export interface RetrievalCase {
  id: string;
  query: string;
  terms: string[];
  expected: SourceRange[];
  rationale: string;
}

// Reviewed against 0422ab8. Refuse source drift rather than silently moving labels.
export const retrievalSources = {
  "bounded-lines.ts":
    "ff36e97d8df542daf662e0a597927f70dd96ff9c5db078109a93bbe340b9cbf1",
  "classification.ts":
    "69dfe4df8d0bf1398464ed664b6e2c7c784b3413ff7d60cc54658c8a8e14f85b",
  "config.ts":
    "82b37f77495e25b07f25365eca1f92251b693cebabccbe035a17bf0b92e479f9",
  "credentials.ts":
    "080169708677cfe0f0537cfb39b81a0284862d9208a29328437ce3764ed4b57a",
  "evidence.ts":
    "5dcbc9d544e811f5cd583763436edecfefb820b79fb44e26244842abcdd9c66f",
  "index.ts":
    "268cab14f10921f199dc253b22cd0948af232c75cff07aeaa7c13d2b44113ee2",
  "outcome.ts":
    "44b5678f6e3b3c486b5516c92b173eea1a9adee4a3c2496c9e4decfc09c92497",
  "protocols/response.ts":
    "e99a93fa51eb5d39e5066d859497ce0142221dc84581bac6677e0a3deea73863",
  "router.ts":
    "68a7399e60a8e4e30a12cdcfaaa5ef1867f63108ffbad8116832300be33b91da",
  "selection.ts":
    "3fd90a02271a85e0aa2b7ff6f4202242cd3c30fb28d058d86c7ec2188828e667",
  "transport.ts":
    "02eeaa81710bc5838c86b3a5ef4401d968a78709fcd7993b6831f30586e61527",
  "validation/input.ts":
    "957d574cd7605ccabfab8bcebc08a0d02f011cae44e64584777b5dcd85ae66f5",
};

// Primary evidence spans, reviewed before running either retrieval strategy.
// Retrieval receives only query/terms; expected spans are used solely for grading.
export const retrievalCases: RetrievalCase[] = [
  {
    expected: [{ endLine: 155, path: "transport.ts", startLine: 136 }],
    id: "retry-policy",
    query:
      "Where is retry backoff extended by Retry-After while respecting the deadline?",
    rationale:
      "The retry policy combines exponential delay, Retry-After, retry count, status eligibility, and the deadline.",
    terms: ["retry", "backoff"],
  },
  {
    expected: [{ endLine: 242, path: "transport.ts", startLine: 227 }],
    id: "request-deadline",
    query:
      "Where does an HTTP request timeout become a deadline-expired failure?",
    rationale:
      "The actual timeout-to-error branch occurs after line 200; a filename hit alone cannot expose it.",
    terms: ["timeout", "deadline"],
  },
  {
    expected: [{ endLine: 265, path: "evidence.ts", startLine: 251 }],
    id: "evidence-budget",
    query:
      "Where are remaining bytes reduced after each evidence file is read?",
    rationale:
      "The file loop passes the remaining budget and subtracts the selected byte count, beyond the default prefix.",
    terms: ["remaining", "bytes"],
  },
  {
    expected: [{ endLine: 108, path: "selection.ts", startLine: 101 }],
    id: "session-reset",
    query:
      "How is resetting a session's backend saved so the default applies next time?",
    rationale:
      "An omitted override removes its storage key; a named override writes it.",
    terms: ["reset", "default"],
  },
  {
    expected: [{ endLine: 83, path: "credentials.ts", startLine: 74 }],
    id: "secret-rotation",
    query:
      "How do newly issued authentication secrets become visible without restarting?",
    rationale:
      "The environment provider refreshes per invocation; the query deliberately uses different terminology.",
    terms: ["authentication", "secrets", "restarting"],
  },
  {
    expected: [{ endLine: 108, path: "bounded-lines.ts", startLine: 91 }],
    id: "line-encoding",
    query:
      "How does reading a line range reject invalid UTF-8 without retaining the whole file?",
    rationale:
      "Scanned bytes are validated incrementally while only selected bytes are retained.",
    terms: ["line", "utf-8"],
  },
  {
    expected: [{ endLine: 20, path: "outcome.ts", startLine: 5 }],
    id: "cleanup-cancellation",
    query: "How is cancellation preserved when cleanup also reports a failure?",
    rationale:
      "Typed failures become defects in mixed interruption causes before ordinary error recovery.",
    terms: ["cancellation", "cleanup"],
  },
  {
    expected: [],
    id: "absent-cache",
    query:
      "Where is a SQLite cache of previous classification results maintained?",
    rationale:
      "None of the twelve reviewed files implements a persistent classification-result cache.",
    terms: ["sqlite", "cache"],
  },
];

export const prepareRetrievalCorpus = async (directory: string) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  for (const [relative, expected] of Object.entries(retrievalSources)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Validate each pinned source before copying it into the disposable corpus.
    const content = await readFile(path.join(root, relative));
    if (createHash("sha256").update(content).digest("hex") !== expected) {
      throw new Error(
        `Review retrieval labels before updating changed source: ${relative}`
      );
    }
    const target = path.join(directory, relative);
    // oxlint-disable-next-line eslint/no-await-in-loop -- Preserve nested source paths inside this run's snapshot.
    await mkdir(path.dirname(target), { recursive: true });
    // oxlint-disable-next-line eslint/no-await-in-loop -- Copy only hash-verified public repository source.
    await writeFile(target, content);
  }
};
