import { Effect, Schema } from "effect";

import { classifyCheckSnapshot } from "./check-classification.js";
import type {
  CheckRead,
  CheckScope,
  CheckSnapshot,
} from "./check-classification.js";
import { GithubError } from "./errors.js";
import type { GithubDecodeError } from "./errors.js";
import { Github } from "./github.js";
import {
  decodeJson,
  PrCheckIdentity,
  PullRequestCheck,
  RepoView,
} from "./schemas.js";

const NO_CHECKS_PATTERN = /^no checks reported(?:\s|$)/iu;
const NO_REQUIRED_PATTERN = /^no required checks reported(?:\s|$)/iu;
const REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/u;

const readChecks = Effect.fn("Checks.read")(function* readChecks(
  github: Github["Service"],
  repository: string,
  number: number,
  scope: CheckScope,
  cwd: string
): Effect.fn.Return<CheckRead, GithubError | GithubDecodeError> {
  const args = [
    "pr",
    "checks",
    String(number),
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
    const pattern = scope === "all" ? NO_CHECKS_PATTERN : NO_REQUIRED_PATTERN;
    if (pattern.test(result.stderr.trim())) {
      return { kind: "none-reported", scope };
    }
    return yield* Effect.fail(
      new GithubError({
        message: result.stderr.trim() || "gh pr checks returned no check data",
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
    ? { kind: "none-reported", scope }
    : { checks, kind: "checks", scope };
});

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
      ["pr", "view", "--json", "number,url,headRefOid"],
      { cwd, timeout: 30_000 }
    );
    const identity = yield* decodeJson(
      PrCheckIdentity,
      initial.stdout,
      "pull request check identity"
    );

    // Keep these immediate reads ordered; they are not an atomic GitHub snapshot.
    const all = yield* readChecks(
      github,
      repository,
      identity.number,
      "all",
      cwd
    );
    const required = yield* readChecks(
      github,
      repository,
      identity.number,
      "required",
      cwd
    ).pipe(Effect.result);
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
    return classifyCheckSnapshot({
      all,
      identity,
      observed,
      repository,
      required:
        required._tag === "Success"
          ? required.success
          : { kind: "unavailable", message: required.failure.message },
    });
  }
);
