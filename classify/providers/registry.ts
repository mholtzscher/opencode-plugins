import { cloudflare } from "./cloudflare.js";
import type { ProviderDefinition } from "./definition.js";
import type { ProviderID } from "./ids.js";
import { laya } from "./laya.js";
import { openaiDecisions } from "./openai-decisions.js";
import { typesafe } from "./typesafe.js";

export const providers = {
  cloudflare,
  laya,
  "openai-decisions": openaiDecisions,
  typesafe,
} satisfies Record<ProviderID, ProviderDefinition>;
