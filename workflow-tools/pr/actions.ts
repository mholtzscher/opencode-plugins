import { Effect, Schema } from "effect";

import type {
  GithubDecodeError,
  GithubError,
  LogStorageError,
} from "./errors.js";
import type { Github } from "./github.js";
import type { LogStorage } from "./log-storage.js";
import { truncate } from "./prompts.js";
import { decodeJson } from "./schemas.js";

const GITHUB_ACTIONS_URL =
  /https?:\/\/github\.com\/(?<owner>[^\s/]+)\/(?<repo>[^\s/]+)\/actions\/runs\/(?<runId>\d+)(?:\/attempts\/(?<attempt>\d+))?(?:\/job\/(?<jobId>\d+))?(?:[^\s<>)\]]*)?/giu;
const CHECK_RUN_URL_PATTERN = /\/check-runs\/(?<checkRunId>\d+)$/u;
const ERROR_LINE_PATTERN =
  /(?<prefix>^|[\s›])(?<marker>✘|error|failed|failure|exception|traceback|panic|fatal|GH\d{3}|exit code|remote:|rejected|denied|timed out|segmentation fault|core dumped)/iu;
const LINE_BREAK_PATTERN = /\r?\n/u;
const SAFE_FILENAME_PATTERN = /[^a-z0-9_.-]/giu;
const ANSI_ESCAPE = "\u001B";
const ANSI_ESCAPE_PATTERN = new RegExp(
  `${ANSI_ESCAPE}\\[[0-9;?]*[ -/]*[@-~]`,
  "gu"
);
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

const stripAnsi = (text: string): string =>
  text.replaceAll(ANSI_ESCAPE_PATTERN, "").replaceAll("\uFEFF", "");

const mergeWindows = (windows: [number, number][]): [number, number][] => {
  const merged: [number, number][] = [];
  for (const window of windows.toSorted((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (!previous || window[0] > previous[1] + 2) {
      merged.push([window[0], window[1]]);
    } else {
      previous[1] = Math.max(previous[1], window[1]);
    }
  }
  return merged;
};

const summarizeFailedLog = (rawLog: string): string => {
  const lines = stripAnsi(rawLog)
    .split(LINE_BREAK_PATTERN)
    .map((line) => {
      const parts = line.split("\t");
      return parts.length >= 3
        ? `${parts[1]} | ${parts.slice(2).join("\t")}`
        : line;
    })
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return "No failed-step logs returned by gh.";
  }
  const windows: [number, number][] = [];
  for (const [index, line] of lines.entries()) {
    const separator = line.indexOf(" | ");
    const message = separator === -1 ? line : line.slice(separator + 3);
    if (ERROR_LINE_PATTERN.test(message)) {
      windows.push([
        Math.max(0, index - 8),
        Math.min(lines.length, index + 15),
      ]);
    }
  }
  const errors = mergeWindows(windows);
  const sections = [`Full failed-step log lines: ${lines.length}`];
  if (errors.length > 0) {
    sections.push("### Error-focused excerpts");
    for (const [start, end] of mergeWindows([
      ...errors.slice(0, 3),
      ...errors.slice(-3),
    ])) {
      sections.push(
        `--- lines ${start + 1}-${end} ---\n${lines.slice(start, end).join("\n")}`
      );
    }
  } else {
    sections.push(
      "No obvious error markers found; including tail of failed-step log."
    );
  }
  const tailStart = Math.max(0, lines.length - (errors.length > 0 ? 120 : 180));
  sections.push(
    `### Tail (${lines.length - tailStart} lines)\n${lines.slice(tailStart).join("\n")}`
  );
  return truncate(sections.join("\n\n"), 22_000);
};

const interesting = (step: {
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
    (url) => {
      const repo = `${url.owner}/${url.repo}`;
      const annotations = Effect.fn("Actions.annotations")(
        function* annotations(checkRunUrl: string | null | undefined) {
          const id = checkRunUrl
            ? CHECK_RUN_URL_PATTERN.exec(checkRunUrl)?.groups?.checkRunId
            : undefined;
          if (!id) {
            return [];
          }
          const result = yield* github.execute(
            [
              "api",
              `repos/${repo}/check-runs/${id}/annotations`,
              "--paginate",
              "--slurp",
            ],
            { cwd }
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

      const job = Effect.gen(function* jobSections() {
        if (!url.jobId) {
          return [];
        }
        const result = yield* github.execute(
          ["api", `repos/${repo}/actions/jobs/${url.jobId}`],
          { cwd }
        );
        const { steps, ...summary } = yield* decodeJson(
          Job,
          result.stdout,
          "action job"
        );
        const annotationSections = yield* annotations(
          summary.check_run_url
        ).pipe(sectionFallback("Check annotations"));
        const failed = steps.filter(interesting);
        return [
          `## Job summary\n${json(summary)}`,
          `## Failed or incomplete steps\n${failed.length > 0 ? json(failed) : "None reported by the jobs API."}`,
          ...annotationSections,
        ];
      }).pipe(sectionFallback("Job API"));

      const run = Effect.gen(function* runSections() {
        const args = [
          "run",
          "view",
          url.runId,
          "--repo",
          repo,
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
        const failed = jobs.filter(interesting);
        return [
          `## Workflow run summary\n${json(summary)}`,
          ...(url.jobId
            ? []
            : [
                `## Failed or incomplete jobs\n${failed.length > 0 ? json(failed) : "None reported by gh run view."}`,
              ]),
        ];
      }).pipe(sectionFallback("Run summary"));

      const log = Effect.gen(function* logSections() {
        const args = ["run", "view", url.runId, "--repo", repo, "--log-failed"];
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
      }).pipe(sectionFallback("Failed-step log"));

      return Effect.all([job, run, log], { concurrency: 3 }).pipe(
        Effect.map((sections) =>
          truncate(
            [
              `## GitHub Actions URL\n${url.url}`,
              `Repository: ${repo}\nRun ID: ${url.runId}${url.attempt ? `\nAttempt: ${url.attempt}` : ""}${url.jobId ? `\nJob ID: ${url.jobId}` : ""}`,
              ...sections.flat(),
            ].join("\n\n"),
            30_000
          )
        )
      );
    },
    { concurrency: 3 }
  );
  return contexts.join("\n\n---\n\n");
});
