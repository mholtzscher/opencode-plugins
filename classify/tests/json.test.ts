import { expect, test } from "bun:test";
import { boundedJson } from "../validation/json.js";

test("JSON byte boundary measures the serialized value exactly", () => {
  const value = { state: "a".repeat(1024 * 1024 - 12) };
  expect(Buffer.byteLength(JSON.stringify(value))).toBe(1024 * 1024);
  expect(() => boundedJson(value)).not.toThrow();
  expect(() => boundedJson({ state: `${value.state}a` })).toThrow();
});

test("JSON traversal rejects non-JSON values, getters, cycles, size and depth", () => {
  const cycle: unknown[] = [];
  cycle.push(cycle);
  for (const value of [
    cycle,
    new Date(),
    { a: undefined },
    { a: Number.POSITIVE_INFINITY },
    { a: () => 1 },
    new Array(2),
    {
      get secret() {
        throw new Error("must not execute");
      },
    },
    { [Symbol("key")]: 1 },
    "a".repeat(1024 * 1024),
  ]) {
    expect(() => boundedJson(value)).toThrow();
  }
  let deep: unknown = "leaf";
  for (let i = 0; i < 32; i += 1) {
    deep = [deep];
  }
  expect(() => boundedJson(deep)).not.toThrow();
  expect(() => boundedJson([deep])).toThrow();
});
