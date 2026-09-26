/** @jsxImportSource @opentui/solid */

import { appendFileSync } from "node:fs";
import type { SessionMessageInfo } from "@opencode/client";
import type { Plugin } from "@opencode/plugin/tui";
import type { PanelInput } from "@opencode/plugin/tui/context";
import type { ScrollBoxRenderable } from "@opentui/core";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import type { CacheHistoryPoint } from "./cache-history.js";
import {
  buildCacheHistory,
  exportCacheHistory,
  formatCacheHistoryTrend,
  groupCacheHistoryTurns,
} from "./cache-history.js";

const percent = (rate: number | undefined) =>
  rate === undefined ? "—" : `${(rate * 100).toFixed(1)}%`;
const count = (tokens: number) => tokens.toLocaleString();

/** Session panel showing chronological cache history for the current session and its subagents. */
export function CacheHistoryPanel(props: {
  panel: PanelInput;
  context: Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0];
}) {
  const { context } = props;
  const [family, setFamily] = createSignal(true);
  const [snapshots, setSnapshots] = createSignal<
    ReadonlyMap<string, readonly SessionMessageInfo[]>
  >(new Map());
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal(false);
  const [follow, setFollow] = createSignal(true);
  const [streamingSessions, setStreamingSessions] = createSignal<Set<string>>(
    new Set()
  );
  let scrollbox: ScrollBoxRenderable | undefined;
  const setScrollbox = (element: ScrollBoxRenderable) => {
    scrollbox = element;
  };
  let generation = 0;
  const debug = process.env.OPENCODE_CACHE_METRICS_DEBUG === "1";
  const trace = (message: string, details: Record<string, unknown>) => {
    if (debug) {
      try {
        appendFileSync(
          "/tmp/opencode/cache-metrics-history.log",
          `${JSON.stringify({ message, time: new Date().toISOString(), ...details })}\n`
        );
      } catch {
        // Diagnostics must not interfere with the panel when the log is unavailable.
      }
    }
  };

  const inScope = (sessionID: string) =>
    sessionID === props.panel.sessionID ||
    (family() &&
      context.data.session.root(sessionID) ===
        context.data.session.root(props.panel.sessionID));

  const updateStreamingSession = (sessionID: string, streaming: boolean) => {
    setStreamingSessions((current) => {
      const next = new Set(current);
      if (streaming) {
        next.add(sessionID);
      } else {
        next.delete(sessionID);
      }
      return next;
    });
  };
  const streamingInScope = () => [...streamingSessions()].some(inScope);
  const emptyHistoryMessage = () => {
    if (loading()) {
      return "Loading saved responses…";
    }
    if (streamingInScope()) {
      return "Waiting for token usage…";
    }
    return "No completed responses with token usage yet.";
  };

  const refresh = async (trigger = "initial") => {
    generation += 1;
    const current = generation;
    const { sessionID } = props.panel;
    const root = context.data.session.root(sessionID);
    const ids = family()
      ? [...new Set([root, ...context.data.session.family(root)])]
      : [sessionID];
    trace("refresh started", {
      ids,
      scope: family() ? "family" : "session",
      sessionID,
      trigger,
    });
    setSnapshots(
      new Map(
        ids.map((id) => [id, context.data.session.message.list(id) ?? []])
      )
    );
    setLoading(true);
    setError(false);
    try {
      await context.data.session.sync(sessionID);
      const refreshedRoot = context.data.session.root(sessionID);
      const refreshedIDs = family()
        ? [
            ...new Set([
              refreshedRoot,
              ...context.data.session.family(refreshedRoot),
            ]),
          ]
        : [sessionID];
      const entries = await Promise.all(
        refreshedIDs.map(async (id) => {
          context.data.session.message.invalidate(id);
          await context.data.session.message.sync(id);
          return [id, context.data.session.message.list(id) ?? []] as const;
        })
      );
      if (generation === current) {
        setSnapshots(new Map(entries));
        trace("refresh completed", {
          counts: entries.map(([id, messages]) => ({
            messages: messages.length,
            sessionID: id,
          })),
          sessionID,
          trigger,
        });
      }
    } catch (cause) {
      if (generation === current) {
        setError(true);
        trace("refresh failed", {
          error:
            cause instanceof Error
              ? `${cause.name}: ${cause.message}`
              : String(cause),
          sessionID,
          trigger,
        });
      }
    } finally {
      if (generation === current) {
        setLoading(false);
      }
    }
  };

  createEffect(() => {
    const { sessionID } = props.panel;
    family();
    setStreamingSessions(new Set<string>());
    if (sessionID) {
      refresh();
    }
  });
  createEffect(() => {
    turns();
    if (follow()) {
      scrollbox?.scrollTo(scrollbox.scrollHeight);
    }
  });
  const stopStepStarted = context.data.on("session.step.started", (event) => {
    trace("step started", {
      inScope: inScope(event.data.sessionID),
      sessionID: event.data.sessionID,
    });
    if (inScope(event.data.sessionID)) {
      updateStreamingSession(event.data.sessionID, true);
    }
  });
  const stopStepEnded = context.data.on("session.step.ended", (event) => {
    trace("step ended", {
      inScope: inScope(event.data.sessionID),
      sessionID: event.data.sessionID,
    });
    if (inScope(event.data.sessionID)) {
      updateStreamingSession(event.data.sessionID, false);
      refresh("step ended");
    }
  });
  const stopStepFailed = context.data.on("session.step.failed", (event) => {
    trace("step failed", {
      inScope: inScope(event.data.sessionID),
      sessionID: event.data.sessionID,
    });
    if (inScope(event.data.sessionID)) {
      updateStreamingSession(event.data.sessionID, false);
      refresh("step failed");
    }
  });
  const stopExecution = context.data.on(
    "session.execution.succeeded",
    (event) => {
      if (inScope(event.data.sessionID)) {
        trace("execution succeeded", { sessionID: event.data.sessionID });
        updateStreamingSession(event.data.sessionID, false);
        refresh("execution succeeded");
      }
    }
  );
  const stopExecutionFailed = context.data.on(
    "session.execution.failed",
    (event) => {
      if (inScope(event.data.sessionID)) {
        trace("execution failed", { sessionID: event.data.sessionID });
        updateStreamingSession(event.data.sessionID, false);
        refresh("execution failed");
      }
    }
  );
  const stopExecutionInterrupted = context.data.on(
    "session.execution.interrupted",
    (event) => {
      if (inScope(event.data.sessionID)) {
        trace("execution interrupted", { sessionID: event.data.sessionID });
        updateStreamingSession(event.data.sessionID, false);
        refresh("execution interrupted");
      }
    }
  );
  const stopCreated = context.data.on("session.created", (event) => {
    if (
      family() &&
      event.data.parentID &&
      context.data.session.root(event.data.parentID) ===
        context.data.session.root(props.panel.sessionID)
    ) {
      context.data.session
        .sync(event.data.sessionID)
        .then(() => refresh("session created"))
        .catch((cause: unknown) => {
          setError(true);
          trace("child session sync failed", {
            error:
              cause instanceof Error
                ? `${cause.name}: ${cause.message}`
                : String(cause),
            sessionID: event.data.sessionID,
          });
        });
    }
  });
  onCleanup(() => {
    generation += 1;
    stopStepStarted();
    stopStepEnded();
    stopStepFailed();
    stopExecution();
    stopExecutionFailed();
    stopExecutionInterrupted();
    stopCreated();
  });

  const history = createMemo(() => buildCacheHistory(snapshots()));
  const turns = createMemo(() => groupCacheHistoryTurns(history()));
  createEffect(() => {
    const points = history();
    const groups = turns();
    trace("view updated", {
      lastResponseID: points.at(-1)?.id,
      responses: points.length,
      sessionID: props.panel.sessionID,
      turns: groups.length,
    });
  });
  const rateColor = (point: CacheHistoryPoint) => {
    if (point.rate === undefined || point.rate < 0.3) {
      return context.theme.text.muted;
    }
    if (point.rate < 0.7) {
      return (
        context.theme.text.feedback?.warning?.base ??
        context.theme.hue.yellow[500]
      );
    }
    return (
      context.theme.text.feedback?.success?.base ?? context.theme.hue.green[500]
    );
  };

  context.keymap.layer(() => ({
    commands: [
      {
        bind: "s",
        enabled: () => props.panel.focused,
        id: "cache-metrics.history.scope",
        run: () => setFamily(!family()),
        title: "Toggle cache history session scope",
      },
      {
        bind: "t",
        enabled: () => props.panel.focused,
        id: "cache-metrics.history.follow",
        run: () => setFollow(!follow()),
        title: "Toggle cache history follow mode",
      },
      {
        bind: "r",
        enabled: () => props.panel.focused,
        id: "cache-metrics.history.refresh",
        run: () => {
          refresh("manual");
        },
        title: "Refresh cache history",
      },
      {
        bind: "e",
        enabled: () => props.panel.focused,
        id: "cache-metrics.history.export",
        run: () => {
          try {
            const json = exportCacheHistory(
              props.panel.sessionID,
              family() ? "family" : "session",
              history()
            );
            if (!context.renderer.copyToClipboardOSC52(json)) {
              throw new Error("Clipboard unavailable");
            }
            context.ui.toast.show({
              message: "Cache history JSON copied to clipboard",
              variant: "success",
            });
          } catch {
            context.ui.toast.show({
              message: "Could not copy cache history to clipboard",
              variant: "error",
            });
          }
        },
        title: "Copy cache history JSON",
      },
      {
        bind: "f",
        enabled: () => props.panel.focused,
        id: "cache-metrics.history.fullscreen",
        run: props.panel.toggleFullscreen,
      },
      {
        bind: "escape",
        enabled: () => props.panel.focused,
        id: "cache-metrics.history.close",
        run: props.panel.close,
      },
    ],
    mode: "global",
  }));

  return (
    <box
      flexDirection="column"
      gap={1}
      height="100%"
      paddingLeft={1}
      paddingRight={1}
      width="100%"
    >
      <text fg={context.theme.text.base}>
        <b>
          Cache history · {family() ? "Session + subagents" : "This session"}
        </b>
      </text>
      <text fg={context.theme.text.muted}>
        {turns().length} turns · {history().length} responses · cumulative{" "}
        {percent(history().at(-1)?.cumulativeRate)} · Follow{" "}
        {follow() ? "on" : "off"}
      </text>
      <Show when={history().length > 0}>
        <text fg={context.theme.text.muted}>
          Trend (oldest → newest): {formatCacheHistoryTrend(history())}
        </text>
      </Show>
      <Show when={error()}>
        <text
          fg={
            context.theme.text.feedback?.error?.base ??
            context.theme.hue.red[500]
          }
        >
          Could not refresh history. Press r to retry.
        </text>
      </Show>
      <scrollbox
        flexGrow={1}
        // biome-ignore lint/performance/noJsxPropsBind: Solid mounts this ref once for the panel's scrollbox.
        ref={setScrollbox}
        stickyScroll={follow()}
        stickyStart="bottom"
      >
        <For each={turns()}>
          {(turn, index) => (
            <box
              border
              borderColor={context.theme.hue.blue[500]}
              borderStyle="rounded"
              flexDirection="column"
              width="100%"
            >
              <box
                flexDirection="column"
                paddingLeft={1}
                paddingRight={1}
                width="100%"
              >
                <text fg={context.theme.text.base}>
                  <b>
                    Turn {index() + 1} ·{" "}
                    {turn.sessionID ===
                    context.data.session.root(props.panel.sessionID)
                      ? "Parent"
                      : "Subagent"}{" "}
                    · {turn.points.length}{" "}
                    {turn.points.length === 1 ? "response" : "responses"}
                  </b>
                </text>
                <text fg={context.theme.text.base} truncate wrapMode="none">
                  Request: {turn.prompt ?? "(No saved user request)"}
                </text>
                <text fg={context.theme.text.muted}>
                  Turn cache hit {percent(turn.rate)} · In {count(turn.read)}{" "}
                  cached / {count(turn.input)} new · Out {count(turn.output)}
                </text>
              </box>
              <box
                border={["top"]}
                borderColor={context.theme.border.base}
                height={1}
                width="100%"
              />
              <For each={turn.points}>
                {(point, responseIndex) => (
                  <box flexDirection="column" width="100%">
                    <Show when={responseIndex() > 0}>
                      <box
                        border={["top"]}
                        borderColor={context.theme.border.base}
                        height={1}
                        width="100%"
                      />
                    </Show>
                    <box
                      flexDirection="column"
                      paddingLeft={1}
                      paddingRight={1}
                      width="100%"
                    >
                      <box flexDirection="row" gap={1}>
                        <text fg={rateColor(point)}>
                          <b>
                            Response {responseIndex() + 1} ·{" "}
                            {percent(point.rate)}
                          </b>
                        </text>
                        <Show when={point.previousRead !== undefined}>
                          <text
                            fg={
                              context.theme.text.feedback?.warning?.base ??
                              context.theme.hue.yellow[500]
                            }
                          >
                            <b>
                              ⚠ Possible cache loss (
                              {count(point.previousRead ?? 0)} →{" "}
                              {count(point.read)} cached)
                            </b>
                          </text>
                        </Show>
                        <text
                          fg={context.theme.text.base}
                          truncate
                          wrapMode="none"
                        >
                          {new Date(point.time).toLocaleTimeString()} ·{" "}
                          {point.providerID}/{point.modelID}
                        </text>
                      </box>
                      <text
                        fg={context.theme.text.muted}
                        truncate
                        wrapMode="none"
                      >
                        {point.sessionID ===
                        context.data.session.root(props.panel.sessionID)
                          ? "Parent"
                          : `Subagent (${point.agent})`}{" "}
                        · In {count(point.read)} cached / {count(point.input)}{" "}
                        new · Out {count(point.output)}
                      </text>
                      <Show when={point.afterTools.length > 0}>
                        <text
                          fg={context.theme.text.muted}
                          truncate
                          wrapMode="none"
                        >
                          After tools: {point.afterTools.join(", ")}
                        </text>
                      </Show>
                      <Show when={point.afterCompaction}>
                        <text fg={context.theme.text.muted}>
                          After {point.afterCompaction} compaction
                        </text>
                      </Show>
                      <Show when={point.tools.length > 0}>
                        <text
                          fg={context.theme.text.muted}
                          truncate
                          wrapMode="none"
                        >
                          Called tools: {point.tools.join(", ")}
                        </text>
                      </Show>
                      <text fg={context.theme.text.muted}>
                        Finish: {point.finish ?? "unknown"}
                        {point.retryAttempt
                          ? ` · retry ${point.retryAttempt}`
                          : ""}
                      </text>
                      <text fg={context.theme.text.muted}>
                        Cache writes {count(point.write)} · cumulative{" "}
                        {percent(point.cumulativeRate)}
                      </text>
                    </box>
                  </box>
                )}
              </For>
            </box>
          )}
        </For>
        <Show when={streamingInScope()}>
          <text fg={context.theme.text.muted}>
            Response streaming… cache metrics appear when the response
            completes.
          </text>
        </Show>
        <Show when={history().length === 0}>
          <text fg={context.theme.text.muted}>{emptyHistoryMessage()}</text>
        </Show>
      </scrollbox>
      <text fg={context.theme.text.muted}>
        s Scope · t Follow · r Refresh · e Export JSON · f Fullscreen · Esc
        Close
      </text>
    </box>
  );
}
