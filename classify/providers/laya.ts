import { Effect } from "effect";

import type { BackendOptions } from "../config.js";
import {
  decodeWith,
  NativeRecordSchema,
  rejectTruncated,
} from "../protocols/response.js";
import type { SystemOneDefinition } from "../protocols/system-one.js";

export const laya: SystemOneDefinition<
  Extract<BackendOptions, { provider: "laya" }>
> = {
  decode: (value) =>
    decodeWith(NativeRecordSchema)(value).pipe(
      Effect.flatMap(rejectTruncated("Laya"))
    ),
  endpoint: (backend) => `${backend.baseURL}/v1/systemone`,
};
