/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { calculateSessionCacheRate } from "./cache-rate.js"
import { CacheHistoryPanel } from "./cache-history-panel.js"

export default Plugin.define({
  id: "cache-metrics.tui",
  setup(context) {
    const openCacheHistory = () => {
      if (!context.ui.panel.open("cache-metrics.history")) {
        context.ui.toast.show({ message: "Open a session to view cache history", variant: "info" })
      }
    }
    const CacheMetrics = (props: { sessionID: string }) => {
      const [messages, setMessages] = createSignal(context.data.session.message.list(props.sessionID) ?? [])
      const refresh = (sessionID: string) => {
        context.data.session.message.invalidate(sessionID)
        void context.data.session.message.sync(sessionID).then(() => {
          if (props.sessionID === sessionID) setMessages(context.data.session.message.list(sessionID) ?? [])
        }).catch(() => {})
      }
      createEffect(() => {
        const sessionID = props.sessionID
        setMessages(context.data.session.message.list(sessionID) ?? [])
        refresh(sessionID)
      })
      const stop = context.data.on("session.execution.succeeded", (event) => {
        if (event.data.sessionID === props.sessionID) refresh(props.sessionID)
      })
      onCleanup(stop)
      const totals = () => calculateSessionCacheRate(messages())
      const rateColor = () => {
        const rate = totals().rate ?? 0
        if (rate >= 0.7) return context.theme.text.feedback?.success?.base ?? context.theme.hue.green[500]
        if (rate >= 0.3) return context.theme.text.feedback?.warning?.base ?? context.theme.hue.yellow[500]
        return context.theme.text.muted
      }
      return (
        <box width="100%" flexDirection="column" border borderStyle="rounded"
          borderColor={context.theme.border.base} title="Cache" titleColor={context.theme.text.base}
          paddingLeft={1} paddingRight={1} onMouseDown={openCacheHistory}>
          <Show when={totals().rate !== undefined} fallback={<text fg={context.theme.text.muted}>No token usage yet</text>}>
            <text fg={rateColor()}><b>{((totals().rate ?? 0) * 100).toFixed(1)}% input cache hit</b></text>
            <box flexDirection="row" gap={1}>
              <text fg={context.theme.text.base}><b>In:</b></text>
              <text fg={context.theme.text.muted}>{totals().read.toLocaleString()} cached · {totals().input.toLocaleString()} new</text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={context.theme.text.base}><b>Out:</b></text>
              <text fg={context.theme.text.muted}>{totals().output.toLocaleString()} generated</text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={context.theme.text.base}><b>Cache writes:</b></text>
              <text fg={context.theme.text.muted}>{totals().write.toLocaleString()}</text>
            </box>
          </Show>
          <text fg={context.theme.text.muted}>Click for history →</text>
        </box>
      )
    }

    const removeSidebar = context.ui.slot({ append: "sidebar.content", render: ({ sessionID }) => <CacheMetrics sessionID={sessionID} /> })
    const removePanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => <Show when={panel.name === "cache-metrics.history"}><CacheHistoryPanel panel={panel} /></Show>,
    })
    const removeCommand = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "cache-metrics.history.open",
            title: "Open cache history",
            group: "Cache",
            palette: true,
            slash: { name: "cache-history" },
            run: openCacheHistory,
          }],
        }))
        return null
      },
    })
    return () => {
      removeCommand()
      removePanel()
      removeSidebar()
    }
  },
})
