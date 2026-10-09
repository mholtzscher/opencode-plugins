import { describe, expect, test } from "bun:test";

import { classifyCheckSnapshot } from "./check-classification.js";
import type { CheckEvidence } from "./check-classification.js";
import type { PullRequestCheck } from "./schemas.js";

const identity = {
  headRefOid: "sha-one",
  number: 17,
  url: "https://github.com/owner/repo/pull/17",
};
const check = (name: string): PullRequestCheck => ({
  bucket: "pass",
  completedAt: "",
  description: "",
  event: "pull_request",
  link: `https://checks/${name}`,
  name,
  startedAt: "",
  state: "SUCCESS",
  workflow: "CI",
});
const requiredCheck = check("required");
const advisoryCheck = check("advisory");
const evidence: CheckEvidence = {
  all: { checks: [requiredCheck, advisoryCheck], kind: "checks", scope: "all" },
  identity,
  observed: identity,
  repository: "owner/repo",
  required: { checks: [requiredCheck], kind: "checks", scope: "required" },
};

const classifyWithChecks = (checks: readonly PullRequestCheck[]) =>
  classifyCheckSnapshot({
    ...evidence,
    all: { checks, kind: "checks", scope: "all" },
  });

describe("pure check classification", () => {
  test("classification preserves wire evidence and does not mutate its input", () => {
    const before = structuredClone(evidence);
    const snapshot = classifyCheckSnapshot(evidence);
    expect(snapshot.checks).toEqual([
      { check: requiredCheck, requirement: "required" },
      { check: advisoryCheck, requirement: "advisory" },
    ]);
    expect(snapshot).toEqual(classifyCheckSnapshot(evidence));
    expect(evidence).toEqual(before);
  });
  test.each(["headRefOid", "number", "url"] as const)(
    "a change in %s invalidates every classification, not just the head SHA",
    (field) => {
      const observed = {
        ...identity,
        [field]: field === "number" ? 18 : "changed",
      };
      const snapshot = classifyCheckSnapshot({ ...evidence, observed });
      expect(snapshot.checks.map(({ requirement }) => requirement)).toEqual([
        "unknown",
        "unknown",
      ]);
      expect(snapshot.limitations.join(" ")).toContain("Unstable snapshot");
      expect(snapshot.headSha).toBe(identity.headRefOid);
      expect(snapshot.url).toBe(identity.url);
      expect(snapshot.number).toBe(identity.number);
    }
  );
  test("duplicate ambiguity is local to the repeated identity and independent of ordering", () => {
    const duplicate = check("duplicate");
    const values = [duplicate, advisoryCheck, requiredCheck, duplicate];
    const snapshot = classifyWithChecks(values);
    expect(snapshot.checks.map(({ requirement }) => requirement)).toEqual([
      "unknown",
      "advisory",
      "required",
      "unknown",
    ]);
    expect(classifyWithChecks(values.toReversed()).checks).toEqual(
      snapshot.checks.toReversed()
    );
    expect(snapshot.limitations.join(" ")).toContain("Ambiguous duplicate");
  });
  test("an unavailable required query retains failure evidence without inventing a gate", () => {
    const snapshot = classifyCheckSnapshot({
      ...evidence,
      required: { kind: "unavailable", message: "access denied" },
    });
    expect(snapshot.requiredKnowledge).toBe("unavailable");
    expect(snapshot.checks.map(({ requirement }) => requirement)).toEqual([
      "unknown",
      "unknown",
    ]);
    expect(snapshot.limitations.join(" ")).toContain("access denied");
  });
  test("same-head disagreement invalidates otherwise unique checks", () => {
    const snapshot = classifyCheckSnapshot({
      ...evidence,
      required: {
        checks: [requiredCheck, check("unseen")],
        kind: "checks",
        scope: "required",
      },
    });
    expect(snapshot.requiredKnowledge).toBe("unavailable");
    expect(snapshot.checks.map(({ requirement }) => requirement)).toEqual([
      "unknown",
      "unknown",
    ]);
    expect(snapshot.limitations.join(" ")).toContain(
      "non-atomic all/required reads disagree"
    );
    expect(snapshot.observedHeadSha).toBe(snapshot.headSha);
  });
});
