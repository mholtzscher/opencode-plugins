import { Schema } from "effect";

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is a schema class builder.
export class SpecCommandError extends Schema.TaggedError<SpecCommandError>()(
  "SpecCommandError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    command: Schema.String,
    message: Schema.String,
    reason: Schema.Literals([
      "usage",
      "invalid-path",
      "not-found",
      "filesystem",
    ]),
  }
) {}
