import path from "node:path";

import { Effect, Schema } from "effect";

import type { Github } from "./github.js";
import { decodeJson } from "./schemas.js";
import type { ReviewThread } from "./schemas.js";

const Revision = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/u));
const Identity = Schema.Struct({
  base: Schema.Struct({ sha: Revision }),
  head: Schema.Struct({ sha: Revision }),
});
const Tree = Schema.Struct({
  tree: Schema.Array(
    Schema.Struct({ path: Schema.String, type: Schema.String })
  ),
  truncated: Schema.Boolean,
});
const Comparison = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      filename: Schema.String,
      patch: Schema.optionalKey(Schema.String),
    })
  ),
});
const Content = Schema.Struct({
  content: Schema.String,
  encoding: Schema.Literal("base64"),
  type: Schema.Literal("file"),
});

export interface SourceEvidence {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly patch?: string;
  readonly limitations: readonly string[];
}
export interface ThreadEvidence {
  readonly sources: readonly SourceEvidence[];
  readonly limitations: readonly string[];
}
export interface ReviewEvidence {
  readonly unstable?: boolean;
  readonly headSha?: string;
  readonly baseSha?: string;
  readonly threads: Readonly<Record<string, ThreadEvidence>>;
  readonly limitations: readonly string[];
}

// These are repository references, never filesystem paths or shell arguments.
const references = (thread: ReviewThread) => {
  const refs = [{ line: thread.line ?? undefined, path: thread.path }];
  let remaining = 24_000;
  let truncated = false;
  for (const comment of thread.comments.nodes) {
    if (remaining === 0 || refs.length >= 32) {
      truncated = true;
      break;
    }
    const body = comment.body.slice(0, remaining);
    remaining -= body.length;
    truncated ||= body.length < comment.body.length;
    for (const match of body.matchAll(
      /(?:^|[\s`("'])(?<path>(?:[\w.-]+\/)*[\w-]+\.[a-zA-Z0-9]+)(?::(?<line>\d+))?/gu
    )) {
      if (!match.groups?.path) {
        continue;
      }
      refs.push({
        line: match.groups.line ? Number(match.groups.line) : undefined,
        path: match.groups.path,
      });
      if (refs.length >= 32) {
        truncated = true;
        break;
      }
    }
  }
  return { refs, truncated };
};

const resolveReference = (
  paths: readonly string[],
  file: string,
  relativeTo: string
) => {
  if (
    file.startsWith("/") ||
    file.split("/").some((part) => part === ".." || part === "." || !part) ||
    file.includes("\\")
  ) {
    return;
  }
  if (paths.includes(file)) {
    return file;
  }
  // The thread's own repository path is authoritative even if the tree is unavailable.
  if (file === relativeTo) {
    return file;
  }
  const relative = path.posix.join(path.posix.dirname(relativeTo), file);
  if (paths.includes(relative)) {
    return relative;
  }
  const matches = paths.filter((candidate) => candidate.endsWith(`/${file}`));
  return matches.length === 1 ? matches[0] : undefined;
};

// Grow around the citation, rather than truncating a prefix that can lose the target.
const excerptRange = (lines: readonly string[], target: number) => {
  let start = target;
  let end = target + 1;
  let size = lines[target].length;
  while (end - start < 100) {
    if (
      start > Math.max(0, target - 40) &&
      size + lines[start - 1].length + 1 <= 6000
    ) {
      start -= 1;
      size += lines[start].length + 1;
    } else if (end < lines.length && size + lines[end].length + 1 <= 6000) {
      size += lines[end].length + 1;
      end += 1;
    } else {
      break;
    }
  }
  return { end, start };
};

const sourceExcerpt = (
  file: string,
  text: string,
  line: number | undefined,
  patch: string | undefined
): SourceEvidence => {
  const lines = text.split("\n");
  const complete = lines.length <= 160 && text.length <= 6000;
  const limitations: string[] = [];
  const validLine =
    line !== undefined &&
    Number.isSafeInteger(line) &&
    line >= 1 &&
    line <= lines.length;
  if (line !== undefined && !validLine) {
    limitations.push(
      `Cited line ${line} is outside this file at the captured head.`
    );
  }
  const target = validLine ? line - 1 : 0;
  const { start, end } = complete
    ? { end: lines.length, start: 0 }
    : excerptRange(lines, target);
  const excerpt = lines.slice(start, end).join("\n").slice(0, 6000);
  if (excerpt !== text) {
    limitations.push("Partial file: omitted code may affect this claim.");
  }
  if (patch === undefined) {
    limitations.push(
      "No patch supplied for this file; this does not prove it is unchanged."
    );
  }
  if (patch && patch.length > 4000) {
    limitations.push("Patch truncated to 4000 characters.");
  }
  return {
    endLine: start + excerpt.split("\n").length,
    limitations,
    patch: patch?.slice(0, 4000),
    path: file,
    startLine: start + 1,
    text: excerpt,
  };
};

const selectReferences = (thread: ReviewThread, paths: readonly string[]) => {
  const limitations: string[] = [];
  const selected = new Map<string, number | undefined>();
  const { refs, truncated } = references(thread);
  if (truncated) {
    limitations.push(
      "Comment reference discovery limited to 24,000 characters and 32 references."
    );
  }
  for (const ref of refs) {
    const resolved = resolveReference(paths, ref.path, thread.path);
    if (resolved) {
      if (!selected.has(resolved) || selected.get(resolved) === undefined) {
        selected.set(resolved, ref.line);
      } else if (
        ref.line !== undefined &&
        selected.get(resolved) !== ref.line
      ) {
        limitations.push(
          `Additional citation ${resolved}:${ref.line} may fall outside the selected excerpt.`
        );
      }
      continue;
    }
    // Dotted identifiers and version numbers are not necessarily file references.
    if (
      ref.path === thread.path ||
      ref.path.includes("/") ||
      paths.some(
        (candidate) =>
          path.posix.extname(candidate) === path.posix.extname(ref.path)
      )
    ) {
      limitations.push(`Unresolved repository reference: ${ref.path}`);
    }
  }
  if (selected.size > 4) {
    limitations.push("Related-file evidence limited to four files per thread.");
  }
  return { limitations, selected: [...selected].slice(0, 4) };
};

export const collectReviewEvidence = Effect.fn("ReviewEvidence.collect")(
  function* collectReviewEvidence(
    github: Github["Service"],
    repository: string,
    number: number,
    threads: readonly ReviewThread[],
    cwd: string
  ) {
    const read = Effect.fn("ReviewEvidence.read")(function* read<A, I>(
      endpoint: string,
      schema: Schema.Codec<A, I>
    ) {
      const response = yield* github.execute(["api", endpoint], {
        cwd,
        timeout: 10_000,
      });
      return yield* decodeJson(
        schema,
        response.stdout,
        "review source evidence"
      );
    });
    const identity = yield* read(
      `repos/${repository}/pulls/${number}`,
      Identity
    );
    const { head, base } = identity;
    const [treeResult, diffResult] = yield* Effect.all(
      [
        read(
          `repos/${repository}/git/trees/${head.sha}?recursive=1`,
          Tree
        ).pipe(Effect.result),
        read(
          `repos/${repository}/compare/${base.sha}...${head.sha}`,
          Comparison
        ).pipe(Effect.result),
      ],
      { concurrency: 2 }
    );
    const limitations: string[] = [];
    const paths =
      treeResult._tag === "Success"
        ? treeResult.success.tree
            .filter((item) => item.type === "blob")
            .map((item) => item.path)
        : [];
    if (treeResult._tag === "Failure" || treeResult.success.truncated) {
      limitations.push(
        "Repository tree unavailable or truncated; related-file discovery is incomplete."
      );
    }
    if (diffResult._tag === "Failure") {
      limitations.push("Pinned base-to-head comparison unavailable.");
    } else if (diffResult.success.files.length >= 300) {
      limitations.push(
        "GitHub comparison may omit files beyond its 300-file limit."
      );
    }
    const patches = new Map(
      diffResult._tag === "Success"
        ? diffResult.success.files.map((file) => [file.filename, file.patch])
        : []
    );
    const contents = new Map<string, string | undefined>();
    const result: Record<string, ThreadEvidence> = {};
    if (threads.length > 48) {
      limitations.push(
        "Source collection limited to the first 48 threads; remaining discussions are retained without source assessments."
      );
    }
    for (const thread of threads.slice(0, 48)) {
      const { limitations: missing, selected } = selectReferences(
        thread,
        paths
      );
      const sources: SourceEvidence[] = [];
      for (const [file, line] of selected) {
        if (!contents.has(file)) {
          if (contents.size >= 24) {
            missing.push(`Source read budget exhausted: ${file}`);
            continue;
          }
          const response = yield* read(
            `repos/${repository}/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${head.sha}`,
            Content
          ).pipe(Effect.result);
          const text =
            response._tag === "Success"
              ? Buffer.from(response.success.content, "base64").toString(
                  "utf-8"
                )
              : undefined;
          contents.set(
            file,
            text && !text.includes("\0") && Buffer.byteLength(text) <= 512_000
              ? text
              : undefined
          );
        }
        const text = contents.get(file);
        if (text === undefined) {
          missing.push(
            `Source unavailable, binary, empty, or oversized: ${file}`
          );
          continue;
        }
        sources.push(sourceExcerpt(file, text, line, patches.get(file)));
      }
      result[thread.id] = { limitations: missing, sources };
    }
    const observed = yield* read(
      `repos/${repository}/pulls/${number}`,
      Identity
    ).pipe(Effect.result);
    const unstable =
      observed._tag === "Failure" ||
      observed.success.head.sha !== head.sha ||
      observed.success.base.sha !== base.sha;
    if (unstable) {
      limitations.push(
        "PR revision changed or could not be rechecked during collection. Saved evidence is historical; rerun /pr-triage before relying on assessments."
      );
    }
    return {
      baseSha: base.sha,
      headSha: head.sha,
      limitations,
      threads: result,
      unstable,
    } satisfies ReviewEvidence;
  },
  (effect) =>
    effect.pipe(
      Effect.timeout("60 seconds"),
      // oxlint-disable-next-line promise/prefer-await-to-then -- Effect recovery preserves interruption and defects.
      Effect.catch(() =>
        Effect.succeed<ReviewEvidence>({
          limitations: [
            "Revision-pinned source collection failed or timed out; assessments remain unresolved.",
          ],
          threads: {},
        })
      )
    )
);
