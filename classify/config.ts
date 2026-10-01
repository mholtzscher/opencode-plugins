import path from "node:path";

import { NAME_PATTERN } from "./limits.js";
import { providers } from "./providers/registry.js";
import { ClassificationError } from "./types.js";
import type {
  Content,
  EvidenceState,
  JsonValue,
  Questions,
  ProviderID,
} from "./types.js";
import { parseQuestions, parseState } from "./validation/input.js";
import {
  fields,
  isBoundedJsonValue,
  nonblank,
  record,
} from "./validation/json.js";

export type BackendOptions =
  | {
      provider: "cloudflare";
      accountID: string;
      model?: "clef" | "clef-flash";
      apiKeyEnv?: string;
      apiKeyFile?: string;
    }
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
const isInteger = (value: JsonValue): value is number =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Numeric limits must reject all non-number JSON primitives.
  typeof value === "number" && Number.isInteger(value);
const configError = (): never => {
  throw new ClassificationError(
    "INVALID_CONFIG",
    "Invalid classify options. Check backend, limits, and classifier definitions; use an environment variable name or key-file path, never literal credentials."
  );
};
const freeze = <Value>(value: Value): void => {
  if (Object.isExtensible(value)) {
    for (const child of Object.values(new Object(value))) {
      freeze(child);
    }
    Object.freeze(value);
  }
};
const validateKeyFile = (backend: Record<string, JsonValue>): void => {
  if (
    Object.hasOwn(backend, "apiKeyFile") &&
    Object.hasOwn(backend, "apiKeyEnv")
  ) {
    configError();
  }
  if (!nonblank(backend.apiKeyFile)) {
    return;
  }
  if (
    backend.apiKeyFile.includes("\0") ||
    !(
      path.isAbsolute(backend.apiKeyFile) || backend.apiKeyFile.startsWith("~/")
    )
  ) {
    configError();
  }
};
const parseBackend = (value: JsonValue): BackendOptions => {
  const backend = record(value);
  if (
    !nonblank(backend.provider) ||
    !Object.hasOwn(providers, backend.provider)
  ) {
    configError();
  }
  // SAFETY: The own-key check above establishes a registered provider ID.
  const definition = providers[backend.provider as ProviderID];
  fields(backend, [
    "provider",
    "model",
    "apiKeyEnv",
    "apiKeyFile",
    ...definition.fields,
  ]);
  for (const key of ["model", "apiKeyEnv", "apiKeyFile"]) {
    if (Object.hasOwn(backend, key) && !nonblank(backend[key])) {
      configError();
    }
  }
  if (nonblank(backend.apiKeyEnv) && !ENV_NAME.test(backend.apiKeyEnv)) {
    configError();
  }
  validateKeyFile(backend);
  if (backend.model === undefined && definition.defaultModel !== undefined) {
    backend.model = definition.defaultModel;
  }
  if (
    backend.apiKeyFile === undefined &&
    definition.defaultKeyEnv !== undefined
  ) {
    backend.apiKeyEnv ??= definition.defaultKeyEnv;
  }
  definition.configure?.(backend);
  // SAFETY: Exact field validation and provider-specific checks above establish every field in the BackendOptions discriminated union.
  return backend as BackendOptions;
};
const integer = (value: JsonValue, min: number, max: number): number => {
  if (!isInteger(value) || value < min || value > max) {
    return configError();
  }
  return value;
};
const parseClassifiers = (
  value: JsonValue | undefined
): Record<string, ClassifierDefinition> => {
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
      const { description } = definition;
      if (!nonblank(description) || description.length > 512) {
        return configError();
      }
      const state = Object.hasOwn(definition, "state")
        ? parseState(definition.state)
        : undefined;
      const rawQuestions = definition.questions;
      if (!isBoundedJsonValue(rawQuestions)) {
        return configError();
      }
      const classifier: ClassifierDefinition = {
        description,
        questions: parseQuestions(rawQuestions),
      };
      if (state !== undefined) {
        classifier.state = state;
      }
      return [name, classifier];
    })
  );
};
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Plugin options are external input; this parser validates JSON safety before inspecting fields.
export const parseOptions = (value: unknown): ClassifyOptions => {
  try {
    if (!isBoundedJsonValue(value)) {
      return configError();
    }
    const options = record(structuredClone(value));
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
};
