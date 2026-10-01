export const providerIDs = [
  "typesafe",
  "laya",
  "cloudflare",
  "openai-decisions",
] as const;

export type ProviderID = (typeof providerIDs)[number];
