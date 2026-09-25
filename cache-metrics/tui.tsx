/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { CacheHistoryPanel } from "./cache-history-panel.js";
import { calculateSessionCacheRate } from "./cache-rate.js";

export default Plugin.define({
  id: "cache-metrics.tui",
  setup(context) {
    const openCacheHistory = () => {
      if (!context.ui.panel.open("cache-metrics.history")) {
        context.ui.toast.show({
          message: "Open a session to view cache history",
          variant: "info",
        });
      }
    };
    const CacheMetrics = (props: { sessionID: string }) => {
      const [messages, setMessages] = createSignal(
        context.data.session.message.list(props.sessionID) ?? []
      );
      const refresh = (sessionID: string) => {
        context.data.session.message.invalidate(sessionID);
        context.data.session.message
          .sync(sessionID)
          .then(() => {
            if (props.sessionID === sessionID) {
              setMessages(context.data.session.message.list(sessionID) ?? []);
            }
          })
          .catch(() => {
            // Retain the last known cache totals when synchronization fails.
          });
      };
      createEffect(() => {
        const { sessionID } = props;
        setMessages(context.data.session.message.list(sessionID) ?? []);
        refresh(sessionID);
      });
      const stop = context.data.on("session.execution.succeeded", (event) => {
        if (event.data.sessionID === props.sessionID) {
          refresh(props.sessionID);
        }
      });
      onCleanup(stop);
      const totals = () => calculateSessionCacheRate(messages());
      const rateColor = () => {
        const rate = totals().rate ?? 0;
        if (rate >= 0.7) {
          return (
            context.theme.text.feedback?.success?.base ??
            context.theme.hue.green[500]
          );
        }
        if (rate >= 0.3) {
          return (
            context.theme.text.feedback?.warning?.base ??
            context.theme.hue.yellow[500]
          );
        }
        return context.theme.text.muted;
      };
      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI boxes handle mouse events without DOM roles.
        <box
          border
          borderColor={context.theme.border.base}
          borderStyle="rounded"
          flexDirection="column"
          onMouseDown={openCacheHistory}
          paddingLeft={1}
          paddingRight={1}
          title="Cache"
          titleColor={context.theme.text.base}
          width="100%"
        >
          <Show
            fallback={
              <text fg={context.theme.text.muted}>No token usage yet</text>
            }
            when={totals().rate !== undefined}
          >
            <text fg={rateColor()}>
              <b>{((totals().rate ?? 0) * 100).toFixed(1)}% input cache hit</b>
            </text>
            <box flexDirection="row" gap={1}>
              <text fg={context.theme.text.base}>
                <b>In:</b>
              </text>
              <text fg={context.theme.text.muted}>
                {totals().read.toLocaleString()} cached
              </text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={context.theme.text.base}>
                <b>New:</b>
              </text>
              <text fg={context.theme.text.muted}>
                {totals().input.toLocaleString()}
              </text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={context.theme.text.base}>
                <b>Out:</b>
              </text>
              <text fg={context.theme.text.muted}>
                {totals().output.toLocaleString()} generated
              </text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={context.theme.text.base}>
                <b>Cache writes:</b>
              </text>
              <text fg={context.theme.text.muted}>
                {totals().write.toLocaleString()}
              </text>
            </box>
          </Show>
          <text fg={context.theme.text.muted}>Click for history →</text>
        </box>
      );
    };

    const removeSidebar = context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => <CacheMetrics sessionID={sessionID} />,
    });
    const removePanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === "cache-metrics.history"}>
          <CacheHistoryPanel panel={panel} />
        </Show>
      ),
    });
    const removeCommand = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          commands: [
            {
              group: "Cache",
              id: "cache-metrics.history.open",
              palette: true,
              run: openCacheHistory,
              slash: { name: "cache-history" },
              title: "Open cache history",
            },
          ],
          mode: "global",
        }));
        return null;
      },
    });
    return () => {
      removeCommand();
      removePanel();
      removeSidebar();
    };
  },
});
