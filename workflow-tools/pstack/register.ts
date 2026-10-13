import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Plugin } from "@opencode/plugin/effect";
import { Skill } from "@opencode/schema/skill";
import { YAML } from "bun";
import { Effect, Schema } from "effect";

const root = new URL("upstream/skills/", import.meta.url);
const adapter = fileURLToPath(new URL("OPENCODE.md", import.meta.url));
const agents = fileURLToPath(new URL("upstream/agents/", import.meta.url));
const Frontmatter = Schema.Struct({
  description: Schema.String,
  name: Schema.String,
});

export const loadPstackSkills = async (): Promise<readonly Skill.Info[]> => {
  const directories = await readdir(root, { withFileTypes: true });
  return Promise.all(
    directories
      .filter((entry) => entry.isDirectory() && entry.name !== "make-bot-ui")
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map(async (entry) => {
        const path = fileURLToPath(new URL(`${entry.name}/SKILL.md`, root));
        const source = await readFile(path, "utf-8");
        const end = source.indexOf("\n---", 4);
        if (!source.startsWith("---\n") || end === -1) {
          throw new Error(`Missing pstack frontmatter: ${path}`);
        }
        const metadata = Schema.decodeUnknownSync(Frontmatter)(
          YAML.parse(source.slice(4, end))
        );
        return Schema.decodeUnknownSync(Skill.Info)({
          autoinvoke: false,
          content: `Read ${adapter} before following this upstream skill. It maps Cursor operations to OpenCode; keep the upstream workflow otherwise. Bundled skills live at ${fileURLToPath(root)} and delegate instructions at ${agents}. Use these absolute paths in delegated briefs.\n\n${source.slice(end + 4).trim()}`,
          description: metadata.description,
          id: entry.name,
          name: metadata.name,
          path,
        });
      })
  );
};

export const registerPstackSkills = Effect.fn("registerPstackSkills")(
  function* registerPstackSkills(ctx: Plugin.Context) {
    const skills = yield* Effect.promise(loadPstackSkills);
    yield* ctx.skill.transform((editor) => {
      for (const skill of skills) {
        if (!editor.get(skill.id)) {
          editor.add(skill);
        }
      }
    });
  }
);

export const registerPstackAgents = Effect.fn("registerPstackAgents")(
  function* registerPstackAgents(ctx: Plugin.Context) {
    const definitions = yield* Effect.promise(() =>
      Promise.all(
        ["poteto-agent", "comment-sicko"].map(async (id) => {
          const path = fileURLToPath(
            new URL(`upstream/agents/${id}.md`, import.meta.url)
          );
          const source = await readFile(path, "utf-8");
          const end = source.indexOf("\n---", 4);
          if (!source.startsWith("---\n") || end === -1) {
            throw new Error(`Missing pstack frontmatter: ${path}`);
          }
          const metadata = Schema.decodeUnknownSync(Frontmatter)(
            YAML.parse(source.slice(4, end))
          );
          return {
            description: metadata.description,
            id,
            system: `Read ${adapter} before doing any work. Bundled skills live at ${fileURLToPath(root)}. For poteto-mode use ${fileURLToPath(new URL("poteto-mode/SKILL.md", root))}; read its full body before working as poteto-agent. Resolve all host operations through the adapter.\n\n${source.slice(end + 4).trim()}`,
          };
        })
      )
    );
    yield* ctx.agent.transform((editor) => {
      for (const definition of definitions) {
        if (editor.get(definition.id)) {
          continue;
        }
        editor.update(definition.id, (agent) => {
          agent.mode = "subagent";
          agent.hidden = false;
          agent.description = definition.description;
          agent.system = definition.system;
          // Comment Sicko reports findings; editing remains the owner's job.
          if (definition.id === "comment-sicko") {
            agent.permissions.push(
              { action: "edit", effect: "deny", resource: "*" },
              { action: "shell", effect: "deny", resource: "*" },
              { action: "subagent", effect: "deny", resource: "*" }
            );
          } else {
            agent.permissions.push({
              action: "subagent",
              effect: "deny",
              resource: "*",
            });
          }
        });
      }
    });
  }
);
