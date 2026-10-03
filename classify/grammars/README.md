# Tree-sitter grammar metadata

These `node-types.json` files and licenses are copied from the pinned npm packages used by the `tree-sitter-wasms@0.1.13` build lockfile at commit [`3e88dc9e36b4e8bf752ce53bea61e4b67282a2bb`](https://github.com/Gregoor/tree-sitter-wasms/blob/3e88dc9e36b4e8bf752ce53bea61e4b67282a2bb/pnpm-lock.yaml).

| Asset | Upstream package | Package source path |
| --- | --- | --- |
| `go.json` | `tree-sitter-go@0.20.0` | `src/node-types.json` |
| `javascript.json` | `tree-sitter-javascript@0.20.4` | `src/node-types.json` |
| `kotlin.json` | `tree-sitter-kotlin@0.3.8` | `src/node-types.json` |
| `typescript.json` | `tree-sitter-typescript@0.20.5` | `typescript/src/node-types.json` |
| `tsx.json` | `tree-sitter-typescript@0.20.5` | `tsx/src/node-types.json` |

Each corresponding `.LICENSE` is the upstream package's `LICENSE`. JSON formatting may differ from upstream; data is unchanged. The runtime reports whether each type can actually be queried in the installed WASM grammar; metadata may also describe abstract or grammar-variant-specific types.

To refresh intentionally, update the pinned package versions in `scripts/sync-code-grammars.ts` alongside the WASM dependency, run it from `classify/`, format `classify/grammars/*.json` from the repository root, and run the grammar/query tests. Adding a language requires its WASM asset, metadata/license, and extension registration—not a declaration adapter.
