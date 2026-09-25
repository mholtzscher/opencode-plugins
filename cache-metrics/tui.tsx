/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { calculateSessionCacheRate } from "./cache-rate.js"

export default Plugin.define({
  id: "cache-metrics.tui",
  setup(context) {
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
          paddingLeft={1} paddingRight={1}>
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
        </box>
      )
    }

    return context.ui.slot({ append: "sidebar.content", render: ({ sessionID }) => <CacheMetrics sessionID={sessionID} /> })
  },
})
