import { isAbsolute } from "node:path";
import {
  boundedJson,
  fields,
  NAME_PATTERN,
  nonblank,
  parseQuestions,
  record,
  validateState,
} from "./schema.js";
import {
  ClassificationError,
  type Content,
  type EvidenceState,
  type Questions,
} from "./types.js";

export type BackendOptions =
  | {
      provider: "typesafe";
      model?: string;
      apiKeyEnv?: string;
      apiKeyFile?: string;
    }
  | {
      provider: "laya";
      baseURL?: string;
      model?: string;
      apiKeyEnv?: string;
      apiKeyFile?: string;
    }
  | {
      provider: "openai-decisions";
      model?: string;
      apiKeyEnv?: string;
      apiKeyFile?: string;
    };
export interface ClassifierDefinition {
  description: string;
  questions: Questions;
  state?: Content | EvidenceState;
}
export interface ClassifyOptions {
  backend: BackendOptions;
  classifiers?: Record<string, ClassifierDefinition>;
  maxRetries?: number;
  timeoutMs?: number;
}
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const ORIGIN = /^https?:\/\/[^/?#\\\s]+\/?$/u;
const PROTOCOL = /^https?:\/\//u;
const TRAILING_SLASH = /\/$/u;
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
function configError(): never {
  throw new ClassificationError(
    "INVALID_CONFIG",
    "Invalid classify options. Check backend, limits, and classifier definitions; use an environment variable name or key-file path, never literal credentials."
  );
}
function freeze(value: unknown): void {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      freeze(child);
    }
    Object.freeze(value);
  }
}
function layaOrigin(value: unknown): string {
  if (typeof value !== "string" || !ORIGIN.test(value)) {
    return configError();
  }
  const url = new URL(value);
  const authority = value.replace(PROTOCOL, "").replace(TRAILING_SLASH, "");
  const host = authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : authority.split(":")[0];
  if (url.protocol === "http:" && !LOOPBACK.includes(host)) {
    configError();
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    configError();
  }
  return url.origin;
}
function parseBackend(value: unknown): BackendOptions {
  const backend = record(value);
  if (
    !["typesafe", "laya", "openai-decisions"].includes(
      backend.provider as string
    )
  ) {
    configError();
  }
  fields(
    backend,
    backend.provider === "laya"
      ? ["provider", "model", "apiKeyEnv", "apiKeyFile", "baseURL"]
      : ["provider", "model", "apiKeyEnv", "apiKeyFile"]
  );
  for (const key of ["model", "apiKeyEnv", "apiKeyFile"]) {
    if (Object.hasOwn(backend, key) && !nonblank(backend[key])) {
      configError();
    }
  }
  if (
    typeof backend.apiKeyEnv === "string" &&
    !ENV_NAME.test(backend.apiKeyEnv)
  ) {
    configError();
  }
  validateKeyFile(backend);
  if (backend.provider === "typesafe") {
    backend.model ??= "jev-latest";
    if (backend.apiKeyFile === undefined) {
      backend.apiKeyEnv ??= "TYPESAFE_API_KEY";
    }
  }
  if (
    backend.provider === "openai-decisions" &&
    backend.apiKeyFile === undefined
  ) {
    backend.apiKeyEnv ??= "OPENAI_API_KEY";
  }
  if (backend.provider === "laya") {
    backend.model ??= "english";
    backend.baseURL = layaOrigin(
      Object.hasOwn(backend, "baseURL")
        ? backend.baseURL
        : "http://127.0.0.1:8000"
    );
  }
  return backend as BackendOptions;
}
function validateKeyFile(backend: Record<string, unknown>): void {
  if (
    Object.hasOwn(backend, "apiKeyFile") &&
    Object.hasOwn(backend, "apiKeyEnv")
  ) {
    configError();
  }
  if (typeof backend.apiKeyFile !== "string") {
    return;
  }
  if (
    backend.apiKeyFile.includes("\0") ||
    !(isAbsolute(backend.apiKeyFile) || backend.apiKeyFile.startsWith("~/"))
  ) {
    configError();
  }
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    return configError();
  }
  return value;
}
function parseClassifiers(
  value: unknown
): Record<string, ClassifierDefinition> {
  const classifiers = value === undefined ? {} : record(value);
  if (Object.keys(classifiers).length > 32) {
    configError();
  }
  return Object.fromEntries(
    Object.entries(classifiers).map(([name, item]) => {
      if (!NAME_PATTERN.test(name)) {
        configError();
      }
      const definition = record(item);
      fields(definition, ["description", "questions", "state"]);
      if (
        !nonblank(definition.description) ||
        definition.description.length > 512
      ) {
        configError();
      }
      if (Object.hasOwn(definition, "state")) {
        validateState(definition.state);
      }
      return [
        name,
        {
          description: definition.description as string,
          questions: parseQuestions(definition.questions),
          ...(Object.hasOwn(definition, "state")
            ? { state: definition.state as Content | EvidenceState }
            : {}),
        },
      ];
    })
  );
}
export function parseOptions(value: unknown): ClassifyOptions {
  try {
    boundedJson(value);
    const options = record(JSON.parse(JSON.stringify(value)));
    fields(options, ["backend", "timeoutMs", "maxRetries", "classifiers"]);
    const result: ClassifyOptions = {
      backend: parseBackend(options.backend),
      classifiers: parseClassifiers(options.classifiers),
      maxRetries: integer(
        Object.hasOwn(options, "maxRetries") ? options.maxRetries : 1,
        0,
        2
      ),
      timeoutMs: integer(
        Object.hasOwn(options, "timeoutMs") ? options.timeoutMs : 30_000,
        1000,
        300_000
      ),
    };
    freeze(result);
    return result;
  } catch {
    return configError();
  }
}
