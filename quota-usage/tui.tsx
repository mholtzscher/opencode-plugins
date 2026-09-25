/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { createSignal, For, Show } from "solid-js";
import type { QuotaProvider, QuotaWindow } from "./rpc.js";
import { CodexUsage, OpenCodeGoUsage } from "./rpc.js";

const fallbackProvider = (
  provider: QuotaProvider["provider"],
  name: string
): QuotaProvider => ({
  fetchedAt: Date.now(),
  message: "Usage unavailable",
  name,
  provider,
  status: "unavailable",
  windows: [],
});

const formatCountdown = (
  resetAt: number | undefined,
  now: number
): string | undefined => {
  if (resetAt === undefined) {
    return undefined;
  }
  const minutes = Math.max(0, Math.floor((resetAt * 1000 - now) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) {
    return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
};

export default Plugin.define({
  id: "quota-usage.tui",
  setup(context) {
    const location = context.location ?? context.data.location.default();
    const codex = context.client.rpc(CodexUsage);
    const openCodeGo = context.client.rpc(OpenCodeGoUsage);
    const [providers, setProviders] = createSignal<QuotaProvider[]>([]);
    const [now, setNow] = createSignal(Date.now());
    let refreshing = false;

    const tone = (remaining: number) => {
      if (remaining <= 10) {
        return (
          context.theme.text.feedback?.error?.base ?? context.theme.hue.red[500]
        );
      }
      if (remaining <= 30) {
        return (
          context.theme.text.feedback?.warning?.base ??
          context.theme.hue.yellow[500]
        );
      }
      return (
        context.theme.text.feedback?.success?.base ??
        context.theme.hue.green[500]
      );
    };

    const QuotaCard = (props: { window: QuotaWindow }) => {
      const reset = () => formatCountdown(props.window.resetAt, now());
      return (
        <box
          border
          borderColor={context.theme.border.base}
          flexDirection="column"
          flexGrow={1}
          paddingLeft={1}
          paddingRight={1}
          width="30%"
        >
          <text fg={context.theme.text.muted} truncate wrapMode="none">
            {props.window.label.toUpperCase()}
          </text>
          <text fg={tone(props.window.remainingPercent)}>
            <b>
              {props.window.display ??
                `${props.window.remainingPercent.toFixed(0)}%`}
            </b>
          </text>
          <Show when={reset()}>
            {(value) => (
              <text fg={context.theme.text.muted} truncate wrapMode="none">
                {value()}
              </text>
            )}
          </Show>
        </box>
      );
    };

    const ProviderQuota = (props: { provider: QuotaProvider }) => {
      const singleWindow = () => props.provider.windows.length === 1;
      const primaryWindow = () => props.provider.windows[0];
      const primaryReset = () =>
        formatCountdown(primaryWindow()?.resetAt, now());
      return (
        <box flexDirection="column" gap={1} width="100%">
          <Show
            fallback={
              <box flexDirection="column" width="100%">
                <text fg={context.theme.text.base}>
                  <b>{props.provider.name}</b>
                </text>
                <text fg={context.theme.text.muted}>
                  {props.provider.message ?? "Usage unavailable"}
                </text>
              </box>
            }
            when={
              props.provider.status === "ok" &&
              props.provider.windows.length > 0
            }
          >
            <Show
              fallback={
                <box flexDirection="column" width="100%">
                  <text fg={context.theme.text.base}>
                    <b>{props.provider.name}</b>
                  </text>
                  <box flexDirection="row" gap={1} width="100%">
                    <For each={props.provider.windows}>
                      {(window) => <QuotaCard window={window} />}
                    </For>
                  </box>
                </box>
              }
              when={singleWindow() && primaryWindow()}
            >
              <box
                flexDirection="row"
                justifyContent="space-between"
                width="100%"
              >
                <text fg={context.theme.text.base}>
                  <b>{props.provider.name}</b>
                </text>
                <box flexDirection="row" gap={1}>
                  <text fg={tone(primaryWindow()?.remainingPercent ?? 0)}>
                    <b>
                      {primaryWindow()?.display ??
                        `${(primaryWindow()?.remainingPercent ?? 0).toFixed(0)}%`}
                    </b>
                  </text>
                  <Show when={primaryReset()}>
                    {(value) => (
                      <text fg={context.theme.text.muted}>· {value()}</text>
                    )}
                  </Show>
                </box>
              </box>
            </Show>
          </Show>
        </box>
      );
    };

    const refresh = async () => {
      if (refreshing) {
        return;
      }
      refreshing = true;
      try {
        await context.data.location.provider.sync(location);
        const configured = new Set(
          (context.data.location.provider.list(location) ?? []).map(
            (provider) => provider.id
          )
        );
        const requests: Promise<QuotaProvider>[] = [];
        if (configured.has("openai")) {
          requests.push(
            codex.get({}).then(
              (value) => value as QuotaProvider,
              () => fallbackProvider("codex", "Codex")
            )
          );
        }
        if (configured.has("opencode-go")) {
          requests.push(
            openCodeGo.get({}).then(
              (value) => value as QuotaProvider,
              () => fallbackProvider("opencode-go", "OpenCode Go")
            )
          );
        }
        setProviders(await Promise.all(requests));
      } catch {
        // Keep the last successful snapshot when provider synchronization fails.
      } finally {
        refreshing = false;
      }
    };

    const stopEvents = context.data.listen(({ details }) => {
      if (details.type === "session.execution.succeeded") {
        refresh();
      }
    });
    const refreshTimer = setInterval(refresh, 60_000);
    const countdownTimer = setInterval(() => setNow(Date.now()), 60_000);
    const removeQuotaPanel = context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <Show when={providers().length > 0}>
          <box
            border
            borderColor={context.theme.border.base}
            borderStyle="rounded"
            flexDirection="column"
            gap={1}
            paddingLeft={1}
            paddingRight={1}
            title="Quotas"
            titleColor={context.theme.text.base}
            width="100%"
          >
            <For each={providers()}>
              {(provider) => <ProviderQuota provider={provider} />}
            </For>
          </box>
        </Show>
      ),
    });

    refresh();
    return () => {
      clearInterval(refreshTimer);
      clearInterval(countdownTimer);
      stopEvents();
      removeQuotaPanel();
    };
  },
});
