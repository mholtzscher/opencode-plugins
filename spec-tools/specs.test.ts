import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";

import { resolveSpecPath } from "./specs.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});
const makeDirectory = async () => {
  const directory = await mkdtemp("/tmp/opencode/spec-path-test-");
  directories.push(directory);
  await mkdir(`${directory}/specs`);
  return directory;
};

describe("specification arguments", () => {
  test.each([
    "my idea.md",
    "specs/my idea.md",
    "@specs/my idea.md",
    "@my idea.md",
    '"specs/my idea.md"',
    "'specs/my idea.md'",
    '@"specs/my idea.md"',
    '"@specs/my idea.md"',
  ])("accepts %s", async (input) => {
    const directory = await makeDirectory();
    await writeFile(`${directory}/specs/my idea.md`, "Spec");
    expect(await resolveSpecPath(directory, input)).toBe("specs/my idea.md");
  });

  test.each([
    "",
    "@",
    "../outside.md",
    "/etc/passwd",
    "specs/../outside.md",
    "@specs/../outside.md",
    "@/etc/passwd",
    '"@specs/../outside.md"',
    "specs/nested/spec.md",
    "specs/..",
    "specs/a\\b",
    "specs/a\0b",
  ])("rejects unsafe or unsupported input %j", async (input) => {
    const directory = await makeDirectory();
    await expect(resolveSpecPath(directory, input)).rejects.toThrow(
      "direct file under specs/"
    );
  });

  test("rejects symlinks, directories, and missing files", async () => {
    const directory = await makeDirectory();
    await writeFile(`${directory}/specs/example.md`, "Spec");
    await mkdir(`${directory}/specs/folder`);
    await symlink(
      `${directory}/specs/example.md`,
      `${directory}/specs/link.md`
    );
    await Promise.all(
      ["link.md", "folder", "missing.md"].map(async (name) => {
        await expect(resolveSpecPath(directory, name)).rejects.toThrow(
          "Specification not found"
        );
      })
    );
  });
});
