export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type Content = string | JsonValue[] | { [key: string]: JsonValue };
export interface EvidenceDiff {
  base: string;
  paths?: string[];
}
export interface EvidenceState {
  diffs?: EvidenceDiff[];
  files?: string[];
  text?: Content;
  type: "evidence";
}
export type ProviderID = "typesafe" | "laya" | "openai-decisions";
export type QuestionType = "noul" | "choice" | "score";
export type Question =
  | {
      type: "noul";
      instructions: Content;
      criteria?: { true?: Content; false?: Content };
    }
  | {
      type: "choice";
      instructions: Content;
      criteria: Record<string, Content | null>;
    }
  | { type: "score"; instructions: Content; criteria: Content[] };
export type Questions = Record<string, Question>;
export type ClassifyInput =
  | { state: Content | EvidenceState; questions: Questions; classifier?: never }
  | { state?: Content | EvidenceState; classifier: string; questions?: never };
export interface DecisionRequest {
  questions: Questions;
  state: Content;
}
export type Answer =
  | { type: "noul"; noul: number }
  | {
      type: "choice";
      choice: string;
      probabilities: Record<string, number>;
      /** Provider-native uncertainty metric, not probability of correctness. */
      confidence: number;
    }
  | {
      type: "score";
      score: number;
      scale: { min: 0; max: number };
      legend: Record<string, Content>;
      probabilities: Record<string, number>;
      /** Provider-native uncertainty metric, not probability of correctness. */
      confidence: number;
    };
export interface DecisionResponse {
  answers: Record<string, Answer>;
  /** Number of HTTP dispatch attempts, including the initial request. */
  attempts: number;
  model: string;
  requestID?: string;
  usage: { input_tokens: number; output_tokens: number };
}
export interface ClassifyResult extends DecisionResponse {
  classifier?: string;
  durationMs: number;
  provider: ProviderID;
}
export const ERROR_CODES = [
  "INVALID_CONFIG",
  "INVALID_INPUT",
  "EVIDENCE_ERROR",
  "UNKNOWN_CLASSIFIER",
  "MISSING_CREDENTIALS",
  "PROVIDER_UNAVAILABLE",
  "UNSUPPORTED_TYPE",
  "AUTH_FAILED",
  "RATE_LIMITED",
  "REQUEST_REJECTED",
  "NETWORK_ERROR",
  "TIMEOUT",
  "INVALID_RESPONSE",
  "INPUT_TRUNCATED",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export interface Failure {
  attempts?: number;
  code: ErrorCode;
  message: string;
  /** JSON Pointer into the input; no submitted values are echoed. */
  path?: string;
  provider?: ProviderID;
  requestID?: string;
  retryAfterMs?: number;
  retryable: boolean;
  status?: number;
}
export interface ClassifyFailure extends Failure {
  attempts: number;
  durationMs: number;
  provider: ProviderID;
}
export type ClassifyOutput =
  | { ok: true; result: ClassifyResult }
  | { ok: false; error: ClassifyFailure };

export class ClassificationError extends Error {
  readonly failure: Failure;
  constructor(
    code: ErrorCode,
    message: string,
    retryable = false,
    details: Omit<Failure, "code" | "message" | "retryable"> = {}
  ) {
    super(message);
    this.name = "ClassificationError";
    this.failure = { code, message, retryable, ...details };
  }
}
