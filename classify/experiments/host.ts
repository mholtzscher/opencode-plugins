import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import { JsonValueSchema, QuestionsStructure } from "../schemas.js";
import type { JsonValue } from "../types.js";
import { corpus, expectedContent, readCorpusSource } from "./corpus.js";

const root = path.resolve(
  process.argv[2] ?? "/tmp/opencode/classify-validation"
);
const project = path.join(root, "host-project");
await mkdir(path.join(project, ".opencode/plugins"), { recursive: true });
const requests: {
  model: string;
  questions: typeof QuestionsStructure.Type;
  state: JsonValue;
}[] = [];
const requestSchema = Schema.Struct({
  model: Schema.String,
  questions: QuestionsStructure,
  state: JsonValueSchema,
});
const recorder = Bun.serve({
  fetch: async (request) => {
    const input = Schema.decodeUnknownSync(requestSchema)(await request.json());
    requests.push(input);
    return Response.json({
      answers: Object.fromEntries(
        Object.keys(input.questions).map((key) => [
          key,
          { noul: 1, type: "noul" },
        ])
      ),
      model: "recording-backend",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
  },
  hostname: "127.0.0.1",
  port: 0,
});
const probe = Bun.serve({
  fetch: () => new Response(""),
  hostname: "127.0.0.1",
  port: 0,
});
const { port } = probe;
probe.stop(true);
const baseURL = `http://127.0.0.1:${port}`;
const plugin = fileURLToPath(new URL("../", import.meta.url));
const bridge = fileURLToPath(new URL("host-plugin.ts", import.meta.url));
await writeFile(
  path.join(project, ".opencode/plugins/validation.ts"),
  `export { default } from ${JSON.stringify(bridge)};\n`
);
await writeFile(
  path.join(project, "opencode.json"),
  JSON.stringify({
    permissions: [
      { action: "*", effect: "allow", resource: "*" },
      { action: "read", effect: "deny", resource: "*denied.go" },
    ],
    plugins: [
      {
        options: {
          backends: {
            recorder: { baseURL: recorder.url.origin, provider: "laya" },
          },
          defaultBackend: "recorder",
          maxRetries: 0,
        },
        package: plugin,
      },
    ],
    snapshots: false,
  })
);
const source =
  'package fixture\n// Explicit docs\nfunc Get() string { return "café 😀" }\nfunc Set() {}\n';
await Promise.all([
  writeFile(path.join(project, "source.go"), source),
  writeFile(path.join(project, "denied.go"), source),
  writeFile(path.join(project, "broken.go"), "package x\nfunc broken( {"),
  writeFile(path.join(project, "large.go"), "x".repeat(1024 * 1024 + 1)),
  writeFile(path.join(project, "context.txt"), "x".repeat(600_000)),
  writeFile(
    path.join(project, "budget.go"),
    `package x\n// ${"x".repeat(600_000)}\nfunc Get() {}\n`
  ),
  writeFile(
    path.join(project, "many.go"),
    `package x\n${Array.from({ length: 129 }, (_, i) => `func f${i}() {}`).join("\n")}\n`
  ),
  writeFile(
    path.join(project, "expensive.go"),
    `package x\n// ${"a".repeat(60_000)}!\n`
  ),
  writeFile(
    path.join(project, "escaped.go"),
    `package x\nconst text = \`${'"'.repeat(600_000)}\`\n`
  ),
]);
await rm(path.join(project, "alias.go"), { force: true });
await symlink(path.join(project, "denied.go"), path.join(project, "alias.go"));
const server = Bun.spawn(
  ["opencode", "serve", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: project,
    env: {
      ...process.env,
      OPENCODE_DB: path.join(root, "host.db"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_STATE_HOME: path.join(root, "state"),
    },
    stderr: "pipe",
    stdout: "pipe",
  }
);
let output = "";
const stdout = (async () => {
  for await (const chunk of server.stdout) {
    output += new TextDecoder().decode(chunk);
  }
  return output.replaceAll(
    /server password .*/gu,
    "server password [redacted]"
  );
})();
const auth = () => ({
  authorization: `Basic ${Buffer.from(`opencode:${/server password (?<password>\S+)/u.exec(output)?.groups?.password ?? ""}`).toString("base64")}`,
});
const stderr = new Response(server.stderr).text();
const api = async (route: string, body?: JsonValue) => {
  const response = await fetch(`${baseURL}${route}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...auth(), "content-type": "application/json" },
    method: body === undefined ? "GET" : "POST",
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Host ${route}: ${response.status} ${text}`);
  }
  return text
    ? Schema.decodeUnknownSync(Schema.fromJsonString(JsonValueSchema))(text)
    : null;
};

try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Bounded startup readiness handshake for our owned server.
      const response = await fetch(`${baseURL}/api/info`, {
        headers: auth(),
        signal: AbortSignal.timeout(500),
      });
      ready = response.ok;
      if (ready) {
        break;
      }
    } catch {
      /* Server is still starting. */
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- Retry only the bounded startup handshake.
    await Bun.sleep(100);
  }
  if (!ready) {
    throw new Error("Validation server did not start");
  }
  const session = Schema.decodeUnknownSync(
    Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })
  )(
    await api("/api/session", {
      location: { directory: project },
      title: "Classify deterministic validation",
    })
  );
  const plugins = await api(
    `/api/plugin?location[directory]=${encodeURIComponent(project)}`
  );
  await writeFile(
    path.join(root, "host-plugins.json"),
    JSON.stringify(plugins, null, 2)
  );
  const invoke = async (tool: string, input: JsonValue) => {
    await api(`/api/session/${session.data.id}/command`, {
      name: "code-validation",
      text: JSON.stringify({ input, tool }),
    });
    return Schema.decodeUnknownSync(Schema.fromJsonString(JsonValueSchema))(
      await readFile(path.join(project, "host-result.json"), "utf-8")
    );
  };
  const grammar = await invoke("classify_grammar", {
    node: "function_declaration",
    path: "missing.go",
  });
  const questions = {
    valid: {
      instructions: "Does the evidence contain source code?",
      type: "noul",
    },
  };
  const query =
    '((function_declaration name: (identifier) @_n) @evidence (#eq? @_n "Get"))';
  const positive = await invoke("classify", {
    questions,
    state: { code: [{ path: "source.go", query }], type: "evidence" },
  });
  const captureSchema = Schema.Struct({
    code: Schema.Array(
      Schema.Struct({
        captures: Schema.Array(
          Schema.Struct({
            content: Schema.String,
            endIndex: Schema.Number,
            endLine: Schema.Number,
            startIndex: Schema.Number,
            startLine: Schema.Number,
          })
        ),
      })
    ),
  });
  const expanded = Schema.decodeUnknownSync(captureSchema)(requests[0]?.state);
  const [capture] = expanded.code[0].captures;
  const expected = 'func Get() string { return "café 😀" }';
  if (
    capture.content !== expected ||
    source.slice(capture.startIndex, capture.endIndex) !== expected ||
    capture.startLine !== 3 ||
    capture.endLine !== 3
  ) {
    throw new Error(
      "Recorded capture differs from the independent expected source"
    );
  }
  const outcomes = [
    { case: "exact-provider-payload", passed: true, requests: requests.length },
  ];
  const sources = await Promise.all(
    corpus.map(async (entry) => {
      const content = await readCorpusSource(entry);
      const relative = `${entry.id}${path.extname(entry.path)}`;
      await writeFile(path.join(project, relative), content);
      return { content, entry, relative };
    })
  );
  const combined = await invoke("classify", {
    questions,
    state: {
      code: sources.map(({ entry, relative }) => ({
        path: relative,
        query: entry.query,
      })),
      type: "evidence",
    },
  });
  const combinedState = Schema.decodeUnknownSync(captureSchema)(
    requests[1]?.state
  );
  for (const [index, { entry, content }] of sources.entries()) {
    const { captures } = combinedState.code[index];
    if (
      captures.length !== 1 ||
      captures[0].content !== expectedContent(content, entry) ||
      content.slice(captures[0].startIndex, captures[0].endIndex) !==
        captures[0].content ||
      captures[0].startLine !== entry.lines[0] ||
      captures[0].endLine !== entry.lines[1]
    ) {
      throw new Error(`Real-host corpus mismatch: ${entry.id}`);
    }
  }
  outcomes.push({
    case: "combined-real-go-typescript-kotlin-payload",
    passed: true,
    requests: 1,
  });
  await invoke("classify", {
    questions,
    state: {
      code: [{ path: "budget.go", query }],
      files: ["context.txt"],
      type: "evidence",
    },
  });
  const budgetState = Schema.decodeUnknownSync(captureSchema)(
    requests[2]?.state
  );
  if (budgetState.code[0].captures[0].content !== "func Get() {}") {
    throw new Error("Selected content budget regression");
  }
  outcomes.push({ case: "selected-content-budget", passed: true, requests: 1 });
  const negative: [string, JsonValue][] = [
    [
      "aggregate-capture-budget",
      {
        code: [{ path: "budget.go", query: "(source_file) @evidence" }],
        files: ["context.txt"],
        type: "evidence",
      },
    ],
    ["denied", { code: [{ path: "denied.go", query }], type: "evidence" }],
    [
      "denied-symlink",
      { code: [{ path: "alias.go", query }], type: "evidence" },
    ],
    [
      "invalid-query",
      {
        code: [{ path: "source.go", query: "(missing_node) @evidence" }],
        type: "evidence",
      },
    ],
    [
      "no-match",
      {
        code: [{ path: "source.go", query: "(method_declaration) @evidence" }],
        type: "evidence",
      },
    ],
    [
      "missing-capture",
      {
        code: [{ path: "source.go", query: "(function_declaration) @other" }],
        type: "evidence",
      },
    ],
    [
      "query-length",
      {
        code: [{ path: "source.go", query: "x".repeat(8193) }],
        type: "evidence",
      },
    ],
    [
      "capture-limit",
      {
        code: [{ path: "many.go", query: "(function_declaration) @evidence" }],
        type: "evidence",
      },
    ],
    ["syntax", { code: [{ path: "broken.go", query }], type: "evidence" }],
    ["file-limit", { code: [{ path: "large.go", query }], type: "evidence" }],
    [
      "expanded-json-limit",
      {
        code: [{ path: "escaped.go", query: "(source_file) @evidence" }],
        type: "evidence",
      },
    ],
    [
      "deadline",
      {
        code: [
          {
            path: "expensive.go",
            query:
              '((comment) @evidence (#match? @evidence "(a+)+$"))\n'.repeat(32),
          },
        ],
        type: "evidence",
      },
    ],
  ];
  const failureSchema = Schema.Struct({
    output: Schema.Struct({
      error: Schema.Struct({ attempts: Schema.Number, code: Schema.String }),
      ok: Schema.Literal(false),
    }),
  });
  for (const [name, state] of negative) {
    const count = requests.length;
    // oxlint-disable-next-line eslint/no-await-in-loop -- Serialize cases so every failure has an exact dispatch count.
    const result = await invoke("classify", { questions, state });
    const failure = Schema.decodeUnknownSync(failureSchema)(result);
    const passed =
      requests.length === count && failure.output.error.attempts === 0;
    outcomes.push({ case: name, passed, requests: requests.length - count });
    if (!passed) {
      throw new Error(`Failure ${name} dispatched a provider request`);
    }
  }
  await writeFile(
    path.join(root, "host.json"),
    JSON.stringify(
      { combined, grammar, outcomes, positive, version: "OpenCode 2.0.22" },
      null,
      2
    )
  );
  await writeFile(
    path.join(root, "recorded-requests.json"),
    JSON.stringify(requests, null, 2)
  );
  console.log(
    JSON.stringify({
      cases: outcomes.length,
      passed: outcomes.every((entry) => entry.passed),
      providerRequests: requests.length,
    })
  );
} finally {
  server.kill();
  await server.exited;
  await writeFile(path.join(root, "server.stdout.log"), await stdout);
  await writeFile(path.join(root, "server.stderr.log"), await stderr);
  recorder.stop(true);
}
