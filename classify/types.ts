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
      probabilities?: Record<string, number>;
      confidence?: number;
    }
  | {
      type: "score";
      score: number;
      legend?: Record<string, Content>;
      probabilities?: Record<string, number>;
      confidence?: number;
    };
export interface DecisionResponse {
  answers: Record<string, Answer>;
  model: string;
  requestID?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}
export interface ClassifyResult extends DecisionResponse {
  classifier?: string;
  durationMs: number;
  provider: ProviderID;
}
export type ErrorCode =
  | "INVALID_CONFIG"
  | "INVALID_INPUT"
  | "EVIDENCE_ERROR"
  | "UNKNOWN_CLASSIFIER"
  | "MISSING_CREDENTIALS"
  | "PROVIDER_UNAVAILABLE"
  | "UNSUPPORTED_TYPE"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "REQUEST_REJECTED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "INPUT_TRUNCATED"
  | "INTERNAL_ERROR";
export interface Failure {
  code: ErrorCode;
  message: string;
  provider?: ProviderID;
  retryable: boolean;
  status?: number;
}
export type ClassifyOutput =
  | { ok: true; result: ClassifyResult }
  | { ok: false; error: Failure };

export class ClassificationError extends Error {
  readonly failure: Failure;
  constructor(
    code: ErrorCode,
    message: string,
    retryable = false,
    details: Pick<Failure, "provider" | "status"> = {}
  ) {
    super(message);
    this.name = "ClassificationError";
    this.failure = { code, message, retryable, ...details };
  }
}
