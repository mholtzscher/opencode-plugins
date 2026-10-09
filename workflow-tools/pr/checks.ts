import { Effect, Schema } from "effect";

import { GithubError } from "./errors.js";
import type { GithubDecodeError } from "./errors.js";
import { Github } from "./github.js";
import {
  decodeJson,
  PrCheckIdentity,
  PullRequestCheck,
  RepoView,
} from "./schemas.js";

export type CheckScope = "all" | "required";
export type CheckRead =
  | {
      readonly kind: "checks";
      readonly scope: CheckScope;
      readonly checks: readonly PullRequestCheck[];
    }
  | { readonly kind: "none-reported"; readonly scope: CheckScope };

export interface ClassifiedCheck {
  readonly check: PullRequestCheck;
  readonly requirement: "required" | "advisory" | "unknown";
}

export interface CheckSnapshot {
  readonly repository: string;
  readonly number: number;
  readonly url: string;
  readonly headSha: string;
  readonly observedHeadSha: string;
  readonly checks: readonly ClassifiedCheck[];
  readonly requiredKnowledge: "reported" | "none-reported" | "unavailable";
  readonly limitations: readonly string[];
}

const NO_CHECKS_PATTERN = /^no checks reported(?:\s|$)/iu;
const NO_REQUIRED_PATTERN = /^no required checks reported(?:\s|$)/iu;
const REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/u;
const key = (check: PullRequestCheck): string =>
  JSON.stringify([check.name, check.workflow, check.event, check.link]);

const counts = (values: readonly PullRequestCheck[]) => {
  const result = new Map<string, number>();
  for (const value of values) {
    const id = key(value);
    result.set(id, (result.get(id) ?? 0) + 1);
  }
  return result;
};

export const readCheckSnapshot = Effect.fn("Checks.readSnapshot")(
  function* readSnapshot(
    cwd: string
  ): Effect.fn.Return<CheckSnapshot, GithubError | GithubDecodeError, Github> {
    const github = yield* Github;
    const repoResult = yield* github.execute(
      ["repo", "view", "--json", "nameWithOwner"],
      { cwd, timeout: 30_000 }
    );
    const repo = yield* decodeJson(RepoView, repoResult.stdout, "repository");
    if (!REPOSITORY_PATTERN.test(repo.nameWithOwner)) {
      return yield* Effect.fail(
        new GithubError({
          message: "gh returned invalid repository name",
          operation: "repository",
        })
      );
    }
    const repository = repo.nameWithOwner;
    const initial = yield* github.execute(
      ["pr", "view", "--repo", repository, "--json", "number,url,headRefOid"],
      { cwd, timeout: 30_000 }
    );
    const identity = yield* decodeJson(
      PrCheckIdentity,
      initial.stdout,
      "pull request check identity"
    );
    const read = Effect.fn("Checks.read")(function* read(scope: CheckScope) {
      const args = [
        "pr",
        "checks",
        String(identity.number),
        "--repo",
        repository,
        "--json",
        Object.keys(PullRequestCheck.fields).join(","),
      ];
      if (scope === "required") {
        args.push("--required");
      }
      const result = yield* github.execute(args, {
        acceptedCodes: [0, 1, 8],
        cwd,
        timeout: 30_000,
      });
      if (!result.stdout.trim()) {
        const pattern =
          scope === "all" ? NO_CHECKS_PATTERN : NO_REQUIRED_PATTERN;
        if (pattern.test(result.stderr.trim())) {
          return { kind: "none-reported", scope } satisfies CheckRead;
        }
        return yield* Effect.fail(
          new GithubError({
            message:
              result.stderr.trim() || "gh pr checks returned no check data",
            operation: `gh pr checks (${scope})`,
          })
        );
      }
      const checks = yield* decodeJson(
        Schema.Array(PullRequestCheck),
        result.stdout,
        `pull request ${scope} checks`
      );
      return checks.length === 0
        ? ({ kind: "none-reported", scope } satisfies CheckRead)
        : ({ checks, kind: "checks", scope } satisfies CheckRead);
    });
    const all = yield* read("all");
    const required = yield* read("required").pipe(Effect.result);
    const limitations = [
      "Only reported head-rollup checks are visible; unreported required jobs may be missing. Skipped checks are not passes. This is not branch-protection, ruleset, mergeability, or verified merge-gate evidence.",
    ];
    const requiredRead =
      required._tag === "Success" ? required.success : undefined;
    let requiredKnowledge: CheckSnapshot["requiredKnowledge"] = "unavailable";
    if (requiredRead) {
      requiredKnowledge =
        requiredRead.kind === "checks" ? "reported" : "none-reported";
    }
    if (required._tag === "Failure") {
      limitations.push(
        `Required-check classification unavailable: ${required.failure.message}`
      );
    } else if (requiredRead?.kind === "none-reported") {
      limitations.push(
        "No required subset reported: this does not prove an empty requirement set or a passing gate."
      );
    }
    if (all.kind === "none-reported") {
      limitations.push("No checks reported; this is not successful checks.");
    }
    const final = yield* github.execute(
      [
        "pr",
        "view",
        String(identity.number),
        "--repo",
        repository,
        "--json",
        "number,url,headRefOid",
      ],
      { cwd, timeout: 30_000 }
    );
    const observed = yield* decodeJson(
      PrCheckIdentity,
      final.stdout,
      "pull request check identity"
    );
    const stable =
      identity.headRefOid === observed.headRefOid &&
      identity.number === observed.number &&
      identity.url === observed.url;
    if (!stable) {
      limitations.push(
        "Unstable snapshot: PR head or identity changed during collection; classification is unknown. Rerun /pr-checks rather than waiting for convergence."
      );
    }
    const checks = all.kind === "checks" ? all.checks : [];
    const requiredChecks =
      requiredRead?.kind === "checks" ? requiredRead.checks : [];
    const allCounts = counts(checks);
    const requiredCounts = counts(requiredChecks);
    const classified = checks.map((check): ClassifiedCheck => {
      const id = key(check);
      if (
        !stable ||
        !requiredRead ||
        requiredRead.kind === "none-reported" ||
        allCounts.get(id) !== 1 ||
        (requiredCounts.get(id) ?? 0) > 1
      ) {
        return { check, requirement: "unknown" };
      }
      return {
        check,
        requirement: requiredCounts.has(id) ? "required" : "advisory",
      };
    });
    if (
      classified.some(
        (item) =>
          allCounts.get(key(item.check)) !== 1 ||
          (requiredCounts.get(key(item.check)) ?? 0) > 1
      )
    ) {
      limitations.push(
        "Ambiguous duplicate check keys are classified as unknown."
      );
    }
    return {
      checks: classified,
      headSha: identity.headRefOid,
      limitations,
      number: identity.number,
      observedHeadSha: observed.headRefOid,
      repository,
      requiredKnowledge,
      url: identity.url,
    };
  }
);
