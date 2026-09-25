import { describe, expect, test } from "bun:test";
import type { SessionMessageInfo } from "@opencode/client";
import { buildCacheHistory, formatCacheHistoryTrend } from "./cache-history.js";

const response = (
  id: string,
  time: number,
  input: number,
  read: number,
  completed = true
) =>
  ({
    agent: "build",
    content: [],
    id,
    model: { id: "gpt-6-sol", providerID: "openai" },
    time: { created: time - 5, ...(completed ? { completed: time } : {}) },
    tokens: { cache: { read, write: 0 }, input, output: 25, reasoning: 0 },
    type: "assistant",
  }) as SessionMessageInfo;

describe("cache history timeline", () => {
  test("sorts parent and subagent responses and calculates weighted cumulative rate", () => {
    const history = buildCacheHistory(
      new Map([
        [
          "parent",
          [
            response("later", 300, 10, 90),
            response("pending", 400, 0, 0, false),
          ],
        ],
        ["child", [response("earlier", 200, 90, 10)]],
      ])
    );
    expect(
      history.map(({ sessionID, id, rate, cumulativeRate }) => ({
        cumulativeRate,
        id,
        rate,
        sessionID,
      }))
    ).toEqual([
      { cumulativeRate: 0.1, id: "earlier", rate: 0.1, sessionID: "child" },
      { cumulativeRate: 0.5, id: "later", rate: 0.9, sessionID: "parent" },
    ]);
  });

  test("skips messages without usage and keeps zero-input responses as unavailable rates", () => {
    const history = buildCacheHistory(
      new Map([
        [
          "parent",
          [
            response("zero", 100, 0, 0),
            { id: "u", text: "hello", type: "user" } as SessionMessageInfo,
            {
              ...response("no-usage", 200, 10, 20),
              tokens: undefined,
            } as SessionMessageInfo,
          ],
        ],
      ])
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.rate).toBeUndefined();
    expect(history[0]?.cumulativeRate).toBeUndefined();
  });

  test("renders the cache-hit trend in chronological order with gaps for missing input", () => {
    const history = buildCacheHistory(
      new Map([
        [
          "parent",
          [
            response("none", 100, 0, 0),
            response("miss", 200, 100, 0),
            response("hit", 300, 0, 100),
          ],
        ],
      ])
    );
    expect(formatCacheHistoryTrend(history)).toBe("·▁█");
  });

  test("attaches request, tools, and compaction metadata to the right response", () => {
    const first = {
      ...response("first", 200, 10, 0),
      content: [{ name: "grep", type: "tool" }],
      finish: "tool-calls",
    } as SessionMessageInfo;
    const history = buildCacheHistory(
      new Map([
        [
          "parent",
          [
            { text: "Find   the bug\nnow", type: "user" } as SessionMessageInfo,
            first,
            {
              reason: "auto",
              status: "completed",
              type: "compaction",
            } as SessionMessageInfo,
            {
              ...response("second", 400, 20, 80),
              retry: { attempt: 2 },
            } as SessionMessageInfo,
          ],
        ],
      ])
    );
    expect(history[0]).toMatchObject({
      afterTools: [],
      finish: "tool-calls",
      prompt: "Find the bug now",
      tools: ["grep"],
    });
    expect(history[1]).toMatchObject({
      afterCompaction: "auto",
      afterTools: ["grep"],
      prompt: "Find the bug now",
      retryAttempt: 2,
    });
  });

  test("flags lost cached reads only against comparable context sizes", () => {
    const history = buildCacheHistory(
      new Map([
        [
          "parent",
          [
            response("warm", 100, 1000, 8000),
            response("expanded", 200, 9000, 8000),
            response("lost", 300, 16_000, 1000),
            response("low-again", 400, 16_500, 500),
            response("shrunk", 500, 100, 9000),
            response("tiny-context", 550, 100, 100),
            {
              ...response("other-model", 600, 900, 100),
              model: { id: "other", providerID: "openai" },
            } as SessionMessageInfo,
          ],
        ],
        ["child", [response("child-miss", 700, 900, 100)]],
      ])
    );
    expect(history.map((point) => point.previousRead)).toEqual([
      undefined,
      undefined,
      8000,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("does not compare across compaction or a low-cache intervening response", () => {
    const history = buildCacheHistory(
      new Map([
        [
          "parent",
          [
            response("warm", 100, 1000, 8000),
            {
              reason: "auto",
              status: "completed",
              type: "compaction",
            } as SessionMessageInfo,
            response("compacted", 200, 8000, 1000),
            response("next", 300, 8000, 500),
          ],
        ],
      ])
    );
    expect(history.map((point) => point.previousRead)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
