import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // Release Please owns changelog formatting.
  ignorePatterns: [...(ultracite.ignorePatterns ?? []), "**/CHANGELOG.md"],
});
