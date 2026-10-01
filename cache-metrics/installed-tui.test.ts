import { expect, test } from "bun:test";

import { $ } from "bun";

const directory = import.meta.dir;

test("the checked-in TUI matches its source", async () => {
  const result = await $`${process.execPath} run build.ts --check`
    .cwd(directory)
    .quiet()
    .nothrow();
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});

test("the installed history panel renders incoming responses", async () => {
  // A separate process gives the renderer the browser Solid runtime, like OpenCode.
  const result =
    await $`${process.execPath} --conditions=browser --preload @opentui/solid/runtime-plugin-support scripts/check-installed-tui.ts`
      .cwd(directory)
      .quiet()
      .nothrow();
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Installed history panel updated");
}, 15_000);
