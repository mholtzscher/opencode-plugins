import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Tool } from "@opencode/schema/tool";
import { serve } from "bun";
import { Deferred, Effect, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";

import { loadOptions } from "../config.js";
import { classifyLayer } from "../layers.js";
import { routeSearch } from "../router.js";
import { createSearchTool } from "../search-tool.js";
import { FileSearch } from "../search.js";
import { createSelection } from "../selection.js";
import { toolContext } from "./effect-fixtures.js";
import { createPluginFixture } from "./plugin-fixtures.js";

// Exercise the retained search implementation through test-only registration.
const { dispose, register } = createPluginFixture((context) =>
  Effect.gen(function* setupSearchFixture() {
    const options = yield* loadOptions(context.options).pipe(Effect.orDie);
    const selection = createSelection(options, context.storage);
    const searches = new Map<string, typeof FileSearch.Service>();
    for (const [name, backend] of Object.entries(options.backends)) {
      const services = yield* Layer.build(
        classifyLayer(options, backend, context)
      );
      searches.set(
        name,
        yield* FileSearch.pipe(Effect.provideContext(services))
      );
    }
    const searchTool = yield* createSearchTool(options).pipe(
      Effect.provideService(
        FileSearch,
        routeSearch(options, selection, searches)
      )
    );
    yield* context.tool.transform((editor) => {
      editor.add(searchTool);
    });
  })
);
afterEach(dispose);

test("search sends only bounded prefixes, checks native reads, and captures one backend for every file", async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  const directory = await mkdtemp("/tmp/opencode/classify-plugin-search-");
  const requests: unknown[] = [];
  const reads: unknown[] = [];
  const stored = new Map<string, Schema.Json>();
  const wire = Schema.Struct({
    model: Schema.String,
    state: Schema.Struct({
      file: Schema.Struct({ content: Schema.String, path: Schema.String }),
    }),
  });
  const fixture = serve({
    fetch: async (request) => {
      const body: unknown = await request.json();
      requests.push(body);
      const parsed = Schema.decodeUnknownSync(wire)(body);
      return Response.json({
        answers: {
          relevant: {
            noul: parsed.state.file.path.endsWith("z.ts") ? 0.9 : 0.2,
            type: "noul",
          },
        },
        model: parsed.model,
        usage: { input_tokens: 10, output_tokens: 2 },
      });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    await Promise.all(
      ["a.ts", "z.ts"].map((name) =>
        writeFile(path.join(directory, name), "RETRY selected\nUNREAD secret\n")
      )
    );
    await writeFile(
      path.join(directory, "filtered.ts"),
      "unrelated\nretry hidden\n"
    );
    await writeFile(path.join(directory, "empty.ts"), "");
    await writeFile(path.join(directory, "invalid.ts"), Buffer.from([255]));
    await mkdir(path.join(directory, "denied"));
    const tools = await register(
      {
        backends: {
          first: {
            baseURL: fixture.url.origin,
            model: "first-model",
            provider: "laya",
          },
          second: {
            baseURL: fixture.url.origin,
            model: "second-model",
            provider: "laya",
          },
        },
        defaultBackend: "first",
        search: { linesPerFile: 1 },
      },
      {
        directory,
        stored,
        tools: [
          {
            description: "Native read",
            execute: (args) => {
              reads.push(args);
              stored.set(`selection/${toolContext().sessionID}`, "second");
              const { path: readPath } = Schema.decodeUnknownSync(
                Schema.Struct({ path: Schema.String })
              )(args);
              return readPath.endsWith("denied")
                ? Effect.fail(
                    new Tool.Error({ message: "PRIVATE permission detail" })
                  )
                : Effect.succeed({ content: "Ignored preview" });
            },
            input: Schema.Unknown,
            name: "read",
          },
        ],
      }
    );
    const searchInput = {
      paths: ["."],
      query: "Find retries",
      terms: ["retry"],
    };
    const first = await Effect.runPromise(
      tools[0].execute(searchInput, toolContext())
    );
    expect(first.output).toMatchObject({
      ok: true,
      result: {
        backend: "first",
        coverage: {
          classified: 2,
          complete: false,
          discovered: 5,
          failed: 3,
          filtered: 1,
          partialFiles: 3,
        },
        matches: [
          {
            model: "first-model",
            path: path.join(directory, "z.ts"),
            relevance: 0.9,
          },
          {
            model: "first-model",
            path: path.join(directory, "a.ts"),
            relevance: 0.2,
          },
        ],
      },
    });
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request).toHaveProperty("state.file.content", "RETRY selected\n");
      expect(request).toHaveProperty("model", "first-model");
    }
    expect(reads).toContainEqual({ limit: 1, path: directory });
    expect(reads).toContainEqual({
      limit: 1,
      path: path.join(directory, "denied"),
    });
    expect(reads).toContainEqual({
      limit: 1,
      path: path.join(directory, "a.ts"),
    });
    expect(JSON.stringify(first)).not.toContain("PRIVATE");
    expect(JSON.stringify(first)).not.toContain("RETRY selected");
    const next = await Effect.runPromise(
      tools[0].execute({ ...searchInput, paths: ["z.ts"] }, toolContext())
    );
    expect(next.output).toHaveProperty("result.backend", "second");
    expect(requests[2]).toHaveProperty("model", "second-model");
  } finally {
    fixture.stop(true);
    await rm(directory, { force: true, recursive: true });
  }
});

test("search deadline interrupts directory permission waits and retains discovery coverage", async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  const directory = await mkdtemp("/tmp/opencode/classify-search-deadline-");
  try {
    await writeFile(path.join(directory, "a.ts"), "source");
    await mkdir(path.join(directory, "blocked"));
    const blocked = await Effect.runPromise(Deferred.make<boolean>());
    const tools = await register(
      {
        backends: { local: { provider: "laya" } },
        defaultBackend: "local",
        search: { timeoutMs: 1000 },
      },
      {
        directory,
        tools: [
          {
            description: "Waiting read",
            execute: () =>
              Deferred.succeed(blocked, true).pipe(
                Effect.andThen(Effect.never)
              ),
            input: Schema.Unknown,
            name: "read",
          },
        ],
      }
    );
    await Effect.runPromise(
      Effect.gen(function* permissionDeadline() {
        const fiber = yield* Effect.forkChild(
          tools[0].execute(
            { paths: ["a.ts", "blocked"], query: "Find source" },
            toolContext()
          )
        );
        yield* Deferred.await(blocked);
        yield* TestClock.adjust("1 second");
        expect((yield* Fiber.join(fiber)).output).toMatchObject({
          ok: true,
          result: {
            coverage: {
              complete: false,
              discovered: 1,
              discoveryComplete: false,
              examined: 0,
              limitsReached: ["deadline"],
            },
            matches: [],
          },
        });
      }).pipe(Effect.provide(TestClock.layer()))
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
