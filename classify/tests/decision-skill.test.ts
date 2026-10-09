import { afterEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Skill } from "@opencode/schema/skill";
import { Effect, Schema } from "effect";

import { buildInputSchema } from "../classification-schemas.js";
import { loadDecisionSkill } from "../decision-skill.js";
import { createPluginFixture } from "./plugin-fixtures.js";

const { dispose, register } = createPluginFixture();
afterEach(dispose);

test("entry registers a discoverable skill from the package rather than the session directory", async () => {
  const skills: Skill.Info[] = [];
  await register(
    {
      backends: { local: { provider: "laya" } },
      defaultBackend: "local",
    },
    { directory: "/tmp/opencode/unrelated-project", skills, tools: [] }
  );
  expect(skills).toHaveLength(1);
  const [skill] = skills;
  expect(skill).toHaveProperty("id", "classify-decide");
  expect(skill.description?.length).toBeGreaterThan(0);
  expect(skill.autoinvoke).not.toBe(false);
  expect(skill).toHaveProperty(
    "path",
    fileURLToPath(
      new URL("../skills/classify-decide/SKILL.md", import.meta.url)
    )
  );
  const markdown = await readFile(skill.path, "utf-8");
  expect(skill.content.length).toBeGreaterThan(0);
  expect(skill.content.startsWith("---")).toBe(false);
  expect(markdown).toContain(skill.content);
});

test("bundled skill references resolve, use consistent layouts, and satisfy the live ad hoc contract", async () => {
  const skill = await Effect.runPromise(loadDecisionSkill());
  const links = [
    ...skill.content.matchAll(/\]\((?<reference>references\/[^)]+)\)/gu),
  ];
  expect(links.length).toBeGreaterThan(0);
  const decode = Schema.decodeUnknownSync(
    Schema.fromJsonString(buildInputSchema({}))
  );
  const references = await Promise.all(
    links.map(([, relative]) =>
      readFile(path.join(path.dirname(skill.path), relative), "utf-8")
    )
  );
  for (const text of references) {
    const headings = [
      ...text.matchAll(
        /^#{2,3} (?<heading>Evidence needed|Example payload|Consume the answers|Limitations)$/gmu
      ),
    ].map(([, heading]) => heading);
    expect(headings.length).toBeGreaterThan(0);
    for (let index = 0; index < headings.length;) {
      expect(headings.slice(index, index + 3)).toEqual([
        "Evidence needed",
        "Example payload",
        "Consume the answers",
      ]);
      index += 3;
      if (headings[index] === "Limitations") {
        index += 1;
      }
    }
    const examples = [...text.matchAll(/```json\n(?<input>[\s\S]*?)\n```/gu)];
    expect(examples.length).toBeGreaterThan(0);
    for (const [, example] of examples) {
      expect(() => decode(example)).not.toThrow();
    }
  }
});
