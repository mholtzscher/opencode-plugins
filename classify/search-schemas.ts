import { Effect, Schema } from "effect";

import {
  CountSchema,
  NameSchema,
  NonblankSchema,
  NonnegativeSchema,
  ProbabilitySchema,
  UsageSchema,
} from "./classification-schemas.js";
import { ERROR_CODES, FailureSchema } from "./errors.js";
import { providerIDs } from "./providers/ids.js";
import { SearchConfigSchema } from "./search-config.js";
import type { SearchConfig } from "./search-config.js";
import { boundedCodec } from "./validation/codec.js";

const strict = { parseOptions: { onExcessProperty: "error" as const } };
const pathSchema = NonblankSchema.check(
  Schema.isMaxLength(4096),
  Schema.makeFilter((value) => !value.includes("\0"))
);
const positive = (maximum: number) =>
  Schema.Int.check(Schema.isBetween({ maximum, minimum: 1 }));
export const searchInputSchema = (config: SearchConfig) =>
  boundedCodec(
    Schema.Struct({
      limit: positive(config.maxResults)
        .annotate({
          description: `Maximum returned matches, 1-${config.maxResults}; defaults to ${Math.min(8, config.maxResults)}. Does not reduce discovery or classification work.`,
        })
        .pipe(
          Schema.withDecodingDefaultKey(
            Effect.succeed(Math.min(8, config.maxResults))
          )
        ),
      maxFiles: positive(config.maxFiles)
        .annotate({
          description: `Maximum candidate file attempts, 1-${config.maxFiles}; defaults to ${config.maxFiles}. Read failures and term-filtered files count toward this limit.`,
        })
        .pipe(Schema.withDecodingDefaultKey(Effect.succeed(config.maxFiles))),
      paths: Schema.Array(pathSchema)
        .pipe(Schema.mutable)
        .check(Schema.isMinLength(1), Schema.isMaxLength(config.maxPaths))
        .annotate({
          description: `1-${config.maxPaths} explicit server-local file or directory paths, relative to the invoking session or absolute. No globs. Git is not required.`,
        }),
      query: NonblankSchema.check(Schema.isMaxLength(2000)).annotate({
        description:
          "Natural-language relevance query, nonblank and at most 2,000 characters.",
      }),
      terms: Schema.optionalKey(
        Schema.Array(NonblankSchema.check(Schema.isMaxLength(128)))
          .pipe(Schema.mutable)
          .check(Schema.isMinLength(1), Schema.isMaxLength(8))
          .annotate({
            description:
              "Optional 1-8 nonblank literal terms of at most 128 characters each. Case-insensitive OR matching against evaluated prefixes only.",
          })
      ),
    }).annotate(strict)
  );

export type SearchInput = ReturnType<typeof searchInputSchema>["Encoded"];
export const SearchFileSchema = Schema.Struct({
  content: Schema.String,
  endLine: CountSchema,
  partial: Schema.Boolean,
  path: Schema.String,
  startLine: CountSchema,
});
export const SearchEvidenceSchema = Schema.Struct({
  files: Schema.Array(SearchFileSchema).check(Schema.isLengthBetween(1, 1)),
});
export type SearchFile = typeof SearchFileSchema.Type;
export const SearchMatchSchema = Schema.Struct({
  endLine: CountSchema,
  model: NonblankSchema,
  partial: Schema.Boolean,
  path: Schema.String,
  relevance: ProbabilitySchema,
  startLine: CountSchema,
});
export type SearchMatch = typeof SearchMatchSchema.Type;
export const SearchFailureSchema = Schema.Struct({
  code: Schema.Literals(ERROR_CODES),
  message: Schema.String,
  path: Schema.String,
  stage: Schema.Literals(["discovery", "read", "classification"]),
});
export type SearchFailure = typeof SearchFailureSchema.Type;
export const SearchLimitSchema = Schema.Literals([
  "files",
  "entries",
  "depth",
  "evidence_bytes",
  "deadline",
]);
export type SearchLimit = typeof SearchLimitSchema.Type;
export const SearchOutputSchema = boundedCodec(
  Schema.Union([
    Schema.Struct({ error: FailureSchema, ok: Schema.Literal(false) }),
    Schema.Struct({
      ok: Schema.Literal(true),
      result: Schema.Struct({
        attempts: CountSchema,
        backend: Schema.optionalKey(NameSchema),
        budgets: SearchConfigSchema,
        coverage: Schema.Struct({
          classified: CountSchema,
          complete: Schema.Boolean,
          discovered: CountSchema,
          discoveryComplete: Schema.Boolean,
          examined: CountSchema,
          failed: CountSchema,
          filtered: CountSchema,
          limitsReached: Schema.Array(SearchLimitSchema).pipe(Schema.mutable),
          partialFiles: CountSchema,
          selectedBytes: CountSchema,
          skippedEntries: CountSchema,
          visitedEntries: CountSchema,
        }),
        durationMs: NonnegativeSchema,
        failures: Schema.Array(SearchFailureSchema).pipe(Schema.mutable),
        matches: Schema.Array(SearchMatchSchema).pipe(Schema.mutable),
        omittedMatches: CountSchema,
        provider: Schema.Literals(providerIDs),
        usage: UsageSchema,
      }),
    }),
  ])
);
export type SearchOutput = typeof SearchOutputSchema.Type;
