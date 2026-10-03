import type {
  AnswerSchema,
  ContentSchema,
  EvidenceSchema,
  SchemaClassifyInput,
  SchemaClassifyOutput,
  SchemaQuestion,
  SchemaQuestions,
} from "./schemas.js";

export type { ProviderID } from "./providers/ids.js";
export { ClassificationError, ERROR_CODES } from "./errors.js";
export type { ErrorCode, Failure } from "./errors.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type Content = typeof ContentSchema.Type;
export type EvidenceState = typeof EvidenceSchema.Type;
export type EvidenceDiff = NonNullable<EvidenceState["diffs"]>[number];
export type EvidenceCode = NonNullable<EvidenceState["code"]>[number];
export type Question = SchemaQuestion;
export type QuestionType = Question["type"];
export type Questions = SchemaQuestions;
export type ClassifyInput =
  | (Extract<SchemaClassifyInput, { questions: Questions }> & {
      classifier?: never;
    })
  | (Extract<SchemaClassifyInput, { classifier: string }> & {
      questions?: never;
    });
export interface DecisionRequest {
  questions: Questions;
  state: Content;
}
export type Answer = typeof AnswerSchema.Type;
type Mutable<A> = { -readonly [Key in keyof A]: A[Key] };
export type ClassifyOutput = SchemaClassifyOutput;
export type ClassifyResult = Mutable<
  Extract<ClassifyOutput, { ok: true }>["result"]
>;
export type DecisionResponse = Pick<
  ClassifyResult,
  "answers" | "attempts" | "model" | "requestID" | "usage"
>;
export type ClassifyFailure = Mutable<
  Extract<ClassifyOutput, { ok: false }>["error"]
>;
