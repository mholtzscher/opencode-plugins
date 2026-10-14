import { describe, expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { Agent } from "@opencode/schema/agent";
import { Effect } from "effect";

import { makeHost } from "../test-support/host.js";
import { loadPstackSkills } from "./register.js";

describe("bundled pstack", () => {
  test("registers delegates with inherited models, packaged instructions, and reviewer restrictions", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* checkAgents() {
          const host = yield* makeHost();
          expect([...host.registeredAgents.keys()]).toEqual([
            "poteto-agent",
            "comment-sicko",
          ]);
          for (const agent of host.registeredAgents.values()) {
            expect(agent.mode).toBe("subagent");
            expect(agent.model).toBeUndefined();
            expect(agent.system).toContain("OPENCODE.md");
            expect(agent.system).toContain("poteto-mode/SKILL.md");
          }
          expect(host.registeredAgents.get("poteto-agent")?.system).toContain(
            "You are one of its delegates."
          );
          expect(
            host.registeredAgents.get("comment-sicko")?.permissions.slice(-3)
          ).toEqual([
            { action: "edit", effect: "deny", resource: "*" },
            { action: "shell", effect: "deny", resource: "*" },
            { action: "subagent", effect: "deny", resource: "*" },
          ]);
        })
      )
    );
  });

  test("preserves existing same-ID agents", async () => {
    const existing = {
      ...Agent.Info.default(Agent.ID.make("poteto-agent")),
      system: "My project delegate",
    };
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* checkAgentCollision() {
          const host = yield* makeHost({ existingAgents: [existing] });
          expect(host.registeredAgents.get("poteto-agent")).toEqual(existing);
          expect(host.registeredAgents.get("comment-sicko")?.mode).toBe(
            "subagent"
          );
        })
      )
    );
  });
  test("registers explicit skills with real supporting files and no prompt admission", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* checkRegistration() {
          const host = yield* makeHost();
          expect(host.registeredSkills.size).toBe(52);
          expect(host.registeredSkills.get("deslop")?.path).toContain(
            "team-kit/skills/deslop/SKILL.md"
          );
          expect(host.registeredSkills.get("deslop")?.autoinvoke).toBe(false);
          expect(host.registeredSkills.has("make-bot-ui")).toBe(false);
          expect(host.registeredSkills.has("poteto-mode")).toBe(true);
          expect(host.registeredSkills.has("setup-pstack")).toBe(true);
          expect(host.registeredSkills.has("interrogate")).toBe(true);
          for (const skill of host.registeredSkills.values()) {
            expect(skill.autoinvoke).toBe(false);
            yield* Effect.promise(() => access(skill.path));
          }
          expect(host.admissions).toEqual([]);
          expect(host.processes).toEqual([]);
          expect(host.reads).toEqual([]);
        })
      )
    );
  });

  test("preserves an existing installation with the same skill ID", async () => {
    const skills = await loadPstackSkills();
    const mode = skills.find((skill) => skill.id === "deslop");
    if (!mode) {
      throw new Error("Missing deslop");
    }
    const existing = {
      ...mode,
      autoinvoke: true,
      content: "Project-specific deslop",
    };
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* checkCollision() {
          const host = yield* makeHost({ existingSkills: [existing] });
          expect(host.registeredSkills.get("deslop")).toEqual(existing);
          expect(host.registeredSkills.has("arena")).toBe(true);
        })
      )
    );
  });

  test("keeps upstream bodies intact and relative Markdown references readable", async () => {
    const skills = await loadPstackSkills();
    await Promise.all(
      skills.map(async (skill) => {
        const source = await readFile(skill.path, "utf-8");
        const body = source.slice(source.indexOf("\n---", 4) + 4).trim();
        expect(skill.content.endsWith(body)).toBe(true);
        expect(skill.content).toContain("OPENCODE.md");
        const references: Promise<void>[] = [];
        for (const match of body.matchAll(/\]\((?<target>[^\s)]+)\)/gu)) {
          const target = match.groups?.target;
          if (!target) {
            throw new Error("Missing reference target");
          }
          if (target.startsWith("http") || target.startsWith("#")) {
            continue;
          }
          references.push(
            access(path.resolve(path.dirname(skill.path), target.split("#")[0]))
          );
        }
        await Promise.all(references);
      })
    );
  });
});
