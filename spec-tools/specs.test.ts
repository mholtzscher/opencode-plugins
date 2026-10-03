import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";

import { listSpecs, resolveSpecPath } from "./specs.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});
const makeDirectory = async () => {
  const directory = await mkdtemp("/tmp/opencode/spec-discovery-test-");
  directories.push(directory);
  await mkdir(`${directory}/specs`);
  return directory;
};

describe("server specification discovery", () => {
  test("without Git, orders by mtime, breaks ties by name, and excludes directories and symlinks", async () => {
    const directory = await makeDirectory();
    await Promise.all(
      ["older.md", "b.md", "a.md"].map(async (name) => {
        await writeFile(`${directory}/specs/${name}`, name);
        const time = name === "older.md" ? 1000 : 2000;
        await utimes(`${directory}/specs/${name}`, time, time);
      })
    );
    await mkdir(`${directory}/specs/folder`);
    await symlink(`${directory}/specs/a.md`, `${directory}/specs/link.md`);
    expect(await listSpecs(directory, new AbortController().signal)).toEqual([
      "a.md",
      "b.md",
      "older.md",
    ]);
    await expect(resolveSpecPath(directory, "link.md")).rejects.toThrow(
      "Specification not found"
    );
  });

  test("uses commit dates for clean worktree files and mtime for uncommitted files", async () => {
    const directory = await makeDirectory();
    const git = (args: string[], date?: string) =>
      execFileSync("git", args, {
        cwd: directory,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date,
        },
        stdio: "pipe",
      });
    git(["init"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    await writeFile(`${directory}/specs/old.md`, "Old");
    git(["add", "."]);
    git(["commit", "-m", "Old spec"], "2020-01-01T00:00:00Z");
    await writeFile(`${directory}/specs/new.md`, "New");
    git(["add", "."]);
    git(["commit", "-m", "New spec"], "2021-01-01T00:00:00Z");
    await utimes(`${directory}/specs/old.md`, 2_000_000_000, 2_000_000_000);
    await utimes(`${directory}/specs/new.md`, 2_000_000_000, 2_000_000_000);
    expect(await listSpecs(directory, new AbortController().signal)).toEqual([
      "new.md",
      "old.md",
    ]);
    await writeFile(`${directory}/specs/old.md`, "Changed");
    expect(await listSpecs(directory, new AbortController().signal)).toEqual([
      "old.md",
      "new.md",
    ]);
  });

  test("accepts quoted paths and rejects traversal, absolute paths, and subdirectories", async () => {
    const directory = await makeDirectory();
    await writeFile(`${directory}/specs/my idea.md`, "Spec");
    expect(await resolveSpecPath(directory, '"specs/my idea.md"')).toBe(
      "specs/my idea.md"
    );
    await Promise.all(
      [
        "../outside.md",
        "/etc/passwd",
        "specs/../outside.md",
        "specs/nested/spec.md",
        "specs/..",
        "specs/a\\b",
      ].map(async (value) => {
        await expect(resolveSpecPath(directory, value)).rejects.toThrow(
          "direct file under specs/"
        );
      })
    );
  });

  test("an aborted discovery does not fall back to Git-free results", async () => {
    const directory = await makeDirectory();
    const controller = new AbortController();
    controller.abort();
    await expect(listSpecs(directory, controller.signal)).rejects.toThrow();
  });
});
