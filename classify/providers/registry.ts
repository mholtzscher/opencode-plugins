import type { Layer } from "effect";
import type { HttpClient } from "effect/unstable/http";

import type { ClassifyOptions } from "../config.js";
import type { Credentials } from "../credentials.js";
import { systemOneLayer } from "../protocols/system-one.js";
import type { DecisionBackend } from "./backend.js";
import { cloudflare } from "./cloudflare.js";
import { laya } from "./laya.js";
import { openaiDecisionsLayer } from "./openai-decisions.js";
import { typesafe } from "./typesafe.js";

export const providerLayer = (
  options: ClassifyOptions
): Layer.Layer<DecisionBackend, never, Credentials | HttpClient.HttpClient> => {
  const { backend } = options;
  switch (backend.provider) {
    case "cloudflare": {
      return systemOneLayer(options, backend, cloudflare);
    }
    case "laya": {
      return systemOneLayer(options, backend, laya);
    }
    case "typesafe": {
      return systemOneLayer(options, backend, typesafe);
    }
    default: {
      return openaiDecisionsLayer;
    }
  }
};
