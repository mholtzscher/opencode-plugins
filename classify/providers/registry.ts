import type { ProviderID } from "../types.js";
import { cloudflare } from "./cloudflare.js";
import type { ProviderDefinition } from "./definition.js";
import { laya } from "./laya.js";
import { openaiDecisions } from "./openai-decisions.js";
import { typesafe } from "./typesafe.js";

export const providers: Record<ProviderID, ProviderDefinition> = {
  cloudflare,
  laya,
  "openai-decisions": openaiDecisions,
  typesafe,
};

export const providerIDs = Object.keys(providers);
