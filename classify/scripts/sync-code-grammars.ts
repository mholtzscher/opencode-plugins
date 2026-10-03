import { mkdir, writeFile } from "node:fs/promises";

// Versions from tree-sitter-wasms@0.1.13's build lockfile (commit 3e88dc9).
const sources = [
  { name: "go", package: "tree-sitter-go@0.20.0", path: "src/node-types.json" },
  {
    name: "javascript",
    package: "tree-sitter-javascript@0.20.4",
    path: "src/node-types.json",
  },
  {
    name: "kotlin",
    package: "tree-sitter-kotlin@0.3.8",
    path: "src/node-types.json",
  },
  {
    name: "typescript",
    package: "tree-sitter-typescript@0.20.5",
    path: "typescript/src/node-types.json",
  },
  {
    name: "tsx",
    package: "tree-sitter-typescript@0.20.5",
    path: "tsx/src/node-types.json",
  },
];

const directory = new URL("../grammars/", import.meta.url);
await mkdir(directory, { recursive: true });
await Promise.all(
  sources.map(async (source) => {
    for (const [remote, local] of [
      [source.path, `${source.name}.json`],
      ["LICENSE", `${source.name}.LICENSE`],
    ]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Fetch each pinned package asset once, sequentially within its grammar.
      const response = await fetch(
        `https://unpkg.com/${source.package}/${remote}`
      );
      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${source.package}/${remote}: ${response.status}`
        );
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- Persist the fetched artifact before requesting the next asset.
      await writeFile(new URL(local, directory), await response.text());
    }
  })
);
