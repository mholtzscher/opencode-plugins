import { expect, test } from "bun:test";

import { buildToolInputSchema } from "../tool-schema.js";
import { questions } from "./fixtures.js";

test("tool schema advertises only configured classifier modes", () => {
  expect(buildToolInputSchema({})).not.toHaveProperty("oneOf");
  expect(
    buildToolInputSchema({ named: { description: "Named", questions } })
  ).toHaveProperty("oneOf.1.properties.classifier.enum", ["named"]);
});
test("input schema describes constraints and semantics for agent discovery", () => {
  const schema = buildToolInputSchema({});
  if (!("properties" in schema)) {
    throw new Error("Expected ad hoc schema");
  }
  const { state, questions: questionMap } = schema.properties;
  expect(state.description).toContain("nonblank string");
  expect(state.description).toContain("No conversation history");
  expect(state.description).toContain("Plain paths and URLs are inert");
  expect(questionMap.description).toContain("1–64 independent judgments");
  expect(questionMap.description).toContain("^[A-Za-z][A-Za-z0-9_-]{0,63}$");
  const [noul, choice, score] = questionMap.additionalProperties.oneOf;
  expect(noul.properties.criteria.description).toContain("not a boolean");
  expect(choice.properties.criteria.description).toContain("2–255");
  expect(choice.properties.criteria.description).toContain(
    "no automatic abstention"
  );
  expect(score.properties.criteria.description).toContain("2–10");
  expect(score.properties.criteria.description).toContain(
    "[0, criteria.length - 1]"
  );
  for (const question of [noul, choice, score]) {
    expect(question.properties.instructions.description).toContain(
      "independent of other answers"
    );
  }
  expect(
    buildToolInputSchema({ named: { description: "Named", questions } })
  ).toHaveProperty(
    "oneOf.1.properties.classifier.description",
    "Configured classifier name. Uses its stored questions unchanged; do not also supply questions."
  );
});
test("named schemas distinguish caller state from preset state", () => {
  const caller = { description: "Caller input", questions };
  const preset = {
    ...caller,
    state: { files: ["a.ts"], type: "evidence" as const },
  };
  const mixed = buildToolInputSchema({ caller, preset });
  expect(mixed).toHaveProperty("oneOf.1.properties.classifier.enum", [
    "caller",
  ]);
  expect(mixed).toHaveProperty("oneOf.1.required", ["state", "classifier"]);
  expect(mixed).toHaveProperty("oneOf.2.properties.classifier.enum", [
    "preset",
  ]);
  expect(mixed).toHaveProperty("oneOf.2.required", ["classifier"]);
  expect(mixed).toHaveProperty("oneOf.2.additionalProperties", false);
  expect(mixed).not.toHaveProperty("oneOf.2.properties.state");
  const onlyPreset = buildToolInputSchema({ preset });
  expect(onlyPreset).toHaveProperty("oneOf.1.properties.classifier.enum", [
    "preset",
  ]);
  expect(onlyPreset).not.toHaveProperty("oneOf.2");
});
test("choice criteria list schema requires labels and descriptions", () => {
  expect(buildToolInputSchema({})).toHaveProperty(
    "properties.questions.additionalProperties.oneOf.1.properties.criteria.anyOf.1.items.required",
    ["label", "description"]
  );
});
