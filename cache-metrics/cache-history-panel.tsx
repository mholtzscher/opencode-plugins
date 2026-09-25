/** @jsxImportSource @opentui/solid */

import type { SessionMessageInfo } from "@opencode/client";
import type { Plugin } from "@opencode/plugin/tui";
import type { PanelInput } from "@opencode/plugin/tui/context";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import type { CacheHistoryPoint } from "./cache-history.js";
import { buildCacheHistory, formatCacheHistoryTrend } from "./cache-history.js";

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
  let generation = 0;

  const refresh = async () => {
    generation += 1;
    const current = generation;
    const { sessionID } = props.panel;
    setLoading(true);
    setError(false);
    try {
      await context.data.session.sync(sessionID);
      const root = context.data.session.root(sessionID);
      const ids = family()
        ? [...new Set([root, ...context.data.session.family(root)])]
        : [sessionID];
      const entries = await Promise.all(
        ids.map(async (id) => {
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

  createEffect(() => {
    const { sessionID } = props.panel;
    family();
    if (sessionID) {
      refresh();
    }
  });
  const stopExecution = context.data.on(
    "session.execution.succeeded",
    (event) => {
      if (
        event.data.sessionID === props.panel.sessionID ||
        (family() &&
          context.data.session.root(event.data.sessionID) ===
            context.data.session.root(props.panel.sessionID))
      ) {
        refresh();
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
        .then(refresh)
        .catch(() => setError(true));
    }
  });
  onCleanup(() => {
    generation += 1;
    stopExecution();
    stopCreated();
  });

  const history = createMemo(() => buildCacheHistory(snapshots()));
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
        id: "cache-metrics.history.scope",
        run: () => setFamily(!family()),
        title: "Toggle cache history session scope",
      },
      {
        bind: "r",
        id: "cache-metrics.history.refresh",
        run: () => {
          refresh();
        },
        title: "Refresh cache history",
      },
      {
        bind: "f",
        id: "cache-metrics.history.fullscreen",
        run: props.panel.toggleFullscreen,
      },
      {
        bind: "escape",
        id: "cache-metrics.history.close",
        run: props.panel.close,
      },
    ],
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
        Per response cache hit · {history().length} responses · cumulative{" "}
        {percent(history().at(-1)?.cumulativeRate)}
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
      <scrollbox flexGrow={1}>
        <For each={history()}>
          {(point) => (
            <box
              border
              borderColor={context.theme.border.base}
              flexDirection="column"
              paddingLeft={1}
              paddingRight={1}
              width="100%"
            >
              <box flexDirection="row" gap={1}>
                <text fg={rateColor(point)}>
                  <b>{percent(point.rate)}</b>
                </text>
                <text fg={context.theme.text.base} truncate wrapMode="none">
                  {new Date(point.time).toLocaleTimeString()} ·{" "}
                  {point.providerID}/{point.modelID}
                </text>
              </box>
              <text fg={context.theme.text.muted} truncate wrapMode="none">
                {point.sessionID ===
                context.data.session.root(props.panel.sessionID)
                  ? "Parent"
                  : `Subagent (${point.agent})`}{" "}
                · In {count(point.read)} cached / {count(point.input)} new · Out{" "}
                {count(point.output)}
              </text>
              <Show when={point.prompt}>
                <text fg={context.theme.text.base} truncate wrapMode="none">
                  Request: {point.prompt}
                </text>
              </Show>
              <Show when={point.afterTools.length > 0}>
                <text fg={context.theme.text.muted} truncate wrapMode="none">
                  After tools: {point.afterTools.join(", ")}
                </text>
              </Show>
              <Show when={point.afterCompaction}>
                <text fg={context.theme.text.muted}>
                  After {point.afterCompaction} compaction
                </text>
              </Show>
              <Show when={point.tools.length > 0}>
                <text fg={context.theme.text.muted} truncate wrapMode="none">
                  Called tools: {point.tools.join(", ")}
                </text>
              </Show>
              <text fg={context.theme.text.muted}>
                Finish: {point.finish ?? "unknown"}
                {point.retryAttempt ? ` · retry ${point.retryAttempt}` : ""}
              </text>
              <text fg={context.theme.text.muted}>
                Cache writes {count(point.write)} · cumulative{" "}
                {percent(point.cumulativeRate)}
              </text>
            </box>
          )}
        </For>
        <Show when={history().length === 0}>
          <text fg={context.theme.text.muted}>
            {loading()
              ? "Loading saved responses…"
              : "No completed responses with token usage yet."}
          </text>
        </Show>
      </scrollbox>
      <text fg={context.theme.text.muted}>
        s Scope · r Refresh · f Fullscreen · Esc Close
      </text>
    </box>
  );
}
