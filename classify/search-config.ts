import { Effect, Schema } from "effect";

import { MAX_BYTES } from "./limits.js";

const positive = (maximum: number, fallback: number) =>
  Schema.Int.check(Schema.isBetween({ maximum, minimum: 1 })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(fallback))
  );

export const SEARCH_EXCLUDED_DIRECTORIES = [
  "node_modules",
  "dist",
  "build",
  "target",
  "vendor",
  "coverage",
];

export const SearchConfigSchema = Schema.Struct({
  concurrency: positive(16, 2),
  excludeDirectories: Schema.Array(
    Schema.String.check(
      Schema.isPattern(/^[^/\\\0]+$/u),
      Schema.isMaxLength(255)
    )
  ).pipe(
    Schema.mutable,
    Schema.withDecodingDefaultKey(Effect.succeed(SEARCH_EXCLUDED_DIRECTORIES))
  ),
  excludeHidden: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(true))
  ),
  linesPerFile: positive(10_000, 200),
  maxDepth: positive(128, 16),
  maxEntries: positive(1_000_000, 4096),
  maxEvidenceBytes: positive(64 * MAX_BYTES, MAX_BYTES),
  maxFailureDetails: positive(128, 64),
  maxFileBytes: positive(MAX_BYTES, 32 * 1024),
  maxFiles: positive(1024, 32),
  maxPaths: positive(64, 16),
  maxResults: positive(128, 32),
  timeoutMs: positive(3_600_000, 120_000),
}).annotate({ parseOptions: { onExcessProperty: "error" as const } });

export type SearchConfig = typeof SearchConfigSchema.Type;
