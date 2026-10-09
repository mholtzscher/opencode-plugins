import { Context, Effect, Layer, Schema } from "effect";

import { collectGitHubActionsUrlContexts } from "./actions.js";
import { readCheckSnapshot } from "./checks.js";
import { GithubError } from "./errors.js";
import type { GithubDecodeError, LogStorageError } from "./errors.js";
import { Github } from "./github.js";
import { LogStorage } from "./log-storage.js";
import {
  buildPrDescribePrompt,
  buildPullRequestPrompt,
  parsePullRequestCommandArguments,
} from "./pr.js";
import type { PullRequestMode } from "./pr.js";
import {
  buildCheckInvestigationPrompt,
  buildPrCommentsFixPrompt,
  buildPrCommentsPrompt,
  REVIEW_THREADS_QUERY,
} from "./prompts.js";
import {
  decodeJson,
  PrCheckIdentity,
  PrMetadata,
  RepoView,
  ReviewThreadsPage,
} from "./schemas.js";

export type WorkflowError = GithubError | GithubDecodeError | LogStorageError;

/** Workflows produce text; the host owns admission and session identity. */
export class Workflows extends Context.Service<
  Workflows,
  {
    readonly pullRequest: (
      args: string,
      cwd: string,
      mode: PullRequestMode
    ) => Effect.Effect<string, WorkflowError>;
    readonly comments: (cwd: string) => Effect.Effect<string, WorkflowError>;
    readonly fixComments: (cwd: string) => Effect.Effect<string, WorkflowError>;
    readonly actions: (cwd: string) => Effect.Effect<string, WorkflowError>;
  }
>()("workflow-tools/Workflows") {}

export const WorkflowsLive = Layer.effect(
  Workflows,
  Effect.gen(function* workflowsLayer() {
    const github = yield* Github;
    const logs = yield* LogStorage;
    const metadata = Effect.fn("Workflows.metadata")(function* metadata(
      cwd: string
    ) {
      const result = yield* github.execute(
        ["pr", "view", "--json", "number,title,url,headRefName,baseRefName"],
        { cwd, timeout: 30_000 }
      );
      return yield* decodeJson(PrMetadata, result.stdout, "pull request");
    });
    const repository = Effect.fn("Workflows.repository")(function* repository(
      cwd: string
    ) {
      const [repoResult, pr] = yield* Effect.all(
        [
          github.execute(["repo", "view", "--json", "nameWithOwner"], {
            cwd,
            timeout: 30_000,
          }),
          metadata(cwd),
        ],
        { concurrency: 2 }
      );
      const repo = yield* decodeJson(RepoView, repoResult.stdout, "repository");
      const [owner, name, extra] = repo.nameWithOwner.split("/");
      if (!owner || !name || extra !== undefined) {
        return yield* Effect.fail(
          new GithubError({
            message: "gh returned invalid repository name",
            operation: "repository",
          })
        );
      }
      return { name, owner, pr };
    });
    const pullRequest = Effect.fn("Workflows.pullRequest")(
      function* pullRequest(args: string, cwd: string, mode: PullRequestMode) {
        const parsed = yield* parsePullRequestCommandArguments(args, mode);
        if (mode === "publish") {
          return buildPullRequestPrompt(parsed);
        }
        const pr = yield* metadata(cwd);
        return buildPrDescribePrompt(pr, parsed.request);
      }
    );
    const comments = Effect.fn("Workflows.comments")(function* comments(
      cwd: string
    ) {
      const { owner, name, pr } = yield* repository(cwd);
      const result = yield* github.execute(
        [
          "api",
          "graphql",
          "--paginate",
          "--slurp",
          "-F",
          `owner=${owner}`,
          "-F",
          `name=${name}`,
          "-F",
          `number=${pr.number}`,
          "-f",
          `query=${REVIEW_THREADS_QUERY}`,
        ],
        { cwd }
      );
      const pages = yield* decodeJson(
        Schema.Array(ReviewThreadsPage),
        result.stdout,
        "review threads"
      );
      const threads = pages
        .flatMap((page) => page.data.repository.pullRequest.reviewThreads.nodes)
        .filter((thread) => !thread.isResolved);
      return threads.length === 0
        ? "No unresolved inline review threads found"
        : buildPrCommentsPrompt(pr, threads);
    });
    const fixComments = Effect.fn("Workflows.fixComments")(
      function* fixComments(cwd: string) {
        const { owner, name, pr } = yield* repository(cwd);
        return buildPrCommentsFixPrompt(owner, name, pr);
      }
    );
    const actions = Effect.fn("Workflows.actions")(function* actions(
      cwd: string
    ) {
      let snapshot = yield* readCheckSnapshot(cwd).pipe(
        Effect.provideService(Github, github)
      );
      const failed = snapshot.checks.filter(
        ({ check }) => check.bucket === "fail" || check.bucket === "cancel"
      );
      const context =
        failed.length === 0
          ? undefined
          : yield* collectGitHubActionsUrlContexts(
              github,
              logs,
              failed.map(({ check }) => check.link).join("\n"),
              cwd
            );
      // Evidence collection may take time: verify the same target again before reporting.
      if (failed.length > 0) {
        const final = yield* github.execute(
          [
            "pr",
            "view",
            String(snapshot.number),
            "--repo",
            snapshot.repository,
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
        if (
          observed.headRefOid !== snapshot.headSha ||
          observed.number !== snapshot.number ||
          observed.url !== snapshot.url
        ) {
          snapshot = {
            ...snapshot,
            checks: snapshot.checks.map(({ check }) => ({
              check,
              requirement: "unknown",
            })),
            limitations: [
              ...snapshot.limitations,
              "Unstable snapshot: PR head or identity changed during evidence collection; rerun /pr-checks.",
            ],
            observedHeadSha: observed.headRefOid,
          };
        }
      }
      return buildCheckInvestigationPrompt(snapshot, context);
    });
    return Workflows.of({ actions, comments, fixComments, pullRequest });
  })
);
