import solid from "@opentui/solid/bun-plugin";
import { build, file } from "bun";

const check = process.argv.includes("--check");
// Keep host runtimes external so the plugin shares OpenCode's Solid owner graph.
const result = await build({
  entrypoints: [new URL("./tui.tsx", import.meta.url).pathname],
  outdir: check ? undefined : new URL("./dist", import.meta.url).pathname,
  packages: "external",
  plugins: [solid],
  target: "bun",
});

if (!result.success) {
  throw new AggregateError(
    result.logs,
    "Failed to build the cache metrics TUI"
  );
}

if (check) {
  const [saved, compiled] = await Promise.all([
    file(new URL("./dist/tui.js", import.meta.url)).text(),
    result.outputs[0]?.text(),
  ]);
  if (saved !== compiled) {
    throw new Error(
      "TUI build is stale. Run bun run build:tui and commit dist/tui.js."
    );
  }
}
