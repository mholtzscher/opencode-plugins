import { Context, Effect, Layer } from "effect";

import { collectGitHubActionsUrlContexts } from "./actions.js";
import { parsePullRequestCommandArguments } from "./arguments.js";
import { buildCheckInvestigationPrompt } from "./check-prompts.js";
import { readCheckSnapshot } from "./checks.js";
import { GithubError } from "./errors.js";
import type { GithubDecodeError, LogStorageError } from "./errors.js";
import {
  buildFeedbackFixPrompt,
  buildFeedbackReviewPrompt,
} from "./feedback-prompts.js";
import { Github } from "./github.js";
import { LogStorage } from "./log-storage.js";
import { buildMetadataRewritePrompt } from "./metadata-prompts.js";
import { buildPublicationPrompt } from "./publication-prompts.js";
import { readUnresolvedReviewThreads } from "./review-threads.js";
import {
  decodeJson,
  PrCheckIdentity,
  PrMetadata,
  RepoView,
} from "./schemas.js";

export type WorkflowError = GithubError | GithubDecodeError | LogStorageError;

/** Workflows produce text; the host owns admission and session identity. */
export class Workflows extends Context.Service<
  Workflows,
  {
    readonly preparePublication: (
      args: string,
      cwd: string
    ) => Effect.Effect<string, WorkflowError>;
    readonly prepareMetadataRewrite: (
      args: string,
      cwd: string
    ) => Effect.Effect<string, WorkflowError>;
    readonly prepareFeedbackReview: (
      cwd: string
    ) => Effect.Effect<string, WorkflowError>;
    readonly prepareFeedbackFix: (
      cwd: string
    ) => Effect.Effect<string, WorkflowError>;
    readonly prepareCheckInvestigation: (
      cwd: string
    ) => Effect.Effect<string, WorkflowError>;
  }
>()("workflow-tools/Workflows") {}

export const WorkflowsLive = Layer.effect(
  Workflows,
  Effect.gen(function* workflowsLayer() {
    const github = yield* Github;
    const logs = yield* LogStorage;
    const readMetadata = Effect.fn("Workflows.readMetadata")(
      function* readMetadata(cwd: string) {
        const result = yield* github.execute(
          ["pr", "view", "--json", "number,title,url,headRefName,baseRefName"],
          { cwd, timeout: 30_000 }
        );
        return yield* decodeJson(PrMetadata, result.stdout, "pull request");
      }
    );
    const readRepository = Effect.fn("Workflows.readRepository")(
      function* readRepository(cwd: string) {
        const [repoResult, pr] = yield* Effect.all(
          [
            github.execute(["repo", "view", "--json", "nameWithOwner"], {
              cwd,
              timeout: 30_000,
            }),
            readMetadata(cwd),
          ],
          { concurrency: 2 }
        );
        const repo = yield* decodeJson(
          RepoView,
          repoResult.stdout,
          "repository"
        );
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
      }
    );
    const preparePublication = Effect.fn("Workflows.preparePublication")(
      function* preparePublication(args: string, _cwd: string) {
        const parsed = yield* parsePullRequestCommandArguments(args, "publish");
        return buildPublicationPrompt(parsed);
      }
    );
    const prepareMetadataRewrite = Effect.fn(
      "Workflows.prepareMetadataRewrite"
    )(function* prepareMetadataRewrite(args: string, cwd: string) {
      const parsed = yield* parsePullRequestCommandArguments(args, "rewrite");
      const pr = yield* readMetadata(cwd);
      return buildMetadataRewritePrompt(pr, parsed.request);
    });
    const prepareFeedbackReview = Effect.fn("Workflows.prepareFeedbackReview")(
      function* prepareFeedbackReview(cwd: string) {
        const { owner, name, pr } = yield* readRepository(cwd);
        const threads = yield* readUnresolvedReviewThreads(
          github,
          owner,
          name,
          pr.number,
          cwd
        );
        return threads.length === 0
          ? "No unresolved inline review threads found"
          : buildFeedbackReviewPrompt(pr, threads);
      }
    );
    const prepareFeedbackFix = Effect.fn("Workflows.prepareFeedbackFix")(
      function* prepareFeedbackFix(cwd: string) {
        const { owner, name, pr } = yield* readRepository(cwd);
        return buildFeedbackFixPrompt(owner, name, pr);
      }
    );
    const prepareCheckInvestigation = Effect.fn(
      "Workflows.prepareCheckInvestigation"
    )(function* prepareCheckInvestigation(cwd: string) {
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
    return Workflows.of({
      prepareCheckInvestigation,
      prepareFeedbackFix,
      prepareFeedbackReview,
      prepareMetadataRewrite,
      preparePublication,
    });
  })
);
