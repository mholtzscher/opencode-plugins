import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { buildCacheHistory, formatCacheHistoryTrend } from "./cache-history.js"

const response = (id: string, time: number, input: number, read: number, completed = true) => ({
  id,
  type: "assistant",
  agent: "build",
  content: [],
  model: { providerID: "openai", id: "gpt-6-sol" },
  time: { created: time - 5, ...(completed ? { completed: time } : {}) },
  tokens: { input, output: 25, reasoning: 0, cache: { read, write: 0 } },
}) as SessionMessageInfo

describe("cache history timeline", () => {
  test("sorts parent and subagent responses and calculates weighted cumulative rate", () => {
    const history = buildCacheHistory(new Map([
      ["parent", [response("later", 300, 10, 90), response("pending", 400, 0, 0, false)]],
      ["child", [response("earlier", 200, 90, 10)]],
    ]))
    expect(history.map(({ sessionID, id, rate, cumulativeRate }) => ({ sessionID, id, rate, cumulativeRate })))
      .toEqual([
        { sessionID: "child", id: "earlier", rate: 0.1, cumulativeRate: 0.1 },
        { sessionID: "parent", id: "later", rate: 0.9, cumulativeRate: 0.5 },
      ])
  })

  test("skips messages without usage and keeps zero-input responses as unavailable rates", () => {
    const history = buildCacheHistory(new Map([["parent", [
      response("zero", 100, 0, 0),
      { type: "user", id: "u", text: "hello" } as SessionMessageInfo,
      { ...response("no-usage", 200, 10, 20), tokens: undefined } as SessionMessageInfo,
    ]]]))
    expect(history).toHaveLength(1)
    expect(history[0]?.rate).toBeUndefined()
    expect(history[0]?.cumulativeRate).toBeUndefined()
  })

  test("renders the cache-hit trend in chronological order with gaps for missing input", () => {
    const history = buildCacheHistory(new Map([["parent", [
      response("none", 100, 0, 0), response("miss", 200, 100, 0), response("hit", 300, 0, 100),
    ]]]))
    expect(formatCacheHistoryTrend(history)).toBe("·▁█")
  })

  test("attaches request, tools, and compaction metadata to the right response", () => {
    const first = { ...response("first", 200, 10, 0), content: [{ type: "tool", name: "grep" }], finish: "tool-calls" } as SessionMessageInfo
    const history = buildCacheHistory(new Map([["parent", [
      { type: "user", text: "Find   the bug\nnow" } as SessionMessageInfo,
      first,
      { type: "compaction", status: "completed", reason: "auto" } as SessionMessageInfo,
      { ...response("second", 400, 20, 80), retry: { attempt: 2 } } as SessionMessageInfo,
    ]]]))
    expect(history[0]).toMatchObject({ prompt: "Find the bug now", tools: ["grep"], afterTools: [], finish: "tool-calls" })
    expect(history[1]).toMatchObject({ prompt: "Find the bug now", afterTools: ["grep"], afterCompaction: "auto", retryAttempt: 2 })
  })
})
