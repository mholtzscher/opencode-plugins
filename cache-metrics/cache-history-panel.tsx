/** @jsxImportSource @opentui/solid */
import { usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { buildCacheHistory, formatCacheHistoryTrend } from "./cache-history.js"
import type { CacheHistoryPoint } from "./cache-history.js"
import type { SessionMessageInfo } from "@opencode/client"

const percent = (rate: number | undefined) => rate === undefined ? "—" : `${(rate * 100).toFixed(1)}%`
const count = (tokens: number) => tokens.toLocaleString()

/** Session panel showing chronological cache history for the current session and its subagents. */
export function CacheHistoryPanel(props: { panel: PanelInput }) {
  const context = usePlugin()
  const [family, setFamily] = createSignal(true)
  const [snapshots, setSnapshots] = createSignal<ReadonlyMap<string, readonly SessionMessageInfo[]>>(new Map())
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal(false)
  let generation = 0

  const refresh = async () => {
    const current = ++generation
    const sessionID = props.panel.sessionID
    setLoading(true)
    setError(false)
    try {
      await context.data.session.sync(sessionID)
      const root = context.data.session.root(sessionID)
      const ids = family() ? [...new Set([root, ...context.data.session.family(root)])] : [sessionID]
      const entries = await Promise.all(ids.map(async (id) => {
        context.data.session.message.invalidate(id)
        await context.data.session.message.sync(id)
        return [id, context.data.session.message.list(id) ?? []] as const
      }))
      if (generation === current) setSnapshots(new Map(entries))
    } catch {
      if (generation === current) setError(true)
    } finally {
      if (generation === current) setLoading(false)
    }
  }

  createEffect(() => {
    props.panel.sessionID
    family()
    void refresh()
  })
  const stopExecution = context.data.on("session.execution.succeeded", (event) => {
    if (event.data.sessionID === props.panel.sessionID ||
      (family() && context.data.session.root(event.data.sessionID) === context.data.session.root(props.panel.sessionID))) {
      void refresh()
    }
  })
  const stopCreated = context.data.on("session.created", (event) => {
    if (family() && event.data.parentID &&
      context.data.session.root(event.data.parentID) === context.data.session.root(props.panel.sessionID)) {
      void context.data.session.sync(event.data.sessionID).then(refresh).catch(() => setError(true))
    }
  })
  onCleanup(() => {
    generation++
    stopExecution()
    stopCreated()
  })

  const history = createMemo(() => buildCacheHistory(snapshots()))
  const rateColor = (point: CacheHistoryPoint) => {
    if (point.rate === undefined || point.rate < 0.3) return context.theme.text.muted
    if (point.rate < 0.7) return context.theme.text.feedback?.warning?.base ?? context.theme.hue.yellow[500]
    return context.theme.text.feedback?.success?.base ?? context.theme.hue.green[500]
  }

  context.keymap.layer(() => ({
    commands: [
      { id: "cache-metrics.history.scope", title: "Toggle cache history session scope", bind: "s", run: () => setFamily(!family()) },
      { id: "cache-metrics.history.refresh", title: "Refresh cache history", bind: "r", run: () => { void refresh() } },
      { id: "cache-metrics.history.fullscreen", bind: "f", run: props.panel.toggleFullscreen },
      { id: "cache-metrics.history.close", bind: "escape", run: props.panel.close },
    ],
  }))

  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingRight={1} gap={1}>
      <text fg={context.theme.text.base}><b>Cache history · {family() ? "Session + subagents" : "This session"}</b></text>
      <text fg={context.theme.text.muted}>Per response cache hit · {history().length} responses · cumulative {percent(history().at(-1)?.cumulativeRate)}</text>
      <Show when={history().length > 0}><text fg={context.theme.text.muted}>Trend (oldest → newest): {formatCacheHistoryTrend(history())}</text></Show>
      <Show when={error()}><text fg={context.theme.text.feedback?.error?.base ?? context.theme.hue.red[500]}>Could not refresh history. Press r to retry.</text></Show>
      <scrollbox flexGrow={1}>
        <For each={history()}>{(point) =>
          <box width="100%" flexDirection="column" border borderColor={context.theme.border.base} paddingLeft={1} paddingRight={1}>
            <box flexDirection="row" gap={1}>
              <text fg={rateColor(point)}><b>{percent(point.rate)}</b></text>
              <text fg={context.theme.text.base} wrapMode="none" truncate>{new Date(point.time).toLocaleTimeString()} · {point.providerID}/{point.modelID}</text>
            </box>
            <text fg={context.theme.text.muted} wrapMode="none" truncate>{point.sessionID === context.data.session.root(props.panel.sessionID) ? "Parent" : `Subagent (${point.agent})`} · In {count(point.read)} cached / {count(point.input)} new · Out {count(point.output)}</text>
            <Show when={point.prompt}><text fg={context.theme.text.base} wrapMode="none" truncate>Request: {point.prompt}</text></Show>
            <Show when={point.afterTools.length > 0}><text fg={context.theme.text.muted} wrapMode="none" truncate>After tools: {point.afterTools.join(", ")}</text></Show>
            <Show when={point.afterCompaction}><text fg={context.theme.text.muted}>After {point.afterCompaction} compaction</text></Show>
            <Show when={point.tools.length > 0}><text fg={context.theme.text.muted} wrapMode="none" truncate>Called tools: {point.tools.join(", ")}</text></Show>
            <text fg={context.theme.text.muted}>Finish: {point.finish ?? "unknown"}{point.retryAttempt ? ` · retry ${point.retryAttempt}` : ""}</text>
            <text fg={context.theme.text.muted}>Cache writes {count(point.write)} · cumulative {percent(point.cumulativeRate)}</text>
          </box>
        }</For>
        <Show when={history().length === 0}>
          <text fg={context.theme.text.muted}>{loading() ? "Loading saved responses…" : "No completed responses with token usage yet."}</text>
        </Show>
      </scrollbox>
      <text fg={context.theme.text.muted}>s Scope  ·  r Refresh  ·  f Fullscreen  ·  Esc Close</text>
    </box>
  )
}
