import { expect, test } from "bun:test";

import { file, JSONC } from "bun";
import { Effect, Schema } from "effect";

import { loadOptions } from "../config.js";
import { buildToolDescription } from "../tool-description.js";
import { parseInput } from "../validation/input.js";

const EXPECTED_NAMES = [
  "issue-triage",
  "spec-readiness",
  "task-decomposition",
  "change-kind",
  "change-risk",
  "test-file-quality",
  "review-routing",
  "api-compatibility",
  "migration-risk",
  "observability-review",
  "dependency-update",
  "generated-code-review",
  "release-gating",
  "incident-triage",
  "postmortem-quality",
  "scope-discipline",
];

const exampleConfig = await file(
  new URL("../examples/sdlc.opencode.json", import.meta.url)
).json();
const options = Effect.runSync(loadOptions(exampleConfig.plugins[0].options));

test("portable and repository SDLC catalogs validate and stay in sync", async () => {
  const repositoryConfig = Effect.runSync(
    Schema.decodeUnknownEffect(
      Schema.Struct({ plugins: Schema.Array(Schema.Unknown) })
    )(
      JSONC.parse(
        await file(new URL("../../opencode.jsonc", import.meta.url)).text()
      )
    )
  );
  const entry = repositoryConfig.plugins.find(
    Schema.is(
      Schema.Struct({
        options: Schema.Unknown,
        package: Schema.Literal("./classify"),
      })
    )
  );
  const repositoryOptions = Effect.runSync(loadOptions(entry?.options));
  expect(repositoryOptions.backend.provider).toBe("cloudflare");
  expect(options.backend.provider).toBe("typesafe");
  expect(repositoryOptions.classifiers).toEqual(options.classifiers);
  expect(Object.keys(options.classifiers)).toEqual(EXPECTED_NAMES);
  for (const definition of Object.values(options.classifiers)) {
    expect(Object.hasOwn(definition, "state")).toBe(false);
    expect(definition.questions.evidence_sufficient.type).toBe("noul");
  }
});

test("every documented invocation is valid and advertised as caller-state mode", async () => {
  const guide = await file(
    new URL("../SDLC_CLASSIFIERS.md", import.meta.url)
  ).text();
  const block = /```json\n(?<examples>[\s\S]*?)\n```/u.exec(guide)?.groups
    ?.examples;
  expect(block).toBeDefined();
  const invocations = JSON.parse(block ?? "[]");
  expect(
    invocations.map((input: { classifier: string }) => input.classifier)
  ).toEqual(EXPECTED_NAMES);
  const description = buildToolDescription(options.classifiers);
  for (const input of invocations) {
    expect(Effect.runSync(parseInput(input, options.classifiers))).toEqual(
      input
    );
    expect(description).toContain(
      `${input.classifier}: ${options.classifiers[input.classifier].description} (requires caller-supplied state)`
    );
    expect(() =>
      Effect.runSync(
        parseInput({ classifier: input.classifier }, options.classifiers)
      )
    ).toThrow();
  }
});
