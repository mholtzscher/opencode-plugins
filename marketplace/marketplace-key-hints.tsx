/** @jsxImportSource @opentui/solid */
import { usePlugin } from "@opencode/plugin/tui"
import { For } from "solid-js"

/** Compact key hints with bold keys and muted descriptions. */
export const MarketplaceKeyHints = (props: { hints: readonly { keys: string; label: string }[] }) => {
  const context = usePlugin()
  return (
    <box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <For each={props.hints}>{(hint) =>
        <box flexDirection="row" gap={1}>
          <text fg={context.theme.text.base}><b>{hint.keys}</b></text>
          <text fg={context.theme.text.muted}>{hint.label}</text>
        </box>
      }</For>
    </box>
  )
}
