import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Skill } from "@opencode/schema/skill";
import { YAML } from "bun";
import { Effect, Schema } from "effect";

const frontmatterPattern = /^---\r?\n(?<metadata>[\s\S]*?)\r?\n---\r?\n/u;
const metadataSchema = Schema.Struct({
  description: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});

export const loadDecisionSkill = Effect.fn("loadDecisionSkill")(
  function* loadDecisionSkill() {
    const url = new URL("skills/classify-decide/SKILL.md", import.meta.url);
    const markdown = yield* Effect.tryPromise(() => readFile(url, "utf-8"));
    const frontmatter = frontmatterPattern.exec(markdown);
    if (!frontmatter) {
      return yield* Effect.die(
        new Error("Decision skill frontmatter is missing.")
      );
    }
    const metadata = yield* Schema.decodeUnknownEffect(metadataSchema)(
      yield* Effect.try(() => YAML.parse(frontmatter[1]))
    );
    return yield* Schema.decodeUnknownEffect(Skill.Info)({
      ...metadata,
      content: markdown.slice(frontmatter[0].length).trim(),
      id: "classify-decide",
      path: fileURLToPath(url),
    });
  }
);
