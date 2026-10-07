import { Effect, Schema } from "effect";

import {
  buildAnswerSchema,
  JsonValueSchema,
  NonblankSchema,
  UsageSchema,
} from "../classification-schemas.js";
import { ClassificationError } from "../errors.js";
import type {
  DecisionRequest,
  DecisionResponse,
  JsonValue,
  Questions,
} from "../types.js";
import { boundedCodec } from "../validation/codec.js";

type NativeResponse = Pick<DecisionResponse, "answers" | "model" | "usage">;
export type NativeDecoder = (
  value: JsonValue,
  request: DecisionRequest
) => Effect.Effect<Record<string, JsonValue>, ClassificationError>;

// Upstream parse errors may contain provider response data; expose only the sanitized classification error.
const invalidResponse = () =>
  new ClassificationError(
    "INVALID_RESPONSE",
    "Provider returned an invalid classification response."
  );

export const NativeRecordSchema = boundedCodec(
  Schema.Record(Schema.String, JsonValueSchema)
);

export const decodeWith =
  <A>(schema: Schema.Codec<A, unknown>) =>
  (value: JsonValue): Effect.Effect<A, ClassificationError> =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(invalidResponse)
    );

export const rejectTruncated =
  (provider: string) =>
  (
    result: Record<string, JsonValue>
  ): Effect.Effect<Record<string, JsonValue>, ClassificationError> =>
    result.truncated === true
      ? Effect.fail(
          new ClassificationError(
            "INPUT_TRUNCATED",
            `${provider} reported truncated input.`
          )
        )
      : Effect.succeed(result);

const responseSchema = (questions: Questions) =>
  Schema.Struct({
    answers: Schema.Struct(
      Object.fromEntries(
        Object.entries(questions).map(([id, question]) => [
          id,
          buildAnswerSchema(question).annotate({
            parseOptions: { onExcessProperty: "ignore" },
          }),
        ])
      )
    ).annotate({ parseOptions: { onExcessProperty: "error" } }),
    model: NonblankSchema,
    usage: UsageSchema,
  });

export const decodeResponse = Effect.fn("decodeResponse")(
  function* decodeResponse(
    value: JsonValue,
    request: DecisionRequest,
    decode: NativeDecoder
  ): Effect.fn.Return<NativeResponse, ClassificationError> {
    const native = yield* decode(value, request);
    const { answers, model, usage } = yield* Schema.decodeUnknownEffect(
      responseSchema(request.questions)
    )(native).pipe(Effect.mapError(invalidResponse));
    return { answers, model, usage };
  }
);
