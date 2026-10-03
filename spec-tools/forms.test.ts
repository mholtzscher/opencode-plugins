import { afterEach, describe, expect, test } from "bun:test";

import { connectForms } from "./forms.js";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

const makeServer = (pid = process.pid) => {
  const authorization: (string | null)[] = [];
  const server = Bun.serve({
    fetch(request) {
      authorization.push(request.headers.get("authorization"));
      return Response.json({
        paths: { tmp: "/tmp/opencode" },
        pid,
        urls: [],
        version: "2.0.22",
      });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  servers.push(server);
  return { authorization, url: server.url.toString() };
};

describe("forms connection", () => {
  test("explicit endpoints use Basic authentication from the named environment variable", async () => {
    const server = makeServer();
    const name = `SPEC_TOOLS_TEST_PASSWORD_${crypto.randomUUID().replaceAll("-", "")}`;
    process.env[name] = "test-password";
    try {
      const forms = await connectForms({
        serverPasswordEnv: name,
        serverURL: server.url,
      });
      expect(forms.create).toBeFunction();
      expect(server.authorization).toEqual([
        `Basic ${Buffer.from("opencode:test-password").toString("base64")}`,
      ]);
    } finally {
      // oxlint-disable-next-line typescript/no-dynamic-delete -- Environment variables must be removed, not assigned undefined.
      delete process.env[name];
    }
  });

  test("rejects an endpoint for a different server process", async () => {
    const server = makeServer(process.pid + 1);
    await expect(connectForms({ serverURL: server.url })).rejects.toThrow(
      "not this OpenCode server"
    );
  });

  test("rejects malformed options and missing authentication before making a request", async () => {
    const server = makeServer();
    await expect(connectForms({ serverURL: 42 })).rejects.toThrow();
    await expect(
      connectForms({ serverPasswordEnv: "SPEC_TOOLS_NONEXISTENT_PASSWORD" })
    ).rejects.toThrow("requires serverURL");
    await expect(
      connectForms({
        serverPasswordEnv: "SPEC_TOOLS_NONEXISTENT_PASSWORD",
        serverURL: server.url,
      })
    ).rejects.toThrow("Missing authentication");
    expect(server.authorization).toEqual([]);
  });
});
