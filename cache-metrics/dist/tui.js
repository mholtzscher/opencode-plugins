// @bun
// tui.tsx
import { use as _$use2 } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { effect as _$effect2 } from "@opentui/solid";
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createEffect as createEffect2, createSignal as createSignal2, onCleanup as onCleanup2, Show as Show2 } from "solid-js";

// cache-history-panel.tsx
import { use as _$use } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { appendFileSync } from "fs";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";

// cache-history.ts
function buildCacheHistory(sessions) {
  const points = new Map;
  for (const [sessionID, messages] of sessions) {
    let prompt;
    let turnID = `${sessionID}:before-user`;
    let userIndex = 0;
    let afterTools = [];
    let afterCompaction;
    for (const message of messages) {
      if (message.type === "user") {
        userIndex += 1;
        turnID = `${sessionID}:user:${message.id ?? userIndex}`;
        prompt = message.text.replace(/\s+/g, " ").trim().slice(0, 90) || undefined;
        afterTools = [];
        continue;
      }
      if (message.type === "compaction" && message.status === "completed") {
        afterCompaction = message.reason;
        continue;
      }
      if (message.type !== "assistant" || !message.tokens || !message.time.completed) {
        continue;
      }
      const { input, output, cache } = message.tokens;
      const tools = message.content.filter((part) => part.type === "tool").map((part) => part.name);
      points.set(`${sessionID}:${message.id}`, {
        afterCompaction,
        afterTools,
        agent: message.agent,
        finish: message.finish,
        id: message.id,
        input,
        modelID: message.model.id,
        output,
        prompt,
        providerID: message.model.providerID,
        rate: input + cache.read > 0 ? cache.read / (input + cache.read) : undefined,
        read: cache.read,
        retryAttempt: message.retry?.attempt,
        sessionID,
        time: message.time.completed,
        tools,
        turnID,
        write: cache.write
      });
      afterTools = tools;
      afterCompaction = undefined;
    }
  }
  const sorted = [...points.values()].sort((a, b) => a.time - b.time || a.sessionID.localeCompare(b.sessionID) || a.id.localeCompare(b.id));
  let input = 0;
  let read = 0;
  const previous = new Map;
  return sorted.map((point) => {
    const key = `${point.sessionID}:${point.providerID}:${point.modelID}`;
    const baseline = previous.get(key);
    const previousRead = baseline !== undefined && !point.afterCompaction && baseline.read >= 1000 && point.read <= baseline.read * 0.3 && point.input + point.read >= (baseline.input + baseline.read) * 0.8 ? baseline.read : undefined;
    previous.set(key, point);
    input += point.input;
    read += point.read;
    return {
      ...point,
      cumulativeRate: input + read > 0 ? read / (input + read) : undefined,
      previousRead
    };
  });
}
function groupCacheHistoryTurns(points) {
  const turns = new Map;
  for (const point of points) {
    let turn = turns.get(point.turnID);
    if (!turn) {
      turn = {
        id: point.turnID,
        input: 0,
        output: 0,
        points: [],
        prompt: point.prompt,
        read: 0,
        sessionID: point.sessionID,
        time: point.time
      };
      turns.set(point.turnID, turn);
    }
    turn.points.push(point);
    turn.time = Math.min(turn.time, point.time);
    turn.input += point.input;
    turn.read += point.read;
    turn.output += point.output;
  }
  return [...turns.values()].map((turn) => ({
    ...turn,
    rate: turn.input + turn.read > 0 ? turn.read / (turn.input + turn.read) : undefined
  })).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}
function formatCacheHistoryTrend(points) {
  const bars = "\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588";
  return points.slice(-40).map((point) => point.rate === undefined ? "\xB7" : bars[Math.min(bars.length - 1, Math.floor(point.rate * bars.length))]).join("");
}
function exportCacheHistory(sessionID, scope, points) {
  const totals = points.reduce((result, point) => {
    result.input += point.input;
    result.output += point.output;
    result.cacheRead += point.read;
    result.cacheWrite += point.write;
    return result;
  }, { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 });
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    responseCount: points.length,
    scope,
    sessionID,
    timeline: points.map((point) => ({
      ...point,
      time: new Date(point.time).toISOString()
    })),
    totals: {
      ...totals,
      cacheHitRate: totals.input + totals.cacheRead > 0 ? totals.cacheRead / (totals.input + totals.cacheRead) : null
    }
  }, null, 2);
}

// cache-history-panel.tsx
var percent = (rate) => rate === undefined ? "\u2014" : `${(rate * 100).toFixed(1)}%`;
var count = (tokens) => tokens.toLocaleString();
function CacheHistoryPanel(props) {
  const {
    context
  } = props;
  const [family, setFamily] = createSignal(true);
  const [snapshots, setSnapshots] = createSignal(new Map);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal(false);
  const [follow, setFollow] = createSignal(true);
  const [streamingSessions, setStreamingSessions] = createSignal(new Set);
  let scrollbox;
  const setScrollbox = (element) => {
    scrollbox = element;
  };
  let generation = 0;
  const debug = process.env.OPENCODE_CACHE_METRICS_DEBUG === "1";
  const trace = (message, details) => {
    if (debug) {
      try {
        appendFileSync("/tmp/opencode/cache-metrics-history.log", `${JSON.stringify({
          message,
          time: new Date().toISOString(),
          ...details
        })}
`);
      } catch {}
    }
  };
  const inScope = (sessionID) => sessionID === props.panel.sessionID || family() && context.data.session.root(sessionID) === context.data.session.root(props.panel.sessionID);
  const updateStreamingSession = (sessionID, streaming) => {
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
      return "Loading saved responses\u2026";
    }
    if (streamingInScope()) {
      return "Waiting for token usage\u2026";
    }
    return "No completed responses with token usage yet.";
  };
  const refresh = async (trigger = "initial") => {
    generation += 1;
    const current = generation;
    const {
      sessionID
    } = props.panel;
    const root = context.data.session.root(sessionID);
    const ids = family() ? [...new Set([root, ...context.data.session.family(root)])] : [sessionID];
    trace("refresh started", {
      ids,
      scope: family() ? "family" : "session",
      sessionID,
      trigger
    });
    setSnapshots(new Map(ids.map((id) => [id, context.data.session.message.list(id) ?? []])));
    setLoading(true);
    setError(false);
    try {
      await context.data.session.sync(sessionID);
      const refreshedRoot = context.data.session.root(sessionID);
      const refreshedIDs = family() ? [...new Set([refreshedRoot, ...context.data.session.family(refreshedRoot)])] : [sessionID];
      const entries = await Promise.all(refreshedIDs.map(async (id) => {
        context.data.session.message.invalidate(id);
        await context.data.session.message.sync(id);
        return [id, context.data.session.message.list(id) ?? []];
      }));
      if (generation === current) {
        setSnapshots(new Map(entries));
        trace("refresh completed", {
          counts: entries.map(([id, messages]) => ({
            messages: messages.length,
            sessionID: id
          })),
          sessionID,
          trigger
        });
      }
    } catch (cause) {
      if (generation === current) {
        setError(true);
        trace("refresh failed", {
          error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
          sessionID,
          trigger
        });
      }
    } finally {
      if (generation === current) {
        setLoading(false);
      }
    }
  };
  createEffect(() => {
    const {
      sessionID
    } = props.panel;
    family();
    setStreamingSessions(new Set);
    if (sessionID) {
      refresh();
    }
  });
  const stopStepStarted = context.data.on("session.step.started", (event) => {
    trace("step started", {
      inScope: inScope(event.data.sessionID),
      sessionID: event.data.sessionID
    });
    if (inScope(event.data.sessionID)) {
      updateStreamingSession(event.data.sessionID, true);
    }
  });
  const stopStepEnded = context.data.on("session.step.ended", (event) => {
    trace("step ended", {
      inScope: inScope(event.data.sessionID),
      sessionID: event.data.sessionID
    });
    if (inScope(event.data.sessionID)) {
      updateStreamingSession(event.data.sessionID, false);
      refresh("step ended");
    }
  });
  const stopStepFailed = context.data.on("session.step.failed", (event) => {
    trace("step failed", {
      inScope: inScope(event.data.sessionID),
      sessionID: event.data.sessionID
    });
    if (inScope(event.data.sessionID)) {
      updateStreamingSession(event.data.sessionID, false);
      refresh("step failed");
    }
  });
  const stopExecution = context.data.on("session.execution.succeeded", (event) => {
    if (inScope(event.data.sessionID)) {
      trace("execution succeeded", {
        sessionID: event.data.sessionID
      });
      updateStreamingSession(event.data.sessionID, false);
      refresh("execution succeeded");
    }
  });
  const stopExecutionFailed = context.data.on("session.execution.failed", (event) => {
    if (inScope(event.data.sessionID)) {
      trace("execution failed", {
        sessionID: event.data.sessionID
      });
      updateStreamingSession(event.data.sessionID, false);
      refresh("execution failed");
    }
  });
  const stopExecutionInterrupted = context.data.on("session.execution.interrupted", (event) => {
    if (inScope(event.data.sessionID)) {
      trace("execution interrupted", {
        sessionID: event.data.sessionID
      });
      updateStreamingSession(event.data.sessionID, false);
      refresh("execution interrupted");
    }
  });
  const stopCreated = context.data.on("session.created", (event) => {
    if (family() && event.data.parentID && context.data.session.root(event.data.parentID) === context.data.session.root(props.panel.sessionID)) {
      context.data.session.sync(event.data.sessionID).then(() => refresh("session created")).catch((cause) => {
        setError(true);
        trace("child session sync failed", {
          error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
          sessionID: event.data.sessionID
        });
      });
    }
  });
  onCleanup(() => {
    generation += 1;
    stopStepStarted();
    stopStepEnded();
    stopStepFailed();
    stopExecution();
    stopExecutionFailed();
    stopExecutionInterrupted();
    stopCreated();
  });
  const history = createMemo(() => buildCacheHistory(snapshots()));
  const turns = createMemo(() => groupCacheHistoryTurns(history()));
  createEffect(() => {
    turns();
    if (!follow()) {
      return;
    }
    const timer = setTimeout(() => {
      if (follow()) {
        scrollbox?.scrollTo(scrollbox.scrollHeight);
      }
    }, 0);
    onCleanup(() => clearTimeout(timer));
  });
  createEffect(() => {
    const points = history();
    const groups = turns();
    trace("view updated", {
      lastResponseID: points.at(-1)?.id,
      responses: points.length,
      sessionID: props.panel.sessionID,
      turns: groups.length
    });
  });
  const rateColor = (point) => {
    if (point.rate === undefined || point.rate < 0.3) {
      return context.theme.text.muted;
    }
    if (point.rate < 0.7) {
      return context.theme.text.feedback?.warning?.base ?? context.theme.hue.yellow[500];
    }
    return context.theme.text.feedback?.success?.base ?? context.theme.hue.green[500];
  };
  context.keymap.layer(() => ({
    commands: [{
      bind: "s",
      enabled: () => props.panel.focused,
      id: "cache-metrics.history.scope",
      run: () => setFamily(!family()),
      title: "Toggle cache history session scope"
    }, {
      bind: "t",
      enabled: () => props.panel.focused,
      id: "cache-metrics.history.follow",
      run: () => setFollow(!follow()),
      title: "Toggle cache history follow mode"
    }, {
      bind: "r",
      enabled: () => props.panel.focused,
      id: "cache-metrics.history.refresh",
      run: () => {
        refresh("manual");
      },
      title: "Refresh cache history"
    }, {
      bind: "shift+r",
      enabled: () => props.panel.focused,
      id: "cache-metrics.history.redraw",
      run: () => {
        trace("redraw requested", {
          sessionID: props.panel.sessionID
        });
        context.renderer.requestRender();
      },
      title: "Redraw cache history UI"
    }, {
      bind: "e",
      enabled: () => props.panel.focused,
      id: "cache-metrics.history.export",
      run: () => {
        try {
          const json = exportCacheHistory(props.panel.sessionID, family() ? "family" : "session", history());
          if (!context.renderer.copyToClipboardOSC52(json)) {
            throw new Error("Clipboard unavailable");
          }
          context.ui.toast.show({
            message: "Cache history JSON copied to clipboard",
            variant: "success"
          });
        } catch {
          context.ui.toast.show({
            message: "Could not copy cache history to clipboard",
            variant: "error"
          });
        }
      },
      title: "Copy cache history JSON"
    }, {
      bind: "f",
      enabled: () => props.panel.focused,
      id: "cache-metrics.history.fullscreen",
      run: props.panel.toggleFullscreen
    }, {
      bind: "escape",
      enabled: () => props.panel.focused,
      id: "cache-metrics.history.close",
      run: props.panel.close
    }],
    mode: "global"
  }));
  return (() => {
    var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$3 = _$createElement("b"), _el$4 = _$createTextNode(`Cache history \xB7 `), _el$5 = _$createElement("text"), _el$6 = _$createTextNode(` turns \xB7 `), _el$7 = _$createTextNode(` responses \xB7 cumulative `), _el$9 = _$createTextNode(` \xB7 Follow `), _el$13 = _$createElement("scrollbox"), _el$15 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$5);
    _$insertNode(_el$, _el$13);
    _$insertNode(_el$, _el$15);
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$, "gap", 1);
    _$setProp(_el$, "height", "100%");
    _$setProp(_el$, "paddingLeft", 1);
    _$setProp(_el$, "paddingRight", 1);
    _$setProp(_el$, "width", "100%");
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$3, _el$4);
    _$insert(_el$3, () => family() ? "Session + subagents" : "This session", null);
    _$insertNode(_el$5, _el$6);
    _$insertNode(_el$5, _el$7);
    _$insertNode(_el$5, _el$9);
    _$insert(_el$5, () => turns().length, _el$6);
    _$insert(_el$5, () => history().length, _el$7);
    _$insert(_el$5, () => percent(history().at(-1)?.cumulativeRate), _el$9);
    _$insert(_el$5, () => follow() ? "on" : "off", null);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return history().length > 0;
      },
      get children() {
        var _el$1 = _$createElement("text"), _el$10 = _$createTextNode(`Trend (oldest \u2192 newest): `);
        _$insertNode(_el$1, _el$10);
        _$insert(_el$1, () => formatCacheHistoryTrend(history()), null);
        _$effect((_$p) => _$setProp(_el$1, "fg", context.theme.text.muted, _$p));
        return _el$1;
      }
    }), _el$13);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return error();
      },
      get children() {
        var _el$11 = _$createElement("text");
        _$insertNode(_el$11, _$createTextNode(`Could not refresh history. Press r to retry.`));
        _$effect((_$p) => _$setProp(_el$11, "fg", context.theme.text.feedback?.error?.base ?? context.theme.hue.red[500], _$p));
        return _el$11;
      }
    }), _el$13);
    _$use(setScrollbox, _el$13);
    _$setProp(_el$13, "flexGrow", 1);
    _$setProp(_el$13, "stickyStart", "bottom");
    _$insert(_el$13, _$createComponent(For, {
      get each() {
        return turns();
      },
      children: (turn, index) => (() => {
        var _el$17 = _$createElement("box"), _el$18 = _$createElement("box"), _el$19 = _$createElement("text"), _el$20 = _$createElement("b"), _el$21 = _$createTextNode(`Turn `), _el$22 = _$createTextNode(` \xB7 `), _el$24 = _$createTextNode(` \xB7 `), _el$26 = _$createTextNode(` `), _el$27 = _$createElement("text"), _el$28 = _$createTextNode(`Request: `), _el$29 = _$createElement("text"), _el$30 = _$createTextNode(`Turn cache hit `), _el$31 = _$createTextNode(` \xB7 In `), _el$32 = _$createTextNode(` cached / `), _el$34 = _$createTextNode(` new \xB7 Out `), _el$35 = _$createElement("box");
        _$insertNode(_el$17, _el$18);
        _$insertNode(_el$17, _el$35);
        _$setProp(_el$17, "border", true);
        _$setProp(_el$17, "borderStyle", "rounded");
        _$setProp(_el$17, "flexDirection", "column");
        _$setProp(_el$17, "width", "100%");
        _$insertNode(_el$18, _el$19);
        _$insertNode(_el$18, _el$27);
        _$insertNode(_el$18, _el$29);
        _$setProp(_el$18, "flexDirection", "column");
        _$setProp(_el$18, "paddingLeft", 1);
        _$setProp(_el$18, "paddingRight", 1);
        _$setProp(_el$18, "width", "100%");
        _$insertNode(_el$19, _el$20);
        _$insertNode(_el$20, _el$21);
        _$insertNode(_el$20, _el$22);
        _$insertNode(_el$20, _el$24);
        _$insertNode(_el$20, _el$26);
        _$insert(_el$20, () => index() + 1, _el$22);
        _$insert(_el$20, () => turn.sessionID === context.data.session.root(props.panel.sessionID) ? "Parent" : "Subagent", _el$24);
        _$insert(_el$20, () => turn.points.length, _el$26);
        _$insert(_el$20, () => turn.points.length === 1 ? "response" : "responses", null);
        _$insertNode(_el$27, _el$28);
        _$setProp(_el$27, "truncate", true);
        _$setProp(_el$27, "wrapMode", "none");
        _$insert(_el$27, () => turn.prompt ?? "(No saved user request)", null);
        _$insertNode(_el$29, _el$30);
        _$insertNode(_el$29, _el$31);
        _$insertNode(_el$29, _el$32);
        _$insertNode(_el$29, _el$34);
        _$insert(_el$29, () => percent(turn.rate), _el$31);
        _$insert(_el$29, () => count(turn.read), _el$32);
        _$insert(_el$29, () => count(turn.input), _el$34);
        _$insert(_el$29, () => count(turn.output), null);
        _$setProp(_el$35, "border", ["top"]);
        _$setProp(_el$35, "height", 1);
        _$setProp(_el$35, "width", "100%");
        _$insert(_el$17, _$createComponent(For, {
          get each() {
            return turn.points;
          },
          children: (point, responseIndex) => (() => {
            var _el$36 = _$createElement("box"), _el$38 = _$createElement("box"), _el$39 = _$createElement("box"), _el$40 = _$createElement("text"), _el$41 = _$createElement("b"), _el$42 = _$createTextNode(`Response `), _el$43 = _$createTextNode(` \xB7 `), _el$51 = _$createElement("text"), _el$52 = _$createTextNode(` \xB7 `), _el$54 = _$createTextNode(`/`), _el$55 = _$createElement("text"), _el$56 = _$createTextNode(` \xB7 In `), _el$58 = _$createTextNode(` cached / `), _el$59 = _$createTextNode(` new \xB7 Out `), _el$68 = _$createElement("text"), _el$69 = _$createTextNode(`Finish: `), _el$70 = _$createElement("text"), _el$71 = _$createTextNode(`Cache writes `), _el$72 = _$createTextNode(` \xB7 cumulative `);
            _$insertNode(_el$36, _el$38);
            _$setProp(_el$36, "flexDirection", "column");
            _$setProp(_el$36, "width", "100%");
            _$insert(_el$36, _$createComponent(Show, {
              get when() {
                return responseIndex() > 0;
              },
              get children() {
                var _el$37 = _$createElement("box");
                _$setProp(_el$37, "border", ["top"]);
                _$setProp(_el$37, "height", 1);
                _$setProp(_el$37, "width", "100%");
                _$effect((_$p) => _$setProp(_el$37, "borderColor", context.theme.border.base, _$p));
                return _el$37;
              }
            }), _el$38);
            _$insertNode(_el$38, _el$39);
            _$insertNode(_el$38, _el$55);
            _$insertNode(_el$38, _el$68);
            _$insertNode(_el$38, _el$70);
            _$setProp(_el$38, "flexDirection", "column");
            _$setProp(_el$38, "paddingLeft", 1);
            _$setProp(_el$38, "paddingRight", 1);
            _$setProp(_el$38, "width", "100%");
            _$insertNode(_el$39, _el$40);
            _$insertNode(_el$39, _el$51);
            _$setProp(_el$39, "flexDirection", "row");
            _$setProp(_el$39, "gap", 1);
            _$insertNode(_el$40, _el$41);
            _$insertNode(_el$41, _el$42);
            _$insertNode(_el$41, _el$43);
            _$insert(_el$41, () => responseIndex() + 1, _el$43);
            _$insert(_el$41, () => percent(point.rate), null);
            _$insert(_el$39, _$createComponent(Show, {
              get when() {
                return point.previousRead !== undefined;
              },
              get children() {
                var _el$45 = _$createElement("text"), _el$46 = _$createElement("b"), _el$47 = _$createTextNode(`\u26A0 Possible cache loss (`), _el$48 = _$createTextNode(` \u2192 `), _el$50 = _$createTextNode(` cached)`);
                _$insertNode(_el$45, _el$46);
                _$insertNode(_el$46, _el$47);
                _$insertNode(_el$46, _el$48);
                _$insertNode(_el$46, _el$50);
                _$insert(_el$46, () => count(point.previousRead ?? 0), _el$48);
                _$insert(_el$46, () => count(point.read), _el$50);
                _$effect((_$p) => _$setProp(_el$45, "fg", context.theme.text.feedback?.warning?.base ?? context.theme.hue.yellow[500], _$p));
                return _el$45;
              }
            }), _el$51);
            _$insertNode(_el$51, _el$52);
            _$insertNode(_el$51, _el$54);
            _$setProp(_el$51, "truncate", true);
            _$setProp(_el$51, "wrapMode", "none");
            _$insert(_el$51, () => new Date(point.time).toLocaleTimeString(), _el$52);
            _$insert(_el$51, () => point.providerID, _el$54);
            _$insert(_el$51, () => point.modelID, null);
            _$insertNode(_el$55, _el$56);
            _$insertNode(_el$55, _el$58);
            _$insertNode(_el$55, _el$59);
            _$setProp(_el$55, "truncate", true);
            _$setProp(_el$55, "wrapMode", "none");
            _$insert(_el$55, (() => {
              var _c$ = _$memo(() => point.sessionID === context.data.session.root(props.panel.sessionID));
              return () => _c$() ? "Parent" : `Subagent (${point.agent})`;
            })(), _el$56);
            _$insert(_el$55, () => count(point.read), _el$58);
            _$insert(_el$55, () => count(point.input), _el$59);
            _$insert(_el$55, () => count(point.output), null);
            _$insert(_el$38, _$createComponent(Show, {
              get when() {
                return point.afterTools.length > 0;
              },
              get children() {
                var _el$61 = _$createElement("text"), _el$62 = _$createTextNode(`After tools: `);
                _$insertNode(_el$61, _el$62);
                _$setProp(_el$61, "truncate", true);
                _$setProp(_el$61, "wrapMode", "none");
                _$insert(_el$61, () => point.afterTools.join(", "), null);
                _$effect((_$p) => _$setProp(_el$61, "fg", context.theme.text.muted, _$p));
                return _el$61;
              }
            }), _el$68);
            _$insert(_el$38, _$createComponent(Show, {
              get when() {
                return point.afterCompaction;
              },
              get children() {
                var _el$63 = _$createElement("text"), _el$64 = _$createTextNode(`After `), _el$65 = _$createTextNode(` compaction`);
                _$insertNode(_el$63, _el$64);
                _$insertNode(_el$63, _el$65);
                _$insert(_el$63, () => point.afterCompaction, _el$65);
                _$effect((_$p) => _$setProp(_el$63, "fg", context.theme.text.muted, _$p));
                return _el$63;
              }
            }), _el$68);
            _$insert(_el$38, _$createComponent(Show, {
              get when() {
                return point.tools.length > 0;
              },
              get children() {
                var _el$66 = _$createElement("text"), _el$67 = _$createTextNode(`Called tools: `);
                _$insertNode(_el$66, _el$67);
                _$setProp(_el$66, "truncate", true);
                _$setProp(_el$66, "wrapMode", "none");
                _$insert(_el$66, () => point.tools.join(", "), null);
                _$effect((_$p) => _$setProp(_el$66, "fg", context.theme.text.muted, _$p));
                return _el$66;
              }
            }), _el$68);
            _$insertNode(_el$68, _el$69);
            _$insert(_el$68, () => point.finish ?? "unknown", null);
            _$insert(_el$68, (() => {
              var _c$2 = _$memo(() => !!point.retryAttempt);
              return () => _c$2() ? ` \xB7 retry ${point.retryAttempt}` : "";
            })(), null);
            _$insertNode(_el$70, _el$71);
            _$insertNode(_el$70, _el$72);
            _$insert(_el$70, () => count(point.write), _el$72);
            _$insert(_el$70, () => percent(point.cumulativeRate), null);
            _$effect((_p$) => {
              var _v$0 = rateColor(point), _v$1 = context.theme.text.base, _v$10 = context.theme.text.muted, _v$11 = context.theme.text.muted, _v$12 = context.theme.text.muted;
              _v$0 !== _p$.e && (_p$.e = _$setProp(_el$40, "fg", _v$0, _p$.e));
              _v$1 !== _p$.t && (_p$.t = _$setProp(_el$51, "fg", _v$1, _p$.t));
              _v$10 !== _p$.a && (_p$.a = _$setProp(_el$55, "fg", _v$10, _p$.a));
              _v$11 !== _p$.o && (_p$.o = _$setProp(_el$68, "fg", _v$11, _p$.o));
              _v$12 !== _p$.i && (_p$.i = _$setProp(_el$70, "fg", _v$12, _p$.i));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined,
              o: undefined,
              i: undefined
            });
            return _el$36;
          })()
        }), null);
        _$effect((_p$) => {
          var _v$5 = context.theme.hue.blue[500], _v$6 = context.theme.text.base, _v$7 = context.theme.text.base, _v$8 = context.theme.text.muted, _v$9 = context.theme.border.base;
          _v$5 !== _p$.e && (_p$.e = _$setProp(_el$17, "borderColor", _v$5, _p$.e));
          _v$6 !== _p$.t && (_p$.t = _$setProp(_el$19, "fg", _v$6, _p$.t));
          _v$7 !== _p$.a && (_p$.a = _$setProp(_el$27, "fg", _v$7, _p$.a));
          _v$8 !== _p$.o && (_p$.o = _$setProp(_el$29, "fg", _v$8, _p$.o));
          _v$9 !== _p$.i && (_p$.i = _$setProp(_el$35, "borderColor", _v$9, _p$.i));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined,
          i: undefined
        });
        return _el$17;
      })()
    }), null);
    _$insert(_el$13, _$createComponent(Show, {
      get when() {
        return history().length === 0;
      },
      get children() {
        var _el$14 = _$createElement("text");
        _$insert(_el$14, emptyHistoryMessage);
        _$effect((_$p) => _$setProp(_el$14, "fg", context.theme.text.muted, _$p));
        return _el$14;
      }
    }), null);
    _$insertNode(_el$15, _$createTextNode(`s Scope \xB7 t Follow \xB7 r Refresh \xB7 Shift+R Redraw \xB7 e Export JSON \xB7 f Fullscreen \xB7 Esc Close`));
    _$effect((_p$) => {
      var _v$ = context.theme.text.base, _v$2 = context.theme.text.muted, _v$3 = follow(), _v$4 = context.theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$5, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$13, "stickyScroll", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$15, "fg", _v$4, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$;
  })();
}

// cache-rate.ts
function calculateSessionCacheRate(messages) {
  let input = 0;
  let read = 0;
  let write = 0;
  let output = 0;
  let calls = 0;
  for (const message of messages) {
    if (message.type !== "assistant" || !message.tokens) {
      continue;
    }
    input += message.tokens.input;
    read += message.tokens.cache.read;
    write += message.tokens.cache.write;
    output += message.tokens.output;
    calls += 1;
  }
  return {
    calls,
    input,
    output,
    rate: input + read > 0 ? read / (input + read) : undefined,
    read,
    write
  };
}

// tui.tsx
var tui_default = Plugin.define({
  id: "cache-metrics.tui",
  setup(context) {
    const openCacheHistory = () => {
      if (!context.ui.panel.open("cache-metrics.history")) {
        context.ui.toast.show({
          message: "Open a session to view cache history",
          variant: "info"
        });
      }
    };
    const CacheMetrics = (props) => {
      let expanded = false;
      let details;
      let toggleLabel;
      const setDetails = (element) => {
        details = element;
      };
      const setToggleLabel = (element) => {
        toggleLabel = element;
      };
      const toggleExpanded = () => {
        expanded = !expanded;
        if (details) {
          details.visible = expanded;
          details.height = expanded ? "auto" : 0;
        }
        if (toggleLabel) {
          toggleLabel.content = expanded ? "\u25BC Hide additional metrics" : "\u25B6 Show additional metrics";
        }
      };
      const [messages, setMessages] = createSignal2(context.data.session.message.list(props.sessionID) ?? []);
      const refresh = (sessionID) => {
        context.data.session.message.invalidate(sessionID);
        context.data.session.message.sync(sessionID).then(() => {
          if (props.sessionID === sessionID) {
            setMessages(context.data.session.message.list(sessionID) ?? []);
          }
        }).catch(() => {});
      };
      createEffect2(() => {
        const {
          sessionID
        } = props;
        setMessages(context.data.session.message.list(sessionID) ?? []);
        refresh(sessionID);
      });
      const stop = context.data.on("session.execution.succeeded", (event) => {
        if (event.data.sessionID === props.sessionID) {
          refresh(props.sessionID);
        }
      });
      onCleanup2(stop);
      const totals = () => calculateSessionCacheRate(messages());
      const rateColor = () => {
        const rate = totals().rate ?? 0;
        if (rate >= 0.7) {
          return context.theme.text.feedback?.success?.base ?? context.theme.hue.green[500];
        }
        if (rate >= 0.3) {
          return context.theme.text.feedback?.warning?.base ?? context.theme.hue.yellow[500];
        }
        return context.theme.text.muted;
      };
      return (() => {
        var _el$ = _$createElement2("box"), _el$2 = _$createElement2("box"), _el$6 = _$createElement2("box"), _el$7 = _$createElement2("text"), _el$9 = _$createElement2("box"), _el$0 = _$createElement2("box"), _el$1 = _$createElement2("text"), _el$10 = _$createElement2("b"), _el$12 = _$createElement2("text"), _el$13 = _$createTextNode2(` cached`), _el$14 = _$createElement2("box"), _el$15 = _$createElement2("text"), _el$16 = _$createElement2("b"), _el$18 = _$createElement2("text"), _el$19 = _$createElement2("box"), _el$20 = _$createElement2("text"), _el$21 = _$createElement2("b"), _el$23 = _$createElement2("text"), _el$24 = _$createTextNode2(` generated`), _el$25 = _$createElement2("box"), _el$26 = _$createElement2("text"), _el$27 = _$createElement2("b"), _el$29 = _$createElement2("text");
        _$insertNode2(_el$, _el$2);
        _$insertNode2(_el$, _el$6);
        _$insertNode2(_el$, _el$9);
        _$setProp2(_el$, "border", true);
        _$setProp2(_el$, "borderStyle", "rounded");
        _$setProp2(_el$, "flexDirection", "column");
        _$setProp2(_el$, "paddingLeft", 1);
        _$setProp2(_el$, "paddingRight", 1);
        _$setProp2(_el$, "title", "Cache");
        _$setProp2(_el$, "width", "100%");
        _$setProp2(_el$2, "onMouseDown", openCacheHistory);
        _$insert2(_el$2, _$createComponent2(Show2, {
          get fallback() {
            return (() => {
              var _el$30 = _$createElement2("text");
              _$insertNode2(_el$30, _$createTextNode2(`No token usage yet`));
              _$effect2((_$p) => _$setProp2(_el$30, "fg", context.theme.text.muted, _$p));
              return _el$30;
            })();
          },
          get when() {
            return totals().rate !== undefined;
          },
          get children() {
            var _el$3 = _$createElement2("text"), _el$4 = _$createElement2("b"), _el$5 = _$createTextNode2(`% input cache hit`);
            _$insertNode2(_el$3, _el$4);
            _$insertNode2(_el$4, _el$5);
            _$insert2(_el$4, () => ((totals().rate ?? 0) * 100).toFixed(1), _el$5);
            _$effect2((_$p) => _$setProp2(_el$3, "fg", rateColor(), _$p));
            return _el$3;
          }
        }));
        _$insertNode2(_el$6, _el$7);
        _$insertNode2(_el$7, _$createTextNode2(`\u25B6 Show additional metrics`));
        _$use2(setToggleLabel, _el$7);
        _$setProp2(_el$7, "onMouseDown", toggleExpanded);
        _$insertNode2(_el$9, _el$0);
        _$insertNode2(_el$9, _el$14);
        _$insertNode2(_el$9, _el$19);
        _$insertNode2(_el$9, _el$25);
        _$use2(setDetails, _el$9);
        _$setProp2(_el$9, "flexDirection", "column");
        _$setProp2(_el$9, "height", 0);
        _$setProp2(_el$9, "visible", false);
        _$insertNode2(_el$0, _el$1);
        _$insertNode2(_el$0, _el$12);
        _$setProp2(_el$0, "flexDirection", "row");
        _$setProp2(_el$0, "gap", 1);
        _$insertNode2(_el$1, _el$10);
        _$insertNode2(_el$10, _$createTextNode2(`In:`));
        _$insertNode2(_el$12, _el$13);
        _$insert2(_el$12, () => totals().read.toLocaleString(), _el$13);
        _$insertNode2(_el$14, _el$15);
        _$insertNode2(_el$14, _el$18);
        _$setProp2(_el$14, "flexDirection", "row");
        _$setProp2(_el$14, "gap", 1);
        _$insertNode2(_el$15, _el$16);
        _$insertNode2(_el$16, _$createTextNode2(`New:`));
        _$insert2(_el$18, () => totals().input.toLocaleString());
        _$insertNode2(_el$19, _el$20);
        _$insertNode2(_el$19, _el$23);
        _$setProp2(_el$19, "flexDirection", "row");
        _$setProp2(_el$19, "gap", 1);
        _$insertNode2(_el$20, _el$21);
        _$insertNode2(_el$21, _$createTextNode2(`Out:`));
        _$insertNode2(_el$23, _el$24);
        _$insert2(_el$23, () => totals().output.toLocaleString(), _el$24);
        _$insertNode2(_el$25, _el$26);
        _$insertNode2(_el$25, _el$29);
        _$setProp2(_el$25, "flexDirection", "row");
        _$setProp2(_el$25, "gap", 1);
        _$insertNode2(_el$26, _el$27);
        _$insertNode2(_el$27, _$createTextNode2(`Cache writes:`));
        _$insert2(_el$29, () => totals().write.toLocaleString());
        _$effect2((_p$) => {
          var _v$ = context.theme.border.base, _v$2 = context.theme.text.base, _v$3 = context.theme.text.muted, _v$4 = context.theme.text.base, _v$5 = context.theme.text.muted, _v$6 = context.theme.text.base, _v$7 = context.theme.text.muted, _v$8 = context.theme.text.base, _v$9 = context.theme.text.muted, _v$0 = context.theme.text.base, _v$1 = context.theme.text.muted;
          _v$ !== _p$.e && (_p$.e = _$setProp2(_el$, "borderColor", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$, "titleColor", _v$2, _p$.t));
          _v$3 !== _p$.a && (_p$.a = _$setProp2(_el$7, "fg", _v$3, _p$.a));
          _v$4 !== _p$.o && (_p$.o = _$setProp2(_el$1, "fg", _v$4, _p$.o));
          _v$5 !== _p$.i && (_p$.i = _$setProp2(_el$12, "fg", _v$5, _p$.i));
          _v$6 !== _p$.n && (_p$.n = _$setProp2(_el$15, "fg", _v$6, _p$.n));
          _v$7 !== _p$.s && (_p$.s = _$setProp2(_el$18, "fg", _v$7, _p$.s));
          _v$8 !== _p$.h && (_p$.h = _$setProp2(_el$20, "fg", _v$8, _p$.h));
          _v$9 !== _p$.r && (_p$.r = _$setProp2(_el$23, "fg", _v$9, _p$.r));
          _v$0 !== _p$.d && (_p$.d = _$setProp2(_el$26, "fg", _v$0, _p$.d));
          _v$1 !== _p$.l && (_p$.l = _$setProp2(_el$29, "fg", _v$1, _p$.l));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined,
          i: undefined,
          n: undefined,
          s: undefined,
          h: undefined,
          r: undefined,
          d: undefined,
          l: undefined
        });
        return _el$;
      })();
    };
    const removeSidebar = context.ui.slot({
      append: "sidebar.content",
      render: ({
        sessionID
      }) => _$createComponent2(CacheMetrics, {
        sessionID
      })
    });
    const removePanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => _$createComponent2(Show2, {
        get when() {
          return panel.name === "cache-metrics.history";
        },
        get children() {
          return _$createComponent2(CacheHistoryPanel, {
            context,
            panel
          });
        }
      })
    });
    const removeCommand = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          commands: [{
            group: "Cache",
            id: "cache-metrics.history.open",
            palette: true,
            run: openCacheHistory,
            title: "Open cache history"
          }],
          mode: "global"
        }));
        return null;
      }
    });
    return () => {
      removeCommand();
      removePanel();
      removeSidebar();
    };
  }
});
export {
  tui_default as default
};
