import type { RetrievalCase } from "./retrieval-corpus.js";

// Frozen before running revised strategies. These labels never enter retrieval.
// Same pinned files, new questions, including multiple required source ranges.
export const retrievalValidation: RetrievalCase[] = [
  {
    expected: [
      { endLine: 61, path: "transport.ts", startLine: 53 },
      { endLine: 155, path: "transport.ts", startLine: 130 },
    ],
    id: "auth-versus-retry",
    query:
      "Which HTTP authentication errors fail immediately, and which status codes may be retried?",
    rationale:
      "Authentication mapping and the retry eligibility predicate are separate parts of the transport.",
    terms: ["authentication", "status", "retried"],
  },
  {
    expected: [{ endLine: 155, path: "evidence.ts", startLine: 137 }],
    id: "permission-file-swap",
    query:
      "How is a file swapped during permission checking detected before evidence is read?",
    rationale:
      "verifyIdentity compares the canonical path and inode/device around native permission access.",
    terms: ["swapped", "permission", "file"],
  },
  {
    expected: [
      { endLine: 84, path: "selection.ts", startLine: 75 },
      { endLine: 32, path: "router.ts", startLine: 18 },
    ],
    id: "invalid-stored-selection",
    query:
      "Where is malformed stored backend selection decoded, and how does that failure become a tool error?",
    rationale:
      "Selection validates persisted values; routing maps failure to the public INVALID_CONFIG response.",
    terms: ["stored", "decoded", "error"],
  },
  {
    expected: [
      { endLine: 85, path: "selection.ts", startLine: 80 },
      { endLine: 108, path: "selection.ts", startLine: 101 },
    ],
    id: "override-roundtrip",
    query:
      "Where is an override removed and subsequently read back as the configured default backend?",
    rationale:
      "The write path removes storage and the read path substitutes the configured default.",
    terms: ["override", "removed", "default"],
  },
  {
    expected: [
      { endLine: 12, path: "validation/input.ts", startLine: 9 },
      { endLine: 38, path: "protocols/response.ts", startLine: 23 },
    ],
    id: "two-validation-boundaries",
    query:
      "Where are malformed user arguments and malformed provider answers converted into classification errors?",
    rationale:
      "Input schema failures and provider response failures have distinct error boundaries.",
    terms: ["malformed", "arguments", "answers"],
  },
  {
    expected: [{ endLine: 53, path: "protocols/response.ts", startLine: 41 }],
    id: "provider-truncation",
    query: "How are truncated backend responses turned into typed failures?",
    rationale:
      "rejectTruncated checks the provider flag and fails with INPUT_TRUNCATED.",
    terms: ["truncated", "responses"],
  },
  {
    expected: [
      { endLine: 72, path: "bounded-lines.ts", startLine: 69 },
      { endLine: 96, path: "bounded-lines.ts", startLine: 91 },
    ],
    id: "scan-and-binary-guards",
    query:
      "What caps scanning through skipped lines and rejects binary content?",
    rationale:
      "The scan-byte cap and NUL-byte rejection protect reads independently of selected bytes.",
    terms: ["scanning", "skipped", "binary"],
  },
  {
    expected: [],
    id: "absent-vector-index",
    query:
      "Where are embeddings stored in a vector index for nearest-neighbor retrieval?",
    rationale:
      "The reviewed snapshot has no embeddings, vector index, or nearest-neighbor implementation.",
    terms: ["embeddings", "vector", "nearest-neighbor"],
  },
];
