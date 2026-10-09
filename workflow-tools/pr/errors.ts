/* oxlint-disable eslint/max-classes-per-file -- This module owns the plugin's typed boundary errors. */
import { Schema } from "effect";

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is a schema class builder.
export class GithubError extends Schema.TaggedError<GithubError>()(
  "GithubError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    message: Schema.String,
    operation: Schema.String,
  }
) {}

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is a schema class builder.
export class GithubDecodeError extends Schema.TaggedError<GithubDecodeError>()(
  "GithubDecodeError",
  { cause: Schema.Defect(), description: Schema.String, message: Schema.String }
) {}

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is a schema class builder.
export class LogStorageError extends Schema.TaggedError<LogStorageError>()(
  "LogStorageError",
  { cause: Schema.Defect(), message: Schema.String }
) {}
