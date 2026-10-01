import type { SystemOneDefinition } from "../protocols/system-one.js";
import { createSystemOneAdapter } from "../protocols/system-one.js";

export const typesafe: SystemOneDefinition = {
  createAdapter: (options) => createSystemOneAdapter(options, typesafe),
  decode: (value) => value,
  defaultKeyEnv: "TYPESAFE_API_KEY",
  defaultModel: "jev-latest",
  endpoint: () => "https://api.typesafe.ai/v1/systemone",
  fields: [],
  requestIDHeader: "x-typesafe-request-id",
};
