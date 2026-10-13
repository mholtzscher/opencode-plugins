import { afterEach, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scripts = fileURLToPath(
  new URL("upstream/skills/poteto-mode/scripts/", import.meta.url)
);
const temporary: string[] = [];
const directory = () => {
  const result = mkdtempSync(path.join(os.tmpdir(), "pstack-port-"));
  temporary.push(result);
  return result;
};
afterEach(() => {
  for (const item of temporary.splice(0)) {
    rmSync(item, { force: true, recursive: true });
  }
});

test("worktree audit keeps unavailable activity unknown and recognizes recent Linux exports", () => {
  const root = directory();
  const repo = path.join(root, "repo");
  const worker = path.join(root, "worker [one]");
  const exports = path.join(root, "exports");
  mkdirSync(repo);
  mkdirSync(exports);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf-8",
      stdio: "pipe",
    });
  git("init", "--initial-branch=main");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-m",
    "initial"
  );
  git("worktree", "add", "-b", "worker", worker);
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "gh"), "#!/bin/sh\nprintf '[]\\n'\n", {
    mode: 0o755,
  });
  const run = (...args: string[]) => {
    const result = spawnSync(
      "bash",
      [path.join(scripts, "worktree-audit.sh"), "-b", "HEAD", ...args, repo],
      {
        encoding: "utf-8",
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        },
      }
    );
    expect(result.status).toBe(0);
    const row = result.stdout
      .split("\n")
      .find((line) => line.endsWith(`\t${worker}`));
    if (!row) {
      throw new Error(
        `Missing worktree row: ${result.stdout}\n${result.stderr}`
      );
    }
    return row.split("\t");
  };
  expect(run().slice(6, 8)).toEqual(["unknown", "review"]);
  expect(run("--transcripts", exports).slice(6, 8)).toEqual([
    "unknown",
    "review",
  ]);
  const transcript = path.join(exports, "chat.jsonl");
  writeFileSync(
    transcript,
    JSON.stringify({ path: `${worker}-other/file.ts` })
  );
  expect(run("--transcripts", exports).slice(6, 8)).toEqual([
    "unknown",
    "review",
  ]);
  writeFileSync(transcript, JSON.stringify({ path: `${worker}/file.ts` }));
  expect(run("--transcripts", exports)[7]).toBe("verify-recent-chat");
  const old = new Date(Date.now() - 10 * 86_400_000);
  utimesSync(transcript, old, old);
  expect(run("--transcripts", exports)[7]).toBe("safe");
});

// Fixture adapted from the pinned original pstack check-plan.test.ts.
test("plan checker accepts installed-package reads and still requires verification evidence", () => {
  const rule =
    "Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.";
  const plan = `# Demo

## How to read this
One box is one unit of work and names the evidence. Check a box only when its evidence exists. See playbooks/.
${rule}

## Program checklist
### Arm the program
### Spawn owners
### PR mechanics
### Verdict and merge
### Boot recipe
Read from the installed plugin. /loop 1h status message

## PR 1
**Depends on.** None.
**Files.**
- [ ] Do the thing.
**Build.**
- [ ] Do the thing.
**You see.**
- [ ] Do the thing.
**Verify, unit.** ${rule}
- [ ] Check the thing.
**Verify, live.** ${rule} Ten lanes on \`example-model\` at the PR head
${Array.from({ length: 10 }, (_, i) => `- [ ] Lane ${i + 1}. Save \`lane-${i + 1}.png\`. Pass when evidence exists.`).join("\n")}
**Verify, perf.** ${rule}
- [ ] Metric. Recorded.
- [ ] Probe. Recorded.
- [ ] Baseline. Recorded.
- [ ] Rule. Recorded.
**Review gate.** None.
**Merge.**
- [ ] Merge when approved.

## Close the program
Close.

## Appendix Prototype evidence
Recorded.
`;
  const file = path.join(directory(), "plan.md");
  const run = (content: string) => {
    writeFileSync(file, content);
    return spawnSync(
      process.execPath,
      [path.join(scripts, "check-plan.mjs"), file],
      { encoding: "utf-8" }
    );
  };
  expect(run(plan).status).toBe(0);
  expect(
    run(plan.replace("installed plugin", "git show origin/main:")).status
  ).toBe(1);
  expect(
    run(plan.replace("**Verify, live.**", "**Skipped live.**")).status
  ).toBe(1);
});
