export const providerIDs = [
  "typesafe",
  "laya",
  "ollama",
  "cloudflare",
  "openai-decisions",
] as const;

export type ProviderID = (typeof providerIDs)[number];
