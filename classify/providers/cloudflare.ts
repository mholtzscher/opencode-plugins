import type { SystemOneDefinition } from "../protocols/system-one.js";
import { createSystemOneAdapter } from "../protocols/system-one.js";
import { ClassificationError } from "../types.js";
import { invalid, nonblank, record } from "../validation/json.js";

const ACCOUNT_ID = /^[a-fA-F0-9]{32}$/u;

export const cloudflare: SystemOneDefinition = {
  configure(backend) {
    if (
      !nonblank(backend.accountID) ||
      !ACCOUNT_ID.test(backend.accountID) ||
      !["clef", "clef-flash"].includes(String(backend.model))
    ) {
      invalid();
    }
  },
  createAdapter: (options) => createSystemOneAdapter(options, cloudflare),
  decode(value) {
    const envelope = record(value);
    if (envelope.success !== true) {
      return invalid();
    }
    const result = record(envelope.result);
    if (result.truncated === true) {
      throw new ClassificationError(
        "INPUT_TRUNCATED",
        "Cloudflare reported truncated input."
      );
    }
    return result;
  },
  defaultKeyEnv: "CLOUDFLARE_AUTH_TOKEN",
  defaultModel: "clef",
  endpoint(backend) {
    if (backend.provider !== "cloudflare") {
      return invalid();
    }
    return `https://api.cloudflare.com/client/v4/accounts/${backend.accountID}/ai/run/@cf/cloudflare/${backend.model ?? "clef"}`;
  },
  fields: ["accountID"],
  requestIDHeader: "cf-ray",
};
