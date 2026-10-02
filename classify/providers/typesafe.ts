import type { BackendOptions } from "../config.js";
import { decodeWith, NativeRecordSchema } from "../protocols/response.js";
import type { SystemOneDefinition } from "../protocols/system-one.js";

export const typesafe: SystemOneDefinition<
  Extract<BackendOptions, { provider: "typesafe" }>
> = {
  decode: decodeWith(NativeRecordSchema),
  endpoint: () => "https://api.typesafe.ai/v1/systemone",
  requestIDHeader: "x-typesafe-request-id",
};
