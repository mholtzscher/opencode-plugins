/** @jsxImportSource @opentui/solid */
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import type { MouseEvent } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import open from "open";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";

import { activate, daemonChoices, matchingChoice } from "./actions.js";
import { createMonitor } from "./monitor.js";
import type { SidebarState } from "./monitor.js";
import { DiscoveryResultSchema, MiseDaemons } from "./rpc.js";
import type { DaemonAction, RunningDaemon } from "./rpc.js";

const createActions =
  (context: ReturnType<typeof usePlugin>) => (action: DaemonAction) =>
    activate(action, {
      copy: (value) => context.renderer.copyToClipboardOSC52(value),
      notify: (message, variant) => context.ui.toast.show({ message, variant }),
      open: async (url) => {
        await open(url);
      },
    });

const Frame = (props: { children: JSX.Element; title?: string }) => {
  const context = usePlugin();
  return (
    <box
      border
      borderColor={context.theme.border.base}
      borderStyle="rounded"
      flexDirection="column"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      title={props.title ?? "Mise daemons"}
      titleColor={context.theme.text.base}
      width="100%"
    >
      {props.children}
    </box>
  );
};

const DaemonRow = (props: { daemon: RunningDaemon; stale: boolean }) => {
  const context = usePlugin();
  const run = createActions(context);
  const [hovered, setHovered] = createSignal(false);
  const choices = createMemo(() => daemonChoices(props.daemon.action));
  const handleClick = (action: DaemonAction, event: MouseEvent) => {
    if (
      event.button !== 0 ||
      props.stale ||
      context.renderer.getSelection()?.getSelectedText()
    ) {
      return;
    }
    event.stopPropagation();
    void run(action);
  };
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1} justifyContent="space-between">
        <text
          fg={context.theme.text.base}
          flexShrink={1}
          truncate
          wrapMode="none"
        >
          <b>{props.daemon.name}</b>
        </text>
        <text fg={context.theme.text.muted} flexShrink={0}>
          {props.stale ? "stale" : "running"}
        </text>
      </box>
      <box
        flexDirection="row"
        gap={1}
        justifyContent="space-between"
        onMouseOut={() => setHovered(false)}
        onMouseOver={() => setHovered(true)}
      >
        <text
          fg={context.theme.text.muted}
          flexGrow={1}
          flexShrink={1}
          onMouseUp={(event) => handleClick(props.daemon.action, event)}
          truncate
          wrapMode="none"
        >
          {props.daemon.action.value}
        </text>
        <For each={choices()}>
          {(choice) => (
            <text
              fg={
                props.stale ? context.theme.text.muted : context.theme.text.base
              }
              flexShrink={0}
              onMouseUp={(event) => handleClick(choice.action, event)}
              selectable={false}
            >
              <Show when={hovered() && !props.stale} fallback={choice.label}>
                <u>{choice.label}</u>
              </Show>
            </text>
          )}
        </For>
      </box>
    </box>
  );
};

type RegisterRefresh = (
  directory: string,
  refresh: () => Promise<void>
) => () => void;

const WorkspaceDaemons = (props: {
  directory: string;
  registerRefresh: RegisterRefresh;
}) => {
  const context = usePlugin();
  const rpc = context.client.rpc(MiseDaemons);
  const [state, setState] = createSignal<SidebarState>({ status: "loading" });
  const monitor = createMonitor(
    props.directory,
    async (signal) =>
      DiscoveryResultSchema.parse(
        await rpc.list(
          {},
          {
            location: { directory: props.directory },
            signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
          }
        )
      ),
    setState
  );
  const daemons = createMemo(() => {
    const value = state();
    return value.status === "loading" ? [] : (value.snapshot?.daemons ?? []);
  });
  const message = createMemo(() => {
    const value = state();
    if (value.status === "loading") {
      return "Loading daemons…";
    }
    if (value.status === "error") {
      return value.message;
    }
    return value.snapshot.daemons.length === 0
      ? "No running daemons"
      : undefined;
  });
  const title = () => {
    if (state().status === "error" && daemons().length > 0) {
      return "Mise daemons · Stale";
    }
    return daemons().length > 0
      ? `Mise daemons · ${daemons().length}`
      : "Mise daemons";
  };
  const timer = setInterval(() => {
    void monitor.refresh();
  }, 5000);
  const unregister = props.registerRefresh(props.directory, monitor.refresh);
  void monitor.refresh();
  onCleanup(() => {
    clearInterval(timer);
    monitor.dispose();
    unregister();
  });
  return (
    <Frame title={title()}>
      <Show when={message()}>
        {(value) => <text fg={context.theme.text.muted}>{value()}</text>}
      </Show>
      <For each={daemons()}>
        {(daemon) => (
          <DaemonRow daemon={daemon} stale={state().status === "error"} />
        )}
      </For>
      <box flexDirection="row" justifyContent="flex-end">
        <text
          fg={context.theme.text.base}
          onMouseUp={(event) => {
            if (event.button === 0) {
              void monitor.refresh();
            }
          }}
        >
          <u>Refresh</u>
        </text>
      </box>
    </Frame>
  );
};

const DaemonSidebar = (props: {
  sessionID: string;
  registerRefresh: RegisterRefresh;
}) => {
  const context = usePlugin();
  const directory = createMemo(
    () => context.data.session.get(props.sessionID)?.location.directory
  );
  return (
    <Show
      fallback={
        <Frame>
          <text fg={context.theme.text.muted}>Loading workspace…</text>
        </Frame>
      }
      keyed
      when={directory()}
    >
      {(value) => (
        <WorkspaceDaemons
          directory={value}
          registerRefresh={props.registerRefresh}
        />
      )}
    </Show>
  );
};

export default Plugin.define({
  id: "mise-daemons",
  setup(context) {
    const rpc = context.client.rpc(MiseDaemons);
    const requests = new Map<AbortController, string>();
    const refreshers = new Map<string, Set<() => Promise<void>>>();
    const registerRefresh: RegisterRefresh = (directory, refresh) => {
      const entries = refreshers.get(directory) ?? new Set();
      entries.add(refresh);
      refreshers.set(directory, entries);
      return () => {
        entries.delete(refresh);
        if (entries.size === 0) {
          refreshers.delete(directory);
        }
      };
    };
    const currentDirectory = () => {
      const route = context.ui.router.current();
      return route.type === "session"
        ? context.data.session.get(route.sessionID)?.location.directory
        : undefined;
    };
    const lookup = async (directory: string) => {
      const controller = new AbortController();
      requests.set(controller, directory);
      try {
        return DiscoveryResultSchema.parse(
          await rpc.list(
            {},
            {
              location: { directory },
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(12_000),
              ]),
            }
          )
        );
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        throw error;
      } finally {
        requests.delete(controller);
      }
    };
    const loadCurrent = async (directory: string) => {
      const result = await lookup(directory);
      if (!result || currentDirectory() !== directory) {
        return;
      }
      if (result.directory !== directory || result.status === "error") {
        context.ui.toast.show({
          message:
            result.status === "error"
              ? result.message
              : "Mise returned another workspace",
          variant: "error",
        });
        return;
      }
      return result;
    };
    const run = createActions(context);
    context.keymap.layer(() => ({
      commands: [
        {
          enabled: () => Boolean(currentDirectory()),
          group: "Mise",
          id: "mise-daemons.pick",
          palette: true,
          run: async () => {
            const directory = currentDirectory();
            if (!directory) {
              return;
            }
            try {
              const result = await loadCurrent(directory);
              if (!result) {
                return;
              }
              if (result.daemons.length === 0) {
                context.ui.toast.show({
                  message: "No running daemons",
                  variant: "info",
                });
                return;
              }
              const selection = await context.ui.dialog.select({
                options: result.daemons.flatMap((daemon) =>
                  daemonChoices(daemon.action).map((choice) => ({
                    // Reserve enough row width to show the loopback URL.
                    category:
                      daemon.name.length > 16
                        ? `${daemon.name.slice(0, 15)}…`
                        : daemon.name,
                    description: choice.action.value,
                    title: choice.label,
                    value: {
                      choice,
                      daemonID: daemon.id,
                      name: daemon.name,
                      primary: daemon.action,
                    },
                  }))
                ),
                search: (query, options) =>
                  options.filter((option) =>
                    `${option.value.name} ${option.title} ${option.description}`
                      .toLowerCase()
                      .includes(query.trim().toLowerCase())
                  ),
                title: "Mise daemons",
              });
              if (!selection || currentDirectory() !== directory) {
                return;
              }
              // A picker can outlive its snapshot or the daemon it lists.
              const latest = await loadCurrent(directory);
              if (!latest) {
                return;
              }
              const selected = latest.daemons.find(
                (daemon) => daemon.id === selection.daemonID
              );
              const choice = selected
                ? matchingChoice(selection, selected.action)
                : undefined;
              if (selected && !choice) {
                context.ui.toast.show({
                  message: "Daemon endpoint changed. Select it again.",
                  variant: "warning",
                });
              } else if (choice) {
                await run(choice.action);
              } else {
                context.ui.toast.show({
                  message: "Daemon is no longer running",
                  variant: "info",
                });
              }
            } catch {
              if (currentDirectory() === directory) {
                context.ui.toast.show({
                  message: "Mise daemon lookup failed. Refresh to retry.",
                  variant: "error",
                });
              }
            }
          },
          title: "Mise: Open or copy daemon",
        },
        {
          enabled: () => Boolean(currentDirectory()),
          group: "Mise",
          id: "mise-daemons.refresh",
          palette: true,
          run: async () => {
            const directory = currentDirectory();
            if (!directory) {
              return;
            }
            const mounted = refreshers.get(directory);
            if (mounted) {
              await Promise.all([...mounted].map((refresh) => refresh()));
              return;
            }
            try {
              const result = await loadCurrent(directory);
              if (!result) {
                return;
              }
              context.ui.toast.show({
                message: `${result.daemons.length} running Mise daemons`,
                variant: "info",
              });
            } catch {
              if (currentDirectory() === directory) {
                context.ui.toast.show({
                  message: "Mise daemon lookup failed. Refresh to retry.",
                  variant: "error",
                });
              }
            }
          },
          title: "Mise: Refresh daemons",
        },
      ],
      mode: "global",
    }));
    const remove = context.ui.slot({
      append: "sidebar.content",
      render: (props) => (
        <DaemonSidebar
          registerRefresh={registerRefresh}
          sessionID={props.sessionID}
        />
      ),
    });
    const removeWatch = context.ui.slot({
      append: "app",
      render: () => {
        createEffect(() => {
          const directory = currentDirectory();
          for (const [controller, requestedDirectory] of requests) {
            if (requestedDirectory !== directory) {
              controller.abort();
            }
          }
        });
        return null;
      },
    });
    return () => {
      for (const controller of requests.keys()) {
        controller.abort();
      }
      remove();
      removeWatch();
    };
  },
});
