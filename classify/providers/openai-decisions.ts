import { Effect, Predicate, Schema } from "effect";

import {
  NonblankSchema,
  ProbabilitySchema,
  UsageSchema,
} from "../classification-schemas.js";
import type { BackendOptions } from "../config.js";
import { ClassificationError } from "../errors.js";
import { decodeWith } from "../protocols/response.js";
import type { SystemOneDefinition } from "../protocols/system-one.js";
import type {
  Content,
  DecisionRequest,
  JsonValue,
  Question,
} from "../types.js";

const text = (value: Content) =>
  Predicate.isString(value) ? value : JSON.stringify(value);

const encodeQuestion = (name: string, question: Question): JsonValue => {
  const instructions = text(question.instructions);
  switch (question.type) {
    case "noul": {
      return {
        instructions: question.criteria
          ? `${instructions}\nPredicate criteria: ${JSON.stringify(question.criteria)}`
          : instructions,
        name,
        type: "predicate",
      };
    }
    case "choice": {
      return {
        choices: Object.entries(question.criteria).map(
          ([value, description]): JsonValue =>
            description === null
              ? { value }
              : { description: text(description), value }
        ),
        instructions,
        name,
        type: "choice",
      };
    }
    case "score": {
      return {
        instructions,
        levels: question.criteria.map((description, index) => ({
          description: text(description),
          label: String(index),
        })),
        name,
        type: "score",
      };
    }
    default: {
      throw new TypeError("Invalid question type.");
    }
  }
};

const AnswerSchema = Schema.Union([
  Schema.Struct({
    name: NonblankSchema,
    probability: ProbabilitySchema,
    type: Schema.Literal("predicate"),
  }),
  Schema.Struct({
    choice: Schema.String,
    confidence: ProbabilitySchema,
    name: NonblankSchema,
    probabilities: Schema.Array(
      Schema.Struct({ probability: ProbabilitySchema, value: Schema.String })
    ),
    type: Schema.Literal("choice"),
  }),
  Schema.Struct({
    confidence: ProbabilitySchema,
    name: NonblankSchema,
    probabilities: Schema.Array(
      Schema.Struct({
        label: Schema.String,
        probability: ProbabilitySchema,
        value: Schema.Int,
      })
    ),
    score: Schema.Number,
    type: Schema.Literal("score"),
  }),
  Schema.Struct({ name: NonblankSchema, type: Schema.Literal("refusal") }),
]);
const ResponseSchema = Schema.Struct({
  answers: Schema.Array(AnswerSchema),
  model: NonblankSchema,
  usage: UsageSchema,
});
const invalid = () =>
  new ClassificationError(
    "INVALID_RESPONSE",
    "Provider returned an invalid classification response."
  );

const decode = Effect.fn("OpenaiDecisions.decode")(function* decode(
  value: JsonValue,
  request: DecisionRequest
) {
  const response = yield* decodeWith(ResponseSchema)(value);
  const answers: Record<string, JsonValue> = Object.create(null);
  for (const answer of response.answers) {
    const question = Object.hasOwn(request.questions, answer.name)
      ? request.questions[answer.name]
      : undefined;
    if (
      !question ||
      Object.hasOwn(answers, answer.name) ||
      answer.type === "refusal"
    ) {
      return yield* Effect.fail(invalid());
    }
    if (answer.type === "predicate" && question.type === "noul") {
      answers[answer.name] = { noul: answer.probability, type: "noul" };
    } else if (answer.type === "choice" && question.type === "choice") {
      const probabilities = Object.fromEntries(
        answer.probabilities.map((entry) => [entry.value, entry.probability])
      );
      if (Object.keys(probabilities).length !== answer.probabilities.length) {
        return yield* Effect.fail(invalid());
      }
      answers[answer.name] = {
        choice: answer.choice,
        confidence: answer.confidence,
        probabilities,
        type: "choice",
      };
    } else if (answer.type === "score" && question.type === "score") {
      const probabilities = Object.fromEntries(
        answer.probabilities.map((entry) => [
          String(entry.value),
          entry.probability,
        ])
      );
      if (
        Object.keys(probabilities).length !== answer.probabilities.length ||
        answer.probabilities.some(
          (entry) => entry.label !== String(entry.value)
        )
      ) {
        return yield* Effect.fail(invalid());
      }
      answers[answer.name] = {
        confidence: answer.confidence,
        legend: Object.fromEntries(
          question.criteria.map((description, index) => [
            String(index),
            description,
          ])
        ),
        probabilities,
        score: answer.score,
        type: "score",
      };
    } else {
      return yield* Effect.fail(invalid());
    }
  }
  return { answers, model: response.model, usage: { ...response.usage } };
});

export const openaiDecisions: SystemOneDefinition<
  Extract<BackendOptions, { provider: "openai-decisions" }>
> = {
  decode,
  encode: (model, request) => ({
    input: text(request.state),
    model,
    questions: Object.entries(request.questions).map(([name, question]) =>
      encodeQuestion(name, question)
    ),
  }),
  endpoint: () => "https://api.openai.com/v1/decisions",
  requestIDHeader: "x-request-id",
};
