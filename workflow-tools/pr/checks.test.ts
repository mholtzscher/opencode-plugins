import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { readCheckSnapshot } from "./checks.js";
import { GithubError } from "./errors.js";
import { Github } from "./github.js";
import type { ExecuteOptions } from "./github.js";
import type { PullRequestCheck } from "./schemas.js";

const CWD = "/session/worktree";
const identity = {
  headRefOid: "sha-one",
  number: 17,
  url: "https://github.com/owner/repo/pull/17",
};
const check = (name: string, bucket = "pass"): PullRequestCheck => ({
  bucket,
  completedAt: "",
  description: "",
  event: "pull_request",
  link: `https://checks/${name}`,
  name,
  startedAt: "",
  state: bucket,
  workflow: "CI",
});
const reply = (checks: readonly PullRequestCheck[]) =>
  Effect.succeed({ stderr: "", stdout: JSON.stringify(checks) });
interface Fixture {
  readonly all?: ReturnType<Github["Service"]["execute"]>;
  readonly required?: ReturnType<Github["Service"]["execute"]>;
  readonly final?: typeof identity;
  readonly repository?: string;
  readonly identityText?: string;
}
const harness = (fixture: Fixture = {}) => {
  const calls: { args: readonly string[]; options: ExecuteOptions }[] = [];
  let views = 0;
  const service = Github.of({
    execute: (args, options) =>
      Effect.suspend(() => {
        calls.push({ args, options });
        if (args[0] === "repo") {
          return Effect.succeed({
            stderr: "",
            stdout: JSON.stringify({
              nameWithOwner: fixture.repository ?? "owner/repo",
            }),
          });
        }
        if (args[1] === "view") {
          views += 1;
          return Effect.succeed({
            stderr: "",
            stdout:
              fixture.identityText ??
              JSON.stringify(
                views === 1 ? identity : (fixture.final ?? identity)
              ),
          });
        }
        return args.includes("--required")
          ? (fixture.required ?? reply([check("required")]))
          : (fixture.all ?? reply([check("required"), check("advisory")]));
      }),
  });
  return {
    calls,
    effect: readCheckSnapshot(CWD).pipe(Effect.provideService(Github, service)),
  };
};

describe("concrete-target immediate check snapshots", () => {
  test("an all-check subprocess failure is not downgraded to an empty report", async () => {
    const fake = harness({
      all: Effect.fail(
        new GithubError({ message: "access denied", operation: "checks" })
      ),
    });
    const error = await Effect.runPromise(fake.effect.pipe(Effect.flip));
    expect(error._tag).toBe("GithubError");
    expect(error.message).toBe("access denied");
    expect(fake.calls.some((call) => call.args.includes("--required"))).toBe(
      false
    );
  });
  test("unique-key join uses all actual wire fields and concrete targets with accepted exits", async () => {
    const fake = harness();
    const snapshot = await Effect.runPromise(fake.effect);
    expect(snapshot.repository).toBe("owner/repo");
    expect(snapshot.number).toBe(17);
    expect(snapshot.headSha).toBe("sha-one");
    expect(snapshot.checks.map(({ requirement }) => requirement)).toEqual([
      "required",
      "advisory",
    ]);
    expect(snapshot.requiredKnowledge).toBe("reported");
    const reads = fake.calls.filter((call) => call.args[1] === "checks");
    expect(reads).toHaveLength(2);
    expect(reads[0].args.slice(0, 6)).toEqual([
      "pr",
      "checks",
      "17",
      "--repo",
      "owner/repo",
      "--json",
    ]);
    expect(reads[1].args).toEqual([...reads[0].args, "--required"]);
    expect(
      reads.every(
        (call) => JSON.stringify(call.options.acceptedCodes) === "[0,1,8]"
      )
    ).toBe(true);
    expect(reads[0].args.join(" ")).not.toContain("isRequired");
    expect(fake.calls.at(-1)?.args).toEqual([
      "pr",
      "view",
      "17",
      "--repo",
      "owner/repo",
      "--json",
      "number,url,headRefOid",
    ]);
    expect(
      fake.calls.every(
        (call) => call.options.cwd === CWD && !call.args.includes("--watch")
      )
    ).toBe(true);
  });
  test("failed nonempty JSON, pending, cancelled and skipped are retained without waiting", async () => {
    const values = [
      check("failure", "fail"),
      check("pending", "pending"),
      check("cancelled", "cancel"),
      check("skipped", "skipping"),
    ];
    const fake = harness({ all: reply(values), required: reply([values[0]]) });
    const snapshot = await Effect.runPromise(fake.effect);
    expect(snapshot.checks.map(({ check: value }) => value.bucket)).toEqual([
      "fail",
      "pending",
      "cancel",
      "skipping",
    ]);
    expect(snapshot.limitations.join(" ")).toContain(
      "Skipped checks are not passes"
    );
    expect(snapshot.limitations.join(" ")).toContain(
      "unreported required jobs may be missing"
    );
    expect(fake.calls).toHaveLength(5);
  });
  test.each(["no checks reported on branch", "NO CHECKS REPORTED"])(
    "specific empty all result: %s",
    async (stderr) => {
      const snapshot = await Effect.runPromise(
        harness({ all: Effect.succeed({ stderr, stdout: "  " }) }).effect
      );
      expect(snapshot.checks).toEqual([]);
      expect(snapshot.limitations.join(" ")).toContain(
        "No checks reported; this is not successful checks"
      );
    }
  );
  test.each([
    "no required checks reported on branch",
    "NO REQUIRED CHECKS REPORTED",
  ])("specific empty required result: %s", async (stderr) => {
    const snapshot = await Effect.runPromise(
      harness({ required: Effect.succeed({ stderr, stdout: "" }) }).effect
    );
    expect(snapshot.requiredKnowledge).toBe("none-reported");
    expect(
      snapshot.checks.every(({ requirement }) => requirement === "unknown")
    ).toBe(true);
    expect(snapshot.limitations.join(" ")).toContain(
      "does not prove an empty requirement set"
    );
  });
  test("successful empty JSON arrays mean no subset reported, not a passing gate", async () => {
    const snapshot = await Effect.runPromise(
      harness({ all: reply([]), required: reply([]) }).effect
    );
    expect(snapshot.requiredKnowledge).toBe("none-reported");
    expect(snapshot.checks).toEqual([]);
    expect(snapshot.limitations.join(" ")).toContain("not successful checks");
  });
  test.each([
    "",
    "not authenticated",
    "no required checks reported",
    "error: no checks reported is unavailable",
  ])("unrelated empty all stdout stays typed failure: %s", async (stderr) => {
    const fake = harness({ all: Effect.succeed({ stderr, stdout: "" }) });
    const error = await Effect.runPromise(fake.effect.pipe(Effect.flip));
    expect(error._tag).toBe("GithubError");
    expect(error.message).toBe(stderr || "gh pr checks returned no check data");
  });
  test.each(["not JSON", "{}", '[{"name":"missing fields"}]'])(
    "nonempty malformed all data is a decoding failure: %s",
    async (stdout) => {
      const error = await Effect.runPromise(
        harness({
          all: Effect.succeed({ stderr: "no checks reported", stdout }),
        }).effect.pipe(Effect.flip)
      );
      expect(error._tag).toBe("GithubDecodeError");
    }
  );
  test.each(["unsupported Enterprise query", "not authenticated", ""])(
    "required errors preserve all checks as unknown: %s",
    async (message) => {
      const required = message
        ? Effect.fail(new GithubError({ message, operation: "required" }))
        : Effect.succeed({ stderr: "", stdout: "" });
      const snapshot = await Effect.runPromise(harness({ required }).effect);
      expect(snapshot.requiredKnowledge).toBe("unavailable");
      expect(snapshot.checks).toHaveLength(2);
      expect(
        snapshot.checks.every(({ requirement }) => requirement === "unknown")
      ).toBe(true);
      expect(snapshot.limitations.join(" ")).toContain(
        message || "no check data"
      );
    }
  );
  test("required decoding failure is an explicit unavailable limitation", async () => {
    const snapshot = await Effect.runPromise(
      harness({ required: Effect.succeed({ stderr: "", stdout: "not JSON" }) })
        .effect
    );
    expect(snapshot.requiredKnowledge).toBe("unavailable");
    expect(snapshot.limitations.join(" ")).toContain("invalid JSON");
  });
  test("join keys include workflow, event, and link, not only name", async () => {
    const first = check("same");
    const values = [
      first,
      { ...first, workflow: "other" },
      { ...first, event: "push" },
      { ...first, link: "other" },
    ];
    const snapshot = await Effect.runPromise(
      harness({ all: reply(values), required: reply([first]) }).effect
    );
    expect(snapshot.checks.map(({ requirement }) => requirement)).toEqual([
      "required",
      "advisory",
      "advisory",
      "advisory",
    ]);
  });
  test.each(["all", "required"])(
    "duplicate %s keys are unknown, not invented required/advisory",
    async (side) => {
      const duplicate = check("duplicate");
      const snapshot = await Effect.runPromise(
        harness({
          all: reply(
            side === "all"
              ? [duplicate, duplicate, check("other")]
              : [duplicate, check("other")]
          ),
          required: reply(
            side === "required" ? [duplicate, duplicate] : [duplicate]
          ),
        }).effect
      );
      expect(
        snapshot.checks
          .filter(({ check: value }) => value.name === "duplicate")
          .every(({ requirement }) => requirement === "unknown")
      ).toBe(true);
      expect(snapshot.checks.at(-1)?.requirement).toBe("advisory");
      expect(snapshot.limitations.join(" ")).toContain("Ambiguous duplicate");
    }
  );
  test("changed head forces unknown classification and rerun guidance", async () => {
    const snapshot = await Effect.runPromise(
      harness({ final: { ...identity, headRefOid: "sha-two" } }).effect
    );
    expect(snapshot.headSha).toBe("sha-one");
    expect(snapshot.observedHeadSha).toBe("sha-two");
    expect(
      snapshot.checks.every(({ requirement }) => requirement === "unknown")
    ).toBe(true);
    expect(snapshot.limitations.join(" ")).toContain("Unstable snapshot");
    expect(snapshot.limitations.join(" ")).toContain("Rerun /pr-checks");
  });
  test.each([
    '{"number":0,"url":"url","headRefOid":"sha"}',
    '{"number":17,"url":"","headRefOid":"sha"}',
    '{"number":17,"url":"url","headRefOid":""}',
  ])("identity is schema-validated: %s", async (identityText) => {
    const fake = harness({ identityText });
    const error = await Effect.runPromise(fake.effect.pipe(Effect.flip));
    expect(error._tag).toBe("GithubDecodeError");
    expect(fake.calls.some((call) => call.args[1] === "checks")).toBe(false);
  });
  test.each(["owner/repo/other", "", "owner", "owner/ repo"])(
    "invalid repository fails before checks: %s",
    async (repository) => {
      const fake = harness({ repository });
      const error = await Effect.runPromise(fake.effect.pipe(Effect.flip));
      expect(error._tag).toBe("GithubError");
      expect(fake.calls).toHaveLength(1);
    }
  );
});
