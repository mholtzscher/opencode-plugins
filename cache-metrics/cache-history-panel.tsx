/** @jsxImportSource @opentui/solid */

import type { SessionMessageInfo } from "@opencode/client";
import type { Context, PanelInput } from "@opencode/plugin/tui/context";
import type { ScrollBoxRenderable } from "@opentui/core";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
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
  context: Context;
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

  const sessionIDs = (sessionID: string, includeFamily: boolean) => {
    if (!includeFamily) {
      return [sessionID];
    }
    const root = context.data.session.root(sessionID);
    return [...new Set([root, ...context.data.session.family(root)])];
  };

  const refresh = async () => {
    generation += 1;
    const current = generation;
    const { sessionID } = props.panel;
    const includeFamily = family();
    setSnapshots(
      new Map(
        sessionIDs(sessionID, includeFamily).map((id) => [
          id,
          context.data.session.message.list(id) ?? [],
        ])
      )
    );
    setLoading(true);
    setError(false);
    try {
      await context.data.session.sync(sessionID);
      const entries = await Promise.all(
        sessionIDs(sessionID, includeFamily).map(async (id) => {
          context.data.session.message.invalidate(id);
          await context.data.session.message.sync(id);
          return [id, context.data.session.message.list(id) ?? []] as const;
        })
      );
      if (generation === current) {
        setSnapshots(new Map(entries));
      }
    } catch {
      if (generation === current) {
        setError(true);
      }
    } finally {
      if (generation === current) {
        setLoading(false);
      }
    }
  };

  createEffect(
    on([() => props.panel.sessionID, family], ([sessionID]) => {
      setStreamingSessions(new Set<string>());
      if (sessionID) {
        refresh();
      }
    })
  );
  onCleanup(
    context.data.on("session.step.started", (event) => {
      if (inScope(event.data.sessionID)) {
        updateStreamingSession(event.data.sessionID, true);
      }
    })
  );
  for (const type of [
    "session.step.ended",
    "session.step.failed",
    "session.execution.succeeded",
    "session.execution.failed",
    "session.execution.interrupted",
  ] as const) {
    onCleanup(
      context.data.on(type, (event) => {
        if (inScope(event.data.sessionID)) {
          updateStreamingSession(event.data.sessionID, false);
          refresh();
        }
      })
    );
  }
  onCleanup(
    context.data.on("session.created", (event) => {
      if (
        family() &&
        event.data.parentID &&
        context.data.session.root(event.data.parentID) ===
          context.data.session.root(props.panel.sessionID)
      ) {
        const current = generation;
        context.data.session
          .sync(event.data.sessionID)
          .then(() => {
            if (generation === current) {
              return refresh();
            }
          })
          .catch(() => {
            if (generation === current) {
              setError(true);
            }
          });
      }
    })
  );
  onCleanup(() => {
    generation += 1;
  });

  const history = createMemo(() => buildCacheHistory(snapshots()));
  const turns = createMemo(() => groupCacheHistoryTurns(history()));
  createEffect(() => {
    turns();
    if (!follow()) {
      return;
    }
    // Scroll after OpenTUI has laid out the newly inserted rows.
    const timer = setTimeout(() => {
      if (follow()) {
        scrollbox?.scrollTo(scrollbox.scrollHeight);
      }
    }, 0);
    onCleanup(() => clearTimeout(timer));
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
        run: refresh,
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
