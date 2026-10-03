import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import solid from "ultracite/oxlint/solid";

export default defineConfig({
  extends: [core, solid, antiSlop],
  ignorePatterns: [...core.ignorePatterns, "videos/**"],
  overrides: [
    {
      files: ["**/*.{tsx,jsx}"],
      rules: {
        // OpenTUI's renderer requires the valid @jsxImportSource pragma.
        "jsdoc/check-tag-names": ["error", { jsxTags: true }],
      },
    },
  ],
});
