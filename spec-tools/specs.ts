import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

// oxlint-disable-next-line typescript/strict-void-return
const execFileAsync = promisify(execFile);

const runGit = async (
  args: string[],
  cwd: string,
  signal: AbortSignal
): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 4 * 1024 * 1024,
      signal,
      timeout: 5000,
    });
    return stdout;
  } catch {
    signal.throwIfAborted();
    return null;
  }
};

const readUncommittedSpecNames = async (
  directory: string,
  signal: AbortSignal
): Promise<Set<string> | null> => {
  const prefix = await runGit(
    ["rev-parse", "--show-prefix"],
    directory,
    signal
  );
  if (prefix === null) {
    return null;
  }
  const status = await runGit(
    ["status", "--porcelain", "-z", "--no-renames", "--", "."],
    directory,
    signal
  );
  if (status === null) {
    return null;
  }
  const pathPrefix = prefix.trim();
  return new Set(
    status
      .split("\0")
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.slice(3))
      .filter((entry) => entry.startsWith(pathPrefix))
      .map((entry) => entry.slice(pathPrefix.length))
  );
};

export const listSpecs = async (
  cwd: string,
  signal: AbortSignal
): Promise<string[]> => {
  signal.throwIfAborted();
  const directory = path.join(cwd, "specs");
  const entries = await readdir(directory, { withFileTypes: true });
  const uncommitted = await readUncommittedSpecNames(directory, signal);
  const recencies = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async ({ name }) => {
        const timestamp =
          uncommitted === null || uncommitted.has(name)
            ? null
            : await runGit(
                ["log", "-1", "--format=%ct", "--", name],
                directory,
                signal
              );
        const seconds = timestamp?.trim()
          ? Number(timestamp.trim())
          : Number.NaN;
        let recency = Math.trunc(seconds) * 1000;
        if (!Number.isFinite(seconds)) {
          const { mtimeMs } = await stat(path.join(directory, name));
          recency = mtimeMs;
        }
        return { name, recency };
      })
  );
  signal.throwIfAborted();
  return recencies
    .toSorted(
      (left, right) =>
        right.recency - left.recency || left.name.localeCompare(right.name)
    )
    .map(({ name }) => name);
};

/** Only direct files in specs/ are supported, matching the picker. */
export const resolveSpecPath = async (
  cwd: string,
  input: string
): Promise<string> => {
  const value = input.trim();
  const unquoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
      ? value.slice(1, -1)
      : value;
  const name = unquoted.startsWith("specs/") ? unquoted.slice(6) : unquoted;
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error(
      "Choose a direct file under specs/, for example specs/auth.md"
    );
  }
  const entries = await readdir(path.join(cwd, "specs"), {
    withFileTypes: true,
  });
  if (!entries.some((entry) => entry.name === name && entry.isFile())) {
    throw new Error(`Specification not found: specs/${name}`);
  }
  return `specs/${name}`;
};
