import { Effect, Schema } from "effect";

import { stripAnsi, summarizeFailedLog } from "./actions-log.js";
import type {
  GithubDecodeError,
  GithubError,
  LogStorageError,
} from "./errors.js";
import { truncate } from "./evidence-format.js";
import type { Github } from "./github.js";
import type { LogStorage } from "./log-storage.js";
import { decodeJson } from "./schemas.js";

const GITHUB_ACTIONS_URL =
  /https?:\/\/github\.com\/(?<owner>[^\s/]+)\/(?<repo>[^\s/]+)\/actions\/runs\/(?<runId>\d+)(?:\/attempts\/(?<attempt>\d+))?(?:\/job\/(?<jobId>\d+))?(?:[^\s<>)\]]*)?/giu;
const CHECK_RUN_URL_PATTERN = /\/check-runs\/(?<checkRunId>\d+)$/u;
const SAFE_FILENAME_PATTERN = /[^a-z0-9_.-]/giu;
const FAILED_STEP_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
]);

interface ActionsUrl {
  readonly attempt?: string;
  readonly jobId?: string;
  readonly owner: string;
  readonly repo: string;
  readonly runId: string;
  readonly url: string;
}

const NullableText = Schema.optionalKey(Schema.NullOr(Schema.String));
const Step = Schema.Struct({
  completed_at: NullableText,
  conclusion: NullableText,
  name: NullableText,
  number: Schema.optionalKey(Schema.Number),
  started_at: NullableText,
  status: Schema.String,
});
const Job = Schema.Struct({
  check_run_url: NullableText,
  completed_at: NullableText,
  conclusion: NullableText,
  head_sha: NullableText,
  html_url: NullableText,
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  name: NullableText,
  run_attempt: Schema.optionalKey(Schema.Number),
  runner_group_name: NullableText,
  runner_name: NullableText,
  started_at: NullableText,
  status: Schema.String,
  steps: Schema.Array(Step),
  workflow_name: NullableText,
});
const RunJob = Schema.Struct({
  completedAt: NullableText,
  conclusion: NullableText,
  databaseId: Schema.optionalKey(Schema.Number),
  name: NullableText,
  startedAt: NullableText,
  status: Schema.String,
  url: NullableText,
});
const Run = Schema.Struct({
  attempt: Schema.optionalKey(Schema.Number),
  conclusion: NullableText,
  displayTitle: NullableText,
  event: NullableText,
  headBranch: NullableText,
  headSha: NullableText,
  jobs: Schema.Array(RunJob),
  name: NullableText,
  startedAt: NullableText,
  status: Schema.String,
  updatedAt: NullableText,
  url: NullableText,
  workflowName: NullableText,
});
const Annotation = Schema.Struct({
  annotation_level: NullableText,
  end_line: Schema.optionalKey(Schema.Number),
  message: NullableText,
  path: NullableText,
  raw_details: NullableText,
  start_line: Schema.optionalKey(Schema.Number),
  title: NullableText,
});

const uniqueActionsUrls = (text: string): ActionsUrl[] => {
  const seen = new Set<string>();
  const urls: ActionsUrl[] = [];
  for (const match of text.matchAll(GITHUB_ACTIONS_URL)) {
    if (!match.groups) {
      continue;
    }
    const { owner, repo, runId, attempt, jobId } = match.groups;
    const key = `${owner}/${repo}/${runId}/${attempt ?? ""}/${jobId ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    urls.push({ attempt, jobId, owner, repo, runId, url: match[0] });
    if (urls.length === 3) {
      break;
    }
  }
  return urls;
};

const isFailedOrIncomplete = (step: {
  readonly conclusion?: string | null;
  readonly status: string;
}): boolean =>
  FAILED_STEP_CONCLUSIONS.has((step.conclusion ?? "").toLowerCase()) ||
  step.status.toLowerCase() !== "completed";

const json = <A>(value: A): string => JSON.stringify(value, null, 2);

/** Partial context is useful, but typed lookup failures must remain visible in the report. */
const sectionFallback = (heading: string) =>
  // oxlint-disable-next-line promise/prefer-await-to-callbacks promise/prefer-await-to-then -- Effect.catch handles typed failures, not Promise rejections.
  Effect.catch((error: GithubError | GithubDecodeError | LogStorageError) =>
    Effect.succeed([`## ${heading} lookup failed\n${error.message}`])
  );

interface ActionsTarget {
  readonly url: ActionsUrl;
  readonly repository: string;
  readonly cwd: string;
}

const collectAnnotations = Effect.fn("Actions.annotations")(
  function* collectAnnotations(
    github: Github["Service"],
    target: ActionsTarget,
    checkRunUrl: string | null | undefined
  ) {
    const id = checkRunUrl
      ? CHECK_RUN_URL_PATTERN.exec(checkRunUrl)?.groups?.checkRunId
      : undefined;
    if (!id) {
      return [];
    }
    const result = yield* github.execute(
      [
        "api",
        `repos/${target.repository}/check-runs/${id}/annotations`,
        "--paginate",
        "--slurp",
      ],
      { cwd: target.cwd }
    );
    const pages = yield* decodeJson(
      Schema.Array(Schema.Array(Annotation)),
      result.stdout,
      "check annotations"
    );
    const rows = pages.flat();
    return rows.length > 0 ? [`## Check annotations\n${json(rows)}`] : [];
  }
);

const collectJobEvidence = Effect.fn("Actions.jobEvidence")(
  function* collectJobEvidence(
    github: Github["Service"],
    target: ActionsTarget
  ) {
    if (!target.url.jobId) {
      return [];
    }
    const result = yield* github.execute(
      ["api", `repos/${target.repository}/actions/jobs/${target.url.jobId}`],
      { cwd: target.cwd }
    );
    const { steps, ...summary } = yield* decodeJson(
      Job,
      result.stdout,
      "action job"
    );
    const annotations = yield* collectAnnotations(
      github,
      target,
      summary.check_run_url
    ).pipe(sectionFallback("Check annotations"));
    const failed = steps.filter(isFailedOrIncomplete);
    return [
      `## Job summary\n${json(summary)}`,
      `## Failed or incomplete steps\n${failed.length > 0 ? json(failed) : "None reported by the jobs API."}`,
      ...annotations,
    ];
  }
);

const collectRunEvidence = Effect.fn("Actions.runEvidence")(
  function* collectRunEvidence(
    github: Github["Service"],
    target: ActionsTarget
  ) {
    const { url, repository, cwd } = target;
    const args = [
      "run",
      "view",
      url.runId,
      "--repo",
      repository,
      "--json",
      "attempt,conclusion,createdAt,databaseId,displayTitle,event,headBranch,headSha,jobs,name,number,startedAt,status,updatedAt,url,workflowDatabaseId,workflowName",
    ];
    if (url.attempt) {
      args.push("--attempt", url.attempt);
    }
    const result = yield* github.execute(args, { cwd });
    const { jobs, ...summary } = yield* decodeJson(
      Run,
      result.stdout,
      "workflow run"
    );
    const failed = jobs.filter(isFailedOrIncomplete);
    return [
      `## Workflow run summary\n${json(summary)}`,
      ...(url.jobId
        ? []
        : [
            `## Failed or incomplete jobs\n${failed.length > 0 ? json(failed) : "None reported by gh run view."}`,
          ]),
    ];
  }
);

const collectFailedLogEvidence = Effect.fn("Actions.failedLogEvidence")(
  function* collectFailedLogEvidence(
    github: Github["Service"],
    logs: LogStorage["Service"],
    target: ActionsTarget
  ) {
    const { url, repository, cwd } = target;
    const args = [
      "run",
      "view",
      url.runId,
      "--repo",
      repository,
      "--log-failed",
    ];
    if (url.attempt) {
      args.push("--attempt", url.attempt);
    }
    if (url.jobId) {
      args.push("--job", url.jobId);
    }
    const result = yield* github.execute(args, { cwd });
    const safeRepo = `${url.owner}-${url.repo}`.replaceAll(
      SAFE_FILENAME_PATTERN,
      "-"
    );
    const file = yield* logs.save(
      `${safeRepo}-${url.runId}${url.jobId ? `-${url.jobId}` : ""}.log`,
      stripAnsi(result.stdout)
    );
    return [
      `## Failed step logs\nFull failed-step log saved at: ${file}\n\n${summarizeFailedLog(result.stdout)}`,
    ];
  }
);

const collectTargetContext = Effect.fn("Actions.targetContext")(
  function* collectTargetContext(
    github: Github["Service"],
    logs: LogStorage["Service"],
    target: ActionsTarget
  ) {
    // Each typed lookup failure remains visible; defects and interruption propagate.
    const sections = yield* Effect.all(
      [
        collectJobEvidence(github, target).pipe(sectionFallback("Job API")),
        collectRunEvidence(github, target).pipe(sectionFallback("Run summary")),
        collectFailedLogEvidence(github, logs, target).pipe(
          sectionFallback("Failed-step log")
        ),
      ],
      { concurrency: 3 }
    );
    const { url, repository } = target;
    return truncate(
      [
        `## GitHub Actions URL\n${url.url}`,
        `Repository: ${repository}\nRun ID: ${url.runId}${url.attempt ? `\nAttempt: ${url.attempt}` : ""}${url.jobId ? `\nJob ID: ${url.jobId}` : ""}`,
        ...sections.flat(),
      ].join("\n\n"),
      30_000
    );
  }
);

export const collectGitHubActionsUrlContexts = Effect.fn(
  "Actions.collectContexts"
)(function* collectContexts(
  github: Github["Service"],
  logs: LogStorage["Service"],
  text: string,
  cwd: string
) {
  const urls = uniqueActionsUrls(text);
  if (urls.length === 0) {
    return;
  }

  const contexts = yield* Effect.forEach(
    urls,
    (url) =>
      collectTargetContext(github, logs, {
        cwd,
        repository: `${url.owner}/${url.repo}`,
        url,
      }),
    { concurrency: 3 }
  );
  return contexts.join("\n\n---\n\n");
});
