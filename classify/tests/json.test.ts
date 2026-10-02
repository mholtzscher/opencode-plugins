import { expect, test } from "bun:test";

import type { JsonValue } from "../types.js";
import { isBoundedJsonValue } from "../validation/json.js";

test("JSON byte boundary measures the serialized value exactly", () => {
  const value = { state: "a".repeat(1024 * 1024 - 12) };
  expect(Buffer.byteLength(JSON.stringify(value))).toBe(1024 * 1024);
  expect(isBoundedJsonValue(value)).toBe(true);
  expect(isBoundedJsonValue({ state: `${value.state}a` })).toBe(false);
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
    Array.from({ length: 2 }),
    {
      get secret() {
        throw new Error("must not execute");
      },
    },
    { [Symbol("key")]: 1 },
    "a".repeat(1024 * 1024),
  ]) {
    expect(isBoundedJsonValue(value)).toBe(false);
  }
  let deep: JsonValue = "leaf";
  for (let i = 0; i < 32; i += 1) {
    deep = [deep];
  }
  expect(isBoundedJsonValue(deep)).toBe(true);
  expect(isBoundedJsonValue([deep])).toBe(false);
});

test("sparse and oversized arrays are rejected without allocating index keys or reading members", () => {
  let reads = 0;
  const get = () => {
    reads += 1;
    return "private";
  };
  for (const length of [3, 2 ** 32 - 1]) {
    const sparse: string[] = [];
    sparse.length = length;
    Object.defineProperty(sparse, "0", {
      enumerable: true,
      get,
    });
    expect(isBoundedJsonValue(sparse)).toBe(false);
  }
  expect(reads).toBe(0);
  expect(isBoundedJsonValue([null, null], { maxBytes: 2, maxDepth: 32 })).toBe(
    false
  );
});
