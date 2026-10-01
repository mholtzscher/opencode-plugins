import type { BackendOptions, ClassifyOptions } from "../config.js";
import type { JsonValue } from "../types.js";
import type { DecisionAdapter } from "./adapter.js";

export interface ProviderDefinition {
  readonly fields: readonly string[];
  readonly defaultModel?: string;
  readonly defaultKeyEnv?: string;
  configure?: (backend: Record<string, JsonValue>) => void;
  createAdapter: (options: ClassifyOptions) => DecisionAdapter;
  decode: (value: JsonValue) => JsonValue;
}

export interface SystemOneDefinition extends ProviderDefinition {
  endpoint: (backend: BackendOptions) => string;
  readonly requestIDHeader?: string;
}
