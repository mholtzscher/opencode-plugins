import { describe, expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import { makeHost } from "../test-support/host.js";
import { loadPstackSkills } from "./register.js";

describe("bundled pstack", () => {
  test("registers explicit skills with real supporting files and no prompt admission", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* checkRegistration() {
          const host = yield* makeHost();
          expect(host.registeredSkills.size).toBe(51);
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
    const mode = skills.find((skill) => skill.id === "poteto-mode");
    if (!mode) {
      throw new Error("Missing poteto-mode");
    }
    const existing = {
      ...mode,
      autoinvoke: true,
      content: "Project-specific poteto mode",
    };
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* checkCollision() {
          const host = yield* makeHost({ existingSkills: [existing] });
          expect(host.registeredSkills.get("poteto-mode")).toEqual(existing);
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
