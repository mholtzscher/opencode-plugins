import { expect, test } from "bun:test";

import { buildToolDescription } from "../tool-description.js";
import { parseInputSync } from "./effect-fixtures.js";
import { questions } from "./fixtures.js";

test("ad hoc description retains tool semantics without advertising classifiers", () => {
  const description = buildToolDescription({});
  expect(description).toContain("probability of yes, not a boolean");
  expect(description).toContain("not a percentage");
  expect(description).toContain("no partial answers");
  expect(description).toContain("Native read/shell permissions");
  expect(description).toContain("Returns structured output");
  expect(description).not.toContain("JSON.parse");
  expect(description).not.toContain("Configured classifiers:");
  expect(description).not.toContain("classifier");
});
test("named description advertises caller and preset state without changing definitions", () => {
  const classifiers = {
    caller: { description: "Assess caller input", questions },
    preset: {
      description: "Review fresh evidence",
      questions,
      state: { files: ["rules.md"], type: "evidence" as const },
    },
  };
  const snapshot = JSON.stringify(classifiers);
  const description = buildToolDescription(classifiers);
  expect(description).toContain(
    "caller: Assess caller input (requires caller-supplied state)"
  );
  expect(description).toContain(
    "preset: Review fresh evidence (uses configured state; omit state)"
  );
  expect(description).toContain("Configured classifiers:");
  expect(JSON.stringify(classifiers)).toBe(snapshot);
  expect(buildToolDescription(classifiers)).toBe(description);
});
test("description includes a valid structured-state example", () => {
  const prefix = "Example input: ";
  const example = buildToolDescription({})
    .split("\n")
    .find((line) => line.startsWith(prefix));
  if (example === undefined) {
    throw new Error("Missing discoverable example");
  }
  const parsed = parseInputSync(JSON.parse(example.slice(prefix.length)));
  expect(
    Object.values(parsed.questions ?? {}).map((question) => question.type)
  ).toEqual(["noul"]);
  expect(parsed.state).toEqual({
    claim: "All items passed.",
    observations: ["A passed.", "B failed."],
  });
});
