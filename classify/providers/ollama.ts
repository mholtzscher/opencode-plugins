import type { BackendOptions } from "../config.js";
import { decodeWith, NativeRecordSchema } from "../protocols/response.js";
import type { SystemOneDefinition } from "../protocols/system-one.js";

export const ollama: SystemOneDefinition<
  Extract<BackendOptions, { provider: "ollama" }>
> = {
  decode: decodeWith(NativeRecordSchema),
  endpoint: (backend) => `${backend.baseURL}/v1/systemone`,
};
