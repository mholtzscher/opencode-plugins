import { ClassificationError } from "../types.js";
import { invalid, nonblank, record } from "../validation/json.js";
import type { SystemOneDefinition } from "./definition.js";
import { createSystemOneAdapter } from "./system-one.js";

const ORIGIN = /^https?:\/\/[^/?#\\\s]+\/?$/u;
const PROTOCOL = /^https?:\/\//u;
const TRAILING_SLASH = /\/$/u;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const laya: SystemOneDefinition = {
  configure(backend) {
    const value = Object.hasOwn(backend, "baseURL")
      ? backend.baseURL
      : "http://127.0.0.1:8000";
    if (!nonblank(value) || !ORIGIN.test(value)) {
      return invalid();
    }
    const url = new URL(value);
    const authority = value.replace(PROTOCOL, "").replace(TRAILING_SLASH, "");
    const host = authority.startsWith("[")
      ? authority.slice(0, authority.indexOf("]") + 1)
      : authority.split(":")[0];
    if (
      (url.protocol === "http:" && !LOOPBACK.has(host)) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      invalid();
    }
    backend.baseURL = url.origin;
  },
  createAdapter: (options) => createSystemOneAdapter(options, laya),
  decode(value) {
    if (record(value).truncated === true) {
      throw new ClassificationError(
        "INPUT_TRUNCATED",
        "Laya reported truncated input."
      );
    }
    return value;
  },
  defaultModel: "english",
  endpoint(backend) {
    if (backend.provider !== "laya") {
      return invalid();
    }
    return `${backend.baseURL ?? "http://127.0.0.1:8000"}/v1/systemone`;
  },
  fields: ["baseURL"],
};
