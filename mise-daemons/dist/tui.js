// @bun
// tui.tsx
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import open from "open";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";

// parse.ts
import { z as z2 } from "zod";

// rpc.ts
import { Rpc } from "@opencode/plugin/rpc";
import { z } from "zod";
var DisplayText = z.string().min(1).regex(/^[^\u0000-\u001F\u007F-\u009F]+$/u);
var DaemonActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open"), value: DisplayText }),
  z.object({ kind: z.literal("copy"), value: DisplayText })
]);
var RunningDaemonSchema = z.object({
  action: DaemonActionSchema,
  id: DisplayText,
  name: DisplayText
});
var DiscoveryResultSchema = z.discriminatedUnion("status", [
  z.object({
    daemons: z.array(RunningDaemonSchema),
    directory: DisplayText,
    fetchedAt: z.number().finite(),
    status: z.literal("ok")
  }),
  z.object({
    code: z.enum(["missing", "unsupported", "failed", "invalid"]),
    directory: DisplayText,
    message: DisplayText,
    status: z.literal("error")
  })
]);
var StopResultSchema = z.discriminatedUnion("status", [
  z.object({ directory: DisplayText, status: z.literal("ok") }),
  z.object({
    code: z.enum(["missing", "unsupported", "failed", "busy"]),
    directory: DisplayText,
    message: DisplayText,
    status: z.literal("error")
  })
]);
var MiseDaemons = Rpc.define({
  events: {},
  id: "mise-daemons",
  methods: {
    list: {
      input: z.object({}),
      output: DiscoveryResultSchema
    },
    stopAll: {
      input: z.strictObject({}),
      output: StopResultSchema
    }
  }
});

// parse.ts
var MiseDaemon = z2.object({
  id: DisplayText,
  name: DisplayText,
  port: z2.number().int().min(1).max(65535).nullish(),
  root: DisplayText,
  status: DisplayText,
  url: DisplayText.nullish()
});
var browserURL = (value) => {
  const parsed = URL.parse(value);
  if (!parsed || !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    return;
  }
  return parsed.href;
};

// actions.ts
var daemonChoices = (primary) => {
  const choices = [
    { action: primary, label: primary.kind === "open" ? "Open" : "Copy" }
  ];
  if (primary.kind !== "copy") {
    return choices;
  }
  const match = /^(?:localhost|127\.0\.0\.1|\[::1\]):(?<port>[0-9]{1,5})$/iu.exec(primary.value);
  const port = Number(match?.groups?.port ?? 0);
  if (match?.[0] === primary.value && port > 0 && port <= 65535) {
    const url = browserURL(`http://${primary.value}`);
    if (url) {
      choices.push({
        action: { kind: "open", value: url },
        label: "Open"
      });
    }
  }
  return choices;
};
var matchingChoice = (displayed, primary) => {
  if (displayed.primary.kind !== primary.kind || displayed.primary.value !== primary.value) {
    return;
  }
  return daemonChoices(primary).find((choice) => choice.label === displayed.choice.label && choice.action.kind === displayed.choice.action.kind && choice.action.value === displayed.choice.action.value);
};
var activate = async (action, services) => {
  try {
    if (action.kind === "open") {
      const url = browserURL(action.value);
      if (!url) {
        throw new Error("Not a browser URL");
      }
      await services.open(url);
    } else {
      if (!services.copy(action.value)) {
        throw new Error("Clipboard unavailable");
      }
      services.notify(`Copied ${action.value}`, "success");
    }
  } catch {
    services.notify(action.kind === "open" ? "Could not open the daemon URL" : "Could not copy the daemon endpoint", "error");
  }
};

// monitor.ts
var createMonitor = (directory, read, update) => {
  let snapshot;
  let request;
  let disposed = false;
  let pending;
  const lookup = async () => {
    const controller = new AbortController;
    request = controller;
    try {
      const result = await read(controller.signal);
      if (disposed || controller.signal.aborted) {
        return;
      }
      if (result.directory !== directory) {
        update({
          message: "Mise returned another workspace. Refresh to retry.",
          snapshot,
          status: "error"
        });
      } else if (result.status === "ok") {
        snapshot = result;
        update({ snapshot, status: "ready" });
      } else {
        update({ message: result.message, snapshot, status: "error" });
      }
    } catch {
      if (!(disposed || controller.signal.aborted)) {
        update({
          message: "Mise daemon lookup failed. Check the server connection and refresh.",
          snapshot,
          status: "error"
        });
      }
    } finally {
      request = undefined;
    }
  };
  update({ status: "loading" });
  const refresh = async (fresh = false) => {
    if (fresh && pending) {
      await pending;
    }
    if (disposed) {
      return;
    }
    if (pending) {
      await pending;
      return;
    }
    pending = lookup();
    try {
      await pending;
    } finally {
      pending = undefined;
    }
  };
  return {
    dispose: () => {
      disposed = true;
      request?.abort();
    },
    refresh
  };
};

// tui.tsx
var createActions = (context) => (action) => activate(action, {
  copy: (value) => context.renderer.copyToClipboardOSC52(value),
  notify: (message, variant) => context.ui.toast.show({
    message,
    variant
  }),
  open: async (url) => {
    await open(url);
  }
});
var Frame = (props) => {
  const context = usePlugin();
  return (() => {
    var _el$ = _$createElement("box");
    _$setProp(_el$, "border", true);
    _$setProp(_el$, "borderStyle", "rounded");
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$, "gap", 1);
    _$setProp(_el$, "paddingLeft", 1);
    _$setProp(_el$, "paddingRight", 1);
    _$setProp(_el$, "width", "100%");
    _$insert(_el$, () => props.children);
    _$effect((_p$) => {
      var _v$ = context.theme.border.base, _v$2 = props.title ?? "Mise daemons", _v$3 = context.theme.text.base;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "borderColor", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$, "title", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$, "titleColor", _v$3, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$;
  })();
};
var DaemonRow = (props) => {
  const context = usePlugin();
  const run = createActions(context);
  const [hovered, setHovered] = createSignal(false);
  const choices = createMemo(() => daemonChoices(props.daemon.action));
  const handleClick = (action, event) => {
    if (event.button !== 0 || props.stale || context.renderer.getSelection()?.getSelectedText()) {
      return;
    }
    event.stopPropagation();
    run(action);
  };
  return (() => {
    var _el$2 = _$createElement("box"), _el$3 = _$createElement("box"), _el$4 = _$createElement("text"), _el$5 = _$createElement("b"), _el$6 = _$createElement("text"), _el$7 = _$createElement("box"), _el$8 = _$createElement("text");
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$2, _el$7);
    _$setProp(_el$2, "flexDirection", "column");
    _$insertNode(_el$3, _el$4);
    _$insertNode(_el$3, _el$6);
    _$setProp(_el$3, "flexDirection", "row");
    _$setProp(_el$3, "gap", 1);
    _$setProp(_el$3, "justifyContent", "space-between");
    _$insertNode(_el$4, _el$5);
    _$setProp(_el$4, "flexShrink", 1);
    _$setProp(_el$4, "truncate", true);
    _$setProp(_el$4, "wrapMode", "none");
    _$insert(_el$5, () => props.daemon.name);
    _$setProp(_el$6, "flexShrink", 0);
    _$insert(_el$6, () => props.stale ? "stale" : "running");
    _$insertNode(_el$7, _el$8);
    _$setProp(_el$7, "flexDirection", "row");
    _$setProp(_el$7, "gap", 1);
    _$setProp(_el$7, "justifyContent", "space-between");
    _$setProp(_el$7, "onMouseOut", () => setHovered(false));
    _$setProp(_el$7, "onMouseOver", () => setHovered(true));
    _$setProp(_el$8, "flexGrow", 1);
    _$setProp(_el$8, "flexShrink", 1);
    _$setProp(_el$8, "onMouseUp", (event) => handleClick(props.daemon.action, event));
    _$setProp(_el$8, "truncate", true);
    _$setProp(_el$8, "wrapMode", "none");
    _$insert(_el$8, () => props.daemon.action.value);
    _$insert(_el$7, _$createComponent(For, {
      get each() {
        return choices();
      },
      children: (choice, index) => [_$createComponent(Show, {
        get when() {
          return index() > 0;
        },
        get children() {
          var _el$9 = _$createElement("text");
          _$insertNode(_el$9, _$createTextNode(`|`));
          _$setProp(_el$9, "flexShrink", 0);
          _$setProp(_el$9, "selectable", false);
          _$effect((_$p) => _$setProp(_el$9, "fg", context.theme.text.muted, _$p));
          return _el$9;
        }
      }), (() => {
        var _el$1 = _$createElement("text");
        _$setProp(_el$1, "flexShrink", 0);
        _$setProp(_el$1, "onMouseUp", (event) => handleClick(choice.action, event));
        _$setProp(_el$1, "selectable", false);
        _$insert(_el$1, _$createComponent(Show, {
          get when() {
            return _$memo(() => !!hovered())() && !props.stale;
          },
          get fallback() {
            return choice.label;
          },
          get children() {
            var _el$10 = _$createElement("u");
            _$insert(_el$10, () => choice.label);
            return _el$10;
          }
        }));
        _$effect((_$p) => _$setProp(_el$1, "fg", props.stale ? context.theme.text.muted : context.theme.text.base, _$p));
        return _el$1;
      })()]
    }), null);
    _$effect((_p$) => {
      var _v$4 = context.theme.text.base, _v$5 = context.theme.text.muted, _v$6 = context.theme.text.muted;
      _v$4 !== _p$.e && (_p$.e = _$setProp(_el$4, "fg", _v$4, _p$.e));
      _v$5 !== _p$.t && (_p$.t = _$setProp(_el$6, "fg", _v$5, _p$.t));
      _v$6 !== _p$.a && (_p$.a = _$setProp(_el$8, "fg", _v$6, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$2;
  })();
};
var WorkspaceDaemons = (props) => {
  const context = usePlugin();
  const rpc = context.client.rpc(MiseDaemons);
  const [state, setState] = createSignal({
    status: "loading"
  });
  const [stopState, setStopState] = createSignal("idle");
  const lifetime = new AbortController;
  const monitor = createMonitor(props.directory, async (signal) => DiscoveryResultSchema.parse(await rpc.list({}, {
    location: {
      directory: props.directory
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(12000)])
  })), setState);
  const daemons = createMemo(() => {
    const value = state();
    return value.status === "loading" ? [] : value.snapshot?.daemons ?? [];
  });
  const message = createMemo(() => {
    const value = state();
    if (value.status === "loading") {
      return "Loading daemons\u2026";
    }
    if (value.status === "error") {
      return value.message;
    }
    return value.snapshot.daemons.length === 0 ? "No running daemons" : undefined;
  });
  const title = () => {
    if (state().status === "error" && daemons().length > 0) {
      return "Mise daemons \xB7 Stale";
    }
    return daemons().length > 0 ? `Mise daemons \xB7 ${daemons().length}` : "Mise daemons";
  };
  const canStop = () => stopState() === "idle" && state().status === "ready" && daemons().length > 0;
  const stopAll = async () => {
    if (!canStop()) {
      return;
    }
    setStopState("confirming");
    try {
      const confirmed = await context.ui.dialog.confirm({
        label: {
          cancel: "Cancel",
          confirm: "Stop All"
        },
        message: `Stop all Mise project daemons for this workspace?

${props.directory}

Daemon data is kept. Other projects are not stopped.`,
        title: "Stop workspace daemons?"
      });
      const route = context.ui.router.current();
      if (!confirmed || lifetime.signal.aborted || state().status !== "ready" || daemons().length === 0 || route.type !== "session" || context.data.session.get(route.sessionID)?.location.directory !== props.directory) {
        return;
      }
      setStopState("stopping");
      const result = StopResultSchema.parse(await rpc.stopAll({}, {
        location: {
          directory: props.directory
        },
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(35000)])
      }));
      if (lifetime.signal.aborted) {
        return;
      }
      if (result.directory !== props.directory) {
        context.ui.toast.show({
          message: "Mise returned another workspace. Refresh to check daemon status.",
          variant: "error"
        });
        return;
      }
      context.ui.toast.show({
        message: result.status === "error" ? result.message : "Stop All completed",
        variant: result.status === "ok" ? "success" : "error"
      });
    } catch {
      if (!lifetime.signal.aborted) {
        context.ui.toast.show({
          message: "Stop All did not complete. Some daemons may have stopped. Refresh to check their status.",
          variant: "error"
        });
      }
    } finally {
      if (!lifetime.signal.aborted) {
        if (stopState() === "stopping") {
          await monitor.refresh(true);
        }
        if (!lifetime.signal.aborted) {
          setStopState("idle");
        }
      }
    }
  };
  const timer = setInterval(() => {
    monitor.refresh();
  }, 5000);
  const unregister = props.registerRefresh(props.directory, monitor.refresh);
  monitor.refresh();
  onCleanup(() => {
    lifetime.abort();
    clearInterval(timer);
    monitor.dispose();
    unregister();
  });
  return _$createComponent(Frame, {
    get title() {
      return title();
    },
    get children() {
      return [_$createComponent(Show, {
        get when() {
          return message();
        },
        children: (value) => (() => {
          var _el$20 = _$createElement("text");
          _$insert(_el$20, value);
          _$effect((_$p) => _$setProp(_el$20, "fg", context.theme.text.muted, _$p));
          return _el$20;
        })()
      }), _$createComponent(For, {
        get each() {
          return daemons();
        },
        children: (daemon) => _$createComponent(DaemonRow, {
          daemon,
          get stale() {
            return state().status === "error" || stopState() === "stopping";
          }
        })
      }), (() => {
        var _el$11 = _$createElement("box"), _el$12 = _$createElement("text"), _el$15 = _$createElement("text"), _el$17 = _$createElement("text");
        _$insertNode(_el$11, _el$12);
        _$insertNode(_el$11, _el$15);
        _$insertNode(_el$11, _el$17);
        _$setProp(_el$11, "flexDirection", "row");
        _$setProp(_el$11, "gap", 1);
        _$setProp(_el$11, "justifyContent", "flex-end");
        _$setProp(_el$12, "onMouseUp", (event) => {
          if (event.button === 0 && !context.renderer.getSelection()?.getSelectedText()) {
            event.stopPropagation();
            stopAll();
          }
        });
        _$setProp(_el$12, "selectable", false);
        _$insert(_el$12, _$createComponent(Show, {
          get when() {
            return canStop();
          },
          get fallback() {
            return stopState() === "stopping" ? "Stopping\u2026" : "Stop All";
          },
          get children() {
            var _el$13 = _$createElement("u");
            _$insertNode(_el$13, _$createTextNode(`Stop All`));
            return _el$13;
          }
        }));
        _$insertNode(_el$15, _$createTextNode(`|`));
        _$setProp(_el$15, "selectable", false);
        _$setProp(_el$17, "onMouseUp", (event) => {
          if (event.button === 0 && stopState() === "idle") {
            monitor.refresh();
          }
        });
        _$setProp(_el$17, "selectable", false);
        _$insert(_el$17, _$createComponent(Show, {
          get when() {
            return stopState() === "idle";
          },
          fallback: "Refresh",
          get children() {
            var _el$18 = _$createElement("u");
            _$insertNode(_el$18, _$createTextNode(`Refresh`));
            return _el$18;
          }
        }));
        _$effect((_p$) => {
          var _v$7 = canStop() ? context.theme.text.base : context.theme.text.muted, _v$8 = context.theme.text.muted, _v$9 = stopState() === "idle" ? context.theme.text.base : context.theme.text.muted;
          _v$7 !== _p$.e && (_p$.e = _$setProp(_el$12, "fg", _v$7, _p$.e));
          _v$8 !== _p$.t && (_p$.t = _$setProp(_el$15, "fg", _v$8, _p$.t));
          _v$9 !== _p$.a && (_p$.a = _$setProp(_el$17, "fg", _v$9, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$11;
      })()];
    }
  });
};
var DaemonSidebar = (props) => {
  const context = usePlugin();
  const directory = createMemo(() => context.data.session.get(props.sessionID)?.location.directory);
  return _$createComponent(Show, {
    get fallback() {
      return _$createComponent(Frame, {
        get children() {
          var _el$21 = _$createElement("text");
          _$insertNode(_el$21, _$createTextNode(`Loading workspace\u2026`));
          _$effect((_$p) => _$setProp(_el$21, "fg", context.theme.text.muted, _$p));
          return _el$21;
        }
      });
    },
    keyed: true,
    get when() {
      return directory();
    },
    children: (value) => _$createComponent(WorkspaceDaemons, {
      directory: value,
      get registerRefresh() {
        return props.registerRefresh;
      }
    })
  });
};
var tui_default = Plugin.define({
  id: "mise-daemons",
  setup(context) {
    const rpc = context.client.rpc(MiseDaemons);
    const requests = new Map;
    const refreshers = new Map;
    const registerRefresh = (directory, refresh) => {
      const entries = refreshers.get(directory) ?? new Set;
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
      return route.type === "session" ? context.data.session.get(route.sessionID)?.location.directory : undefined;
    };
    const lookup = async (directory) => {
      const controller = new AbortController;
      requests.set(controller, directory);
      try {
        return DiscoveryResultSchema.parse(await rpc.list({}, {
          location: {
            directory
          },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)])
        }));
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        throw error;
      } finally {
        requests.delete(controller);
      }
    };
    const loadCurrent = async (directory) => {
      const result = await lookup(directory);
      if (!result || currentDirectory() !== directory) {
        return;
      }
      if (result.directory !== directory || result.status === "error") {
        context.ui.toast.show({
          message: result.status === "error" ? result.message : "Mise returned another workspace",
          variant: "error"
        });
        return;
      }
      return result;
    };
    const run = createActions(context);
    context.keymap.layer(() => ({
      commands: [{
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
                variant: "info"
              });
              return;
            }
            const selection = await context.ui.dialog.select({
              options: result.daemons.flatMap((daemon) => daemonChoices(daemon.action).map((choice) => ({
                category: daemon.name.length > 16 ? `${daemon.name.slice(0, 15)}\u2026` : daemon.name,
                description: choice.action.value,
                title: choice.label,
                value: {
                  choice,
                  daemonID: daemon.id,
                  name: daemon.name,
                  primary: daemon.action
                }
              }))),
              search: (query, options) => options.filter((option) => `${option.value.name} ${option.title} ${option.description}`.toLowerCase().includes(query.trim().toLowerCase())),
              title: "Mise daemons"
            });
            if (!selection || currentDirectory() !== directory) {
              return;
            }
            const latest = await loadCurrent(directory);
            if (!latest) {
              return;
            }
            const selected = latest.daemons.find((daemon) => daemon.id === selection.daemonID);
            const choice = selected ? matchingChoice(selection, selected.action) : undefined;
            if (selected && !choice) {
              context.ui.toast.show({
                message: "Daemon endpoint changed. Select it again.",
                variant: "warning"
              });
            } else if (choice) {
              await run(choice.action);
            } else {
              context.ui.toast.show({
                message: "Daemon is no longer running",
                variant: "info"
              });
            }
          } catch {
            if (currentDirectory() === directory) {
              context.ui.toast.show({
                message: "Mise daemon lookup failed. Refresh to retry.",
                variant: "error"
              });
            }
          }
        },
        title: "Mise: Open or copy daemon"
      }, {
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
              variant: "info"
            });
          } catch {
            if (currentDirectory() === directory) {
              context.ui.toast.show({
                message: "Mise daemon lookup failed. Refresh to retry.",
                variant: "error"
              });
            }
          }
        },
        title: "Mise: Refresh daemons"
      }],
      mode: "global"
    }));
    const remove = context.ui.slot({
      append: "sidebar.content",
      render: (props) => _$createComponent(DaemonSidebar, {
        registerRefresh,
        get sessionID() {
          return props.sessionID;
        }
      })
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
      }
    });
    return () => {
      for (const controller of requests.keys()) {
        controller.abort();
      }
      remove();
      removeWatch();
    };
  }
});
export {
  tui_default as default
};
