import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import {
  commandInput,
  commandNames,
  makeHost,
  sessionID,
  skills,
} from "./test-support/host.js";

describe("shared command execution", () => {
  const successful = [
    [
      "spec-create",
      '  --literal "idea"\n@second line  ',
      '--literal "idea"\n@second line',
    ],
    ["spec-implement", "@specs/example.md", "specs/example.md"],
    ["spec-refine", "example.md", "specs/example.md"],
    ["pr-publish", "publication guidance", "publication guidance"],
    ["pr-rewrite", "metadata guidance", "metadata guidance"],
    ["pr-triage", "", "No unresolved inline review threads found"],
    ["pr-fix", "", "42"],
    ["pr-checks", "", "pending"],
  ] as const;
  for (const delivery of ["queue", "steer"] as const) {
    test.each(successful)(
      `/%s preserves attachments, agents, session and ${delivery}`,
      async (name, input, expected) => {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* promptDelivery() {
              const host = yield* makeHost();
              yield* host.run(name, input, delivery);
              expect(host.admissions).toHaveLength(1);
              expect(host.admissions[0]).toEqual({
                agents: [{ name: "reviewer" }],
                delivery,
                files: [
                  {
                    description: "attachment",
                    name: "notes",
                    uri: "file:///attachment.txt",
                  },
                ],
                sessionID,
                skills,
                text: expect.stringContaining(expected),
              });
              if (name === "spec-create") {
                expect(host.admissions[0]?.text).toContain(
                  `Idea:\n\n${expected}\n\nAfter creation`
                );
              }
              expect(host.reads).toEqual(
                name === "spec-create" ? [] : [sessionID]
              );
              expect(
                host.processes.every(
                  (process) => process.cwd === `${host.directory}/session`
                )
              ).toBe(true);
              expect(host.closedProcesses).toBe(host.processes.length);
              expect(host.forbiddenCalls).toBe(0);
              expect(host.subscriptions).toBe(0);
            })
          )
        );
      }
    );
  }

  const malformedPaths = [
    "",
    " ",
    '"unfinished',
    "'unfinished",
    "example.md extra.md",
    "my idea.md",
    "--unknown example.md",
    "--stacked example.md",
    "--background example.md",
    "--simplify example.md",
    "--",
    "-draft.md",
  ];
  const invalidArguments = [
    ["spec-create", "   "],
    ...["spec-implement", "spec-refine"].flatMap((name) =>
      malformedPaths.map((input) => [name, input])
    ),
    ...["pr-publish", "pr-rewrite"].flatMap((name) =>
      ["--describe", "--update", "--refresh", "--watch"].map((input) => [
        name,
        input,
      ])
    ),
    ["pr-rewrite", "--no-watch"],
    ...["pr-triage", "pr-fix", "pr-checks"].flatMap((name) =>
      ["scope", "--watch"].map((input) => [name, input])
    ),
  ];
  test.each(invalidArguments)(
    "/%s rejects %s before reads or admission",
    async (name, input) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* rejectedArguments() {
            const host = yield* makeHost();
            const error = yield* host.run(name ?? "", input).pipe(Effect.flip);
            expect(error).toEqual(
              expect.objectContaining({
                message: expect.stringContaining("Usage:"),
              })
            );
            expect(host.reads).toEqual([]);
            expect(host.filesystemReads).toEqual([]);
            expect(host.processes).toEqual([]);
            expect(host.admissions).toEqual([]);
            expect(host.forbiddenCalls).toBe(0);
            expect(host.subscriptions).toBe(0);
          })
        )
      );
    }
  );

  test.each([
    "spec-implement",
    "spec-refine",
    "pr-publish",
    "pr-rewrite",
    "pr-triage",
    "pr-fix",
    "pr-checks",
  ])("/%s preserves SDK session errors", async (name) => {
    const sdkError = {
      _tag: "ClientError",
      cause: new Error("session unavailable"),
    };
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* sessionErrors() {
          const host = yield* makeHost({ read: Effect.fail(sdkError) });
          expect(
            yield* host
              .run(name, name.startsWith("spec-") ? "example.md" : "")
              .pipe(Effect.flip)
          ).toBe(sdkError);
          expect(host.filesystemReads).toEqual([]);
          expect(host.processes).toEqual([]);
          expect(host.admissions).toEqual([]);
          expect(host.subscriptions).toBe(0);
        })
      )
    );
  });
  test.each(commandNames)(
    "/%s preserves SDK admission errors",
    async (name) => {
      const sdkError = {
        _tag: "ClientError",
        cause: new Error("admission rejected"),
      };
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* admissionErrors() {
            const host = yield* makeHost({ admission: Effect.fail(sdkError) });
            expect(
              yield* host.run(name, commandInput(name)).pipe(Effect.flip)
            ).toBe(sdkError);
            expect(host.admissions).toEqual([]);
            expect(host.subscriptions).toBe(0);
          })
        )
      );
    }
  );
});
