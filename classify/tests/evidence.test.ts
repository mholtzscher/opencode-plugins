import { afterEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { Info, ToolContext } from "@opencode/plugin/promise/tool";

import { parseOptions } from "../config.js";
import { createEvidenceResolver } from "../evidence.js";
import { createAdapter } from "../providers/adapter.js";
import type { DecisionAdapter } from "../providers/adapter.js";
import { createPreflight } from "../providers/preflight.js";
import { createClassifier } from "../service.js";
import { buildToolInputSchema } from "../tool-schema.js";
import type { DecisionRequest, JsonValue } from "../types.js";
import { parseInput } from "../validation/input.js";
import { normalizedResponse, questions } from "./fixtures.js";

const exec = promisify(execFile);
type NativeToolInput =
  | { limit: 1; path: string }
  | { command: string; timeout: 30_000; workdir: string };
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});
const fixture = async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  const directory = await mkdtemp("/tmp/opencode/classify-evidence-");
  directories.push(directory);
  return directory;
};
const host = (directory: string, denied?: string) => {
  const calls: { name: string; input: NativeToolInput }[] = [];
  // SAFETY: Evidence resolution only reads the cancellation signal from this host context.
  const context = { signal: new AbortController().signal } as ToolContext;
  const tools = ["read", "shell"].map((name) => ({
    description: "Fake native permission-aware tool",
    execute: (input: NativeToolInput) => {
      calls.push({ input, name });
      if (name === denied) {
        throw new Error("Permission denied: private host detail");
      }
      return Promise.resolve({
        content:
          "Native display output may be truncated; do not use it as evidence.",
      });
    },
    input: { type: "object" },
    name,
  })) satisfies Info[];
  return {
    calls,
    context,
    resolve: createEvidenceResolver(directory, tools, context),
  };
};

test("evidence wrapper is discoverable, validated, and explicit; legacy JSON remains data", () => {
  const state = {
    diffs: [{ base: "HEAD", paths: ["a.ts"] }],
    files: ["a.ts"],
    text: "Review",
    type: "evidence",
  };
  expect(parseInput({ questions, state })).toEqual({ questions, state });
  const legacy = { diffs: [{ base: "HEAD" }], files: ["never-read.env"] };
  expect(parseInput({ questions, state: legacy }).state).toEqual(legacy);
  expect(buildToolInputSchema({})).toHaveProperty(
    "properties.state.anyOf.1.properties.files.items.type",
    "string"
  );
  const invalidStates: JsonValue[] = [
    { type: "evidence" },
    { text: " ", type: "evidence" },
    { files: [], type: "evidence" },
    { files: [""], type: "evidence" },
    { files: ["x\0y"], type: "evidence" },
    { files: Array.from({ length: 65 }, () => "a"), type: "evidence" },
    { files: [{ content: "b", path: "a" }], type: "evidence" },
    { diffs: [], type: "evidence" },
    { diffs: [{ base: "--help" }], type: "evidence" },
    { diffs: [{ base: "HEAD", paths: [] }], type: "evidence" },
    { diffs: [{ base: "HEAD", staged: true }], type: "evidence" },
    { extra: true, text: "x", type: "evidence" },
  ];
  for (const value of invalidStates) {
    expect(() => parseInput({ questions, state: value })).toThrow();
  }
});

test("files resolve on the server, retain labels, and are not display-truncated", async () => {
  const directory = await fixture();
  const content = `${"x".repeat(3000)}\n${"line\n".repeat(2100)}`;
  await writeFile(path.join(directory, "a.ts"), content);
  await symlink(path.join(directory, "a.ts"), path.join(directory, "alias.ts"));
  const h = host(directory);
  const state = await h.resolve(
    { files: ["alias.ts"], text: "Review", type: "evidence" },
    h.context.signal
  );
  expect(state).toEqual({
    files: [{ content, path: "alias.ts" }],
    text: "Review",
  });
  expect(h.calls).toEqual([
    { input: { limit: 1, path: path.join(directory, "a.ts") }, name: "read" },
  ]);
});

test("regular-file replacement during native read fails closed", async () => {
  const directory = await fixture();
  const filePath = path.join(directory, "a.ts");
  const replacement = path.join(directory, "replacement.ts");
  await writeFile(filePath, "approved original");
  await writeFile(replacement, "replacement secret");
  // SAFETY: The resolver only reads signal from this fake host context.
  const context = { signal: new AbortController().signal } as ToolContext;
  const tools = [
    {
      description: "Permission-aware read fixture",
      execute: async (input: NativeToolInput) => {
        if (!("path" in input)) {
          throw new TypeError("Expected read-tool input");
        }
        expect(input.path).toBe(filePath);
        const content = await readFile(filePath, "utf-8");
        await rename(replacement, filePath);
        return { content };
      },
      input: { type: "object" },
      name: "read",
    },
  ] satisfies Info[];
  await expect(
    createEvidenceResolver(
      directory,
      tools,
      context
    )({ files: ["a.ts"], type: "evidence" }, context.signal)
  ).rejects.toThrow("Evidence file changed during permission checking");
});

test("parent-directory symlink replacement during native read fails closed", async () => {
  const directory = await fixture();
  const parent = path.join(directory, "source");
  const external = await fixture();
  await mkdir(parent);
  await writeFile(path.join(parent, "a.ts"), "approved original");
  await writeFile(path.join(external, "a.ts"), "external secret");
  // SAFETY: The resolver only reads signal from this fake host context.
  const context = { signal: new AbortController().signal } as ToolContext;
  const tools = [
    {
      description: "Permission-aware read fixture",
      execute: async (input: NativeToolInput) => {
        if (!("path" in input)) {
          throw new TypeError("Expected read-tool input");
        }
        expect(input.path).toBe(path.join(parent, "a.ts"));
        const content = await readFile(path.join(parent, "a.ts"), "utf-8");
        await rename(parent, path.join(directory, "original"));
        await symlink(external, parent);
        return { content };
      },
      input: { type: "object" },
      name: "read",
    },
  ] satisfies Info[];
  await expect(
    createEvidenceResolver(
      directory,
      tools,
      context
    )({ files: ["source/a.ts"], type: "evidence" }, context.signal)
  ).rejects.toThrow("Evidence file changed during permission checking");
});

test("file errors and native denials fail closed without leaking contents", async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, "secret.env"), "PRIVATE_CONTENT");
  await writeFile(path.join(directory, "binary"), Buffer.from([1, 0, 2]));
  await writeFile(path.join(directory, "invalid"), Buffer.from([0xff]));
  await writeFile(path.join(directory, "huge"), "x".repeat(1024 * 1024 + 1));
  await mkdir(path.join(directory, "folder"));
  await Promise.all(
    ["missing", "binary", "invalid", "huge", "folder"].map(async (filePath) => {
      const h = host(directory);
      await expect(
        h.resolve({ files: [filePath], type: "evidence" }, h.context.signal)
      ).rejects.toThrow();
    })
  );
  const denied = host(directory, "read");
  await expect(
    denied.resolve(
      { files: ["secret.env"], type: "evidence" },
      denied.context.signal
    )
  ).rejects.toThrow("Evidence could not be read");
  const missing = createEvidenceResolver(directory, [], denied.context);
  await expect(
    missing({ files: ["secret.env"], type: "evidence" }, denied.context.signal)
  ).rejects.toThrow("native read tool is required");
});

test("Git diffs include staged and unstaged changes, literal paths, and deleted files", async () => {
  const directory = await fixture();
  const git = (args: string[]) => exec("git", args, { cwd: directory });
  await git(["init", "-q"]);
  await Promise.all(
    ["a.ts", "b.ts", "[literal].ts", "deleted.ts"].map((filePath) =>
      writeFile(path.join(directory, filePath), "original\n")
    )
  );
  await git(["add", "."]);
  await git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "initial",
  ]);
  await writeFile(path.join(directory, "a.ts"), "staged\n");
  await git(["add", "a.ts"]);
  await writeFile(path.join(directory, "a.ts"), "working\n");
  await writeFile(path.join(directory, "b.ts"), "excluded\n");
  await writeFile(path.join(directory, "[literal].ts"), "literal\n");
  await rm(path.join(directory, "deleted.ts"));
  await writeFile(path.join(directory, "untracked.ts"), "untracked\n");
  const h = host(directory);
  const state = await h.resolve(
    {
      diffs: [{ base: "HEAD", paths: ["a.ts", "[literal].ts", "deleted.ts"] }],
      type: "evidence",
    },
    h.context.signal
  );
  const serialized = JSON.stringify(state);
  expect(serialized).toContain("+working");
  expect(serialized).toContain("+literal");
  expect(serialized).toContain("deleted file mode");
  expect(serialized).not.toContain("excluded");
  expect(serialized).not.toContain("untracked");
  expect(h.calls[0].name).toBe("shell");
  expect(h.calls[0].input).toHaveProperty("workdir", directory);
  const denied = host(directory, "shell");
  await expect(
    denied.resolve(
      { diffs: [{ base: "HEAD" }], type: "evidence" },
      denied.context.signal
    )
  ).rejects.toThrow();
  await expect(
    h.resolve(
      { diffs: [{ base: "MISSING_REF" }], type: "evidence" },
      h.context.signal
    )
  ).rejects.toThrow();
  await expect(
    h.resolve(
      { diffs: [{ base: "HEAD", paths: ["../escape"] }], type: "evidence" },
      h.context.signal
    )
  ).rejects.toThrow("session directory");
});

test("service expands evidence before the provider and fails atomically on resolution errors", async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, "a.ts"), "source code");
  const h = host(directory);
  const requests: DecisionRequest[] = [];
  const adapter: DecisionAdapter = {
    decide: (request) => {
      requests.push(request);
      return Promise.resolve(normalizedResponse());
    },
    preflight: createPreflight(["noul", "choice", "score"]),
    provider: "laya",
    supportedTypes: ["noul", "choice", "score"],
  };
  const service = createClassifier(
    parseOptions({
      backend: { provider: "laya" },
      classifiers: { review: { description: "Review", questions } },
    }),
    adapter
  );
  expect(
    await service.classify(
      { classifier: "review", state: { files: ["a.ts"], type: "evidence" } },
      h.context.signal,
      h.resolve
    )
  ).toHaveProperty("ok", true);
  expect(requests[0].state).toEqual({
    files: [{ content: "source code", path: "a.ts" }],
  });
  expect(
    await service.classify(
      { questions, state: { files: ["missing"], type: "evidence" } },
      h.context.signal,
      h.resolve
    )
  ).toHaveProperty("error.code", "EVIDENCE_ERROR");
  expect(requests).toHaveLength(1);
  expect(
    await service.classify(
      { questions, state: { text: { message: "Review" }, type: "evidence" } },
      h.context.signal
    )
  ).toHaveProperty("ok", true);
  expect(requests[1].state).toEqual({ text: { message: "Review" } });
  const controller = new AbortController();
  controller.abort();
  await expect(
    service.classify(
      { questions, state: { files: ["a.ts"], type: "evidence" } },
      controller.signal,
      h.resolve
    )
  ).rejects.toThrow();
});
test("expanded evidence budget includes JSON escaping and fails before provider work", async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, "escaped.ts"), '"'.repeat(600_000));
  const h = host(directory);
  await expect(
    h.resolve({ files: ["escaped.ts"], type: "evidence" }, h.context.signal)
  ).rejects.toThrow("classification contract");
  await writeFile(path.join(directory, "a.ts"), "a".repeat(600_000));
  await writeFile(path.join(directory, "b.ts"), "b".repeat(600_000));
  await expect(
    h.resolve({ files: ["a.ts", "b.ts"], type: "evidence" }, h.context.signal)
  ).rejects.toThrow("1 MiB");
});
test("unavailable providers and unknown classifiers never resolve evidence", async () => {
  const options = parseOptions({ backend: { provider: "openai-decisions" } });
  const service = createClassifier(options, createAdapter(options));
  let reads = 0;
  const resolver = () => {
    reads += 1;
    return Promise.resolve("Unexpected evidence read");
  };
  const state = { files: ["secret.env"], type: "evidence" };
  const { signal } = new AbortController();
  expect(
    await service.classify({ questions, state }, signal, resolver)
  ).toHaveProperty("error.code", "PROVIDER_UNAVAILABLE");
  expect(
    await service.classify({ classifier: "missing", state }, signal, resolver)
  ).toHaveProperty("error.code", "UNKNOWN_CLASSIFIER");
  expect(reads).toBe(0);
});
