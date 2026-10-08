import { Schema } from "effect";

import { NAME_PATTERN } from "./limits.js";
import { providerIDs } from "./providers/ids.js";

export const ERROR_CODES = [
  "INVALID_CONFIG",
  "INVALID_INPUT",
  "EVIDENCE_ERROR",
  "MISSING_CREDENTIALS",
  "PROVIDER_UNAVAILABLE",
  "UNSUPPORTED_TYPE",
  "UNSUPPORTED_INPUT",
  "AUTH_FAILED",
  "RATE_LIMITED",
  "REQUEST_REJECTED",
  "NETWORK_ERROR",
  "TIMEOUT",
  "INVALID_RESPONSE",
  "INPUT_TRUNCATED",
  "INTERNAL_ERROR",
] as const;

const AttemptCountSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const ProviderSchema = Schema.Literals(providerIDs);
const NonnegativeSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
);
export const RequestIDSchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9._:-]{1,256}$/u)
);

const FailureFields = {
  code: Schema.Literals(ERROR_CODES),
  message: Schema.String.check(Schema.isPattern(/\S/u)),
  path: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^(?:\/(?:[^~]|~[01])*)*$/u))
  ),
  requestID: Schema.optionalKey(RequestIDSchema),
  retryAfterMs: Schema.optionalKey(NonnegativeSchema),
  retryable: Schema.Boolean,
  status: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ maximum: 599, minimum: 100 }))
  ),
};

const InternalFailureSchema = Schema.Struct({
  ...FailureFields,
  attempts: Schema.optionalKey(AttemptCountSchema),
  provider: Schema.optionalKey(ProviderSchema),
});

export const FailureSchema = Schema.Struct({
  ...FailureFields,
  attempts: AttemptCountSchema,
  backend: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(NAME_PATTERN))
  ),
  durationMs: NonnegativeSchema,
  provider: ProviderSchema,
});

export type ErrorCode = (typeof ERROR_CODES)[number];
export type Failure = {
  -readonly [
    Key in keyof typeof InternalFailureSchema.Type
  ]: (typeof InternalFailureSchema.Type)[Key];
};
type FailureDetails = Omit<Failure, "code" | "message" | "retryable">;

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is a schema class builder, not an error instance constructor.
export class ClassificationError extends Schema.TaggedError<ClassificationError>()(
  "ClassificationError",
  {
    failure: InternalFailureSchema,
    message: Schema.String,
  }
) {
  constructor(
    code: ErrorCode,
    message: string,
    retryable = false,
    details: FailureDetails = {}
  ) {
    super({ failure: { code, message, retryable, ...details }, message });
  }

  withDetails(details: FailureDetails): ClassificationError {
    const { code, message, retryable, ...current } = this.failure;
    return new ClassificationError(code, message, retryable, {
      ...current,
      ...details,
    });
  }
}
