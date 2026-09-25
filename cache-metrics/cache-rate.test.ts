import { describe, expect, test } from "bun:test";
import type { SessionMessageInfo } from "@opencode/client";
import { calculateSessionCacheRate } from "./cache-rate.js";

const assistant = (input: number, read: number, write: number) =>
  ({
    tokens: { cache: { read, write }, input, output: 20, reasoning: 0 },
    type: "assistant",
  }) as SessionMessageInfo;

describe("session cache read rate", () => {
  test("weights requests by tokens rather than averaging per-request percentages", () => {
    expect(
      calculateSessionCacheRate([assistant(10, 90, 30), assistant(90, 10, 0)])
    ).toEqual({
      calls: 2,
      input: 100,
      output: 40,
      rate: 0.5,
      read: 100,
      write: 30,
    });
  });

  test("does not count cache writes or output as cache reads", () => {
    expect(calculateSessionCacheRate([assistant(25, 75, 200)]).rate).toBe(0.75);
  });

  test("shows no rate when there are no measured input tokens", () => {
    expect(
      calculateSessionCacheRate([
        assistant(0, 0, 4),
        { type: "user" } as SessionMessageInfo,
      ])
    ).toEqual({
      calls: 1,
      input: 0,
      output: 20,
      rate: undefined,
      read: 0,
      write: 4,
    });
  });
});
