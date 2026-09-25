import type { SessionMessageInfo } from "@opencode/client";

/** One recorded assistant response in the cache history timeline. */
export interface CacheHistoryPoint {
  afterCompaction?: string;
  /** Tool calls in the preceding assistant response. */
  afterTools: string[];
  agent: string;
  cumulativeRate?: number;
  finish?: string;
  id: string;
  input: number;
  modelID: string;
  output: number;
  /** Short, single-line user request preceding this response; never tool input or output. */
  prompt?: string;
  providerID: string;
  rate?: number;
  read: number;
  retryAttempt?: number;
  sessionID: string;
  time: number;
  /** Tool calls in this response, useful for identifying the following step. */
  tools: string[];
  write: number;
}

/** Build a chronological cache history from saved messages, deduplicated by session and message ID. */
export function buildCacheHistory(
  sessions: ReadonlyMap<string, readonly SessionMessageInfo[]>
): CacheHistoryPoint[] {
  const points = new Map<string, CacheHistoryPoint>();
  for (const [sessionID, messages] of sessions) {
    let prompt: string | undefined;
    let afterTools: string[] = [];
    let afterCompaction: string | undefined;
    for (const message of messages) {
      if (message.type === "user") {
        prompt =
          message.text.replace(/\s+/g, " ").trim().slice(0, 90) || undefined;
        afterTools = [];
        continue;
      }
      if (message.type === "compaction" && message.status === "completed") {
        afterCompaction = message.reason;
        continue;
      }
      if (
        message.type !== "assistant" ||
        !message.tokens ||
        !message.time.completed
      ) {
        continue;
      }
      const { input, output, cache } = message.tokens;
      const tools = message.content
        .filter((part) => part.type === "tool")
        .map((part) => part.name);
      points.set(`${sessionID}:${message.id}`, {
        afterCompaction,
        afterTools,
        agent: message.agent,
        finish: message.finish,
        id: message.id,
        input,
        modelID: message.model.id,
        output,
        prompt,
        providerID: message.model.providerID,
        rate:
          input + cache.read > 0
            ? cache.read / (input + cache.read)
            : undefined,
        read: cache.read,
        retryAttempt: message.retry?.attempt,
        sessionID,
        time: message.time.completed,
        tools,
        write: cache.write,
      });
      afterTools = tools;
      afterCompaction = undefined;
    }
  }
  const sorted = [...points.values()].sort(
    (a, b) =>
      a.time - b.time ||
      a.sessionID.localeCompare(b.sessionID) ||
      a.id.localeCompare(b.id)
  );
  let input = 0;
  let read = 0;
  return sorted.map((point) => {
    input += point.input;
    read += point.read;
    return {
      ...point,
      cumulativeRate: input + read > 0 ? read / (input + read) : undefined,
    };
  });
}

/** Compact chronological cache-hit trend for up to the latest 40 responses; dots have no measured input. */
export function formatCacheHistoryTrend(
  points: readonly CacheHistoryPoint[]
): string {
  const bars = "▁▂▃▄▅▆▇█";
  return points
    .slice(-40)
    .map((point) =>
      point.rate === undefined
        ? "·"
        : bars[Math.min(bars.length - 1, Math.floor(point.rate * bars.length))]
    )
    .join("");
}
