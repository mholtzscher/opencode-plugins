import { Effect, Schema } from "effect";

import type { BackendOptions } from "../config.js";
import { decodeWith, rejectTruncated } from "../protocols/response.js";
import type { SystemOneDefinition } from "../protocols/system-one.js";
import { JsonValueSchema } from "../schemas.js";
import { boundedCodec } from "../validation/codec.js";

export const CloudflareResponseSchema = boundedCodec(
  Schema.Struct({
    result: Schema.Record(Schema.String, JsonValueSchema),
    success: Schema.Literal(true),
  })
);

export const cloudflare: SystemOneDefinition<
  Extract<BackendOptions, { provider: "cloudflare" }>
> = {
  decode: (value) =>
    decodeWith(CloudflareResponseSchema)(value).pipe(
      Effect.flatMap(({ result }) => rejectTruncated("Cloudflare")(result))
    ),
  endpoint: (backend) =>
    `https://api.cloudflare.com/client/v4/accounts/${backend.accountID}/ai/run/@cf/cloudflare/${backend.model}`,
  requestIDHeader: "cf-ray",
};
