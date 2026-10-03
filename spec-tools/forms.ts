import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import type { Plugin } from "@opencode/plugin";
import { z } from "zod";

export type Forms = ReturnType<typeof OpenCode.make>["session"]["form"];

const optionsSchema = z
  .object({
    serverPasswordEnv: z.string().min(1).optional(),
    serverURL: z.url().optional(),
  })
  .refine((options) => !options.serverPasswordEnv || options.serverURL, {
    message: "serverPasswordEnv requires serverURL",
  });

/** The plugin context does not yet expose session forms. Never start a service here. */
export const connectForms = async (
  options: Plugin.Context["options"]
): Promise<Forms> => {
  const { serverPasswordEnv: passwordEnv, serverURL: url } =
    optionsSchema.parse(options);
  let client: ReturnType<typeof OpenCode.make>;
  if (url) {
    const password = passwordEnv
      ? process.env[passwordEnv]
      : process.env.OPENCODE_PASSWORD;
    if (passwordEnv && !password) {
      throw new Error(
        `Missing authentication environment variable: ${passwordEnv}`
      );
    }
    client = OpenCode.make({
      baseUrl: url,
      headers: password
        ? {
            authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
          }
        : undefined,
    });
  } else {
    const endpoint = await Service.discover();
    if (!endpoint) {
      throw new Error(
        "Session forms require a running managed OpenCode service or the spec-tools serverURL option. You can also pass an idea or spec path directly."
      );
    }
    client = OpenCode.make({
      baseUrl: endpoint.url,
      headers: Service.headers(endpoint),
    });
  }
  // Do not accidentally create forms on a different server in standalone mode.
  const info = await client.server.info();
  if (info.pid !== process.pid) {
    throw new Error(
      "The forms endpoint is not this OpenCode server. Configure spec-tools serverURL for this server, or pass command arguments directly."
    );
  }
  return client.session.form;
};
