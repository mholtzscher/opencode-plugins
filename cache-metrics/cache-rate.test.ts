import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { calculateSessionCacheRate } from "./cache-rate.js"

const assistant = (input: number, read: number, write: number) => ({
  type: "assistant",
  tokens: { input, output: 20, reasoning: 0, cache: { read, write } },
}) as SessionMessageInfo

describe("session cache read rate", () => {
  test("weights requests by tokens rather than averaging per-request percentages", () => {
    expect(calculateSessionCacheRate([
      assistant(10, 90, 30),
      assistant(90, 10, 0),
    ])).toEqual({ input: 100, read: 100, write: 30, output: 40, calls: 2, rate: 0.5 })
  })

  test("does not count cache writes or output as cache reads", () => {
    expect(calculateSessionCacheRate([assistant(25, 75, 200)]).rate).toBe(0.75)
  })

  test("shows no rate when there are no measured input tokens", () => {
    expect(calculateSessionCacheRate([assistant(0, 0, 4), { type: "user" } as SessionMessageInfo]))
      .toEqual({ input: 0, read: 0, write: 4, output: 20, calls: 1, rate: undefined })
  })
})
