# Capture provenance

These are real OpenCode V2.3.0 terminal captures, not mockups. The daemon data is synthetic. No user services, credentials, or prompts appear in the captures.

- Terminal Control, 150 columns by 48 rows, OpenTUI host profile.
- `before.png`: the same disposable session before the plugin was loaded.
- `running.png`: the packaged plugin loaded, with three running daemons.
- `sidebar.png`: a crop of `running.png`, with no other alteration.
- `picker.png`: keyboard picker with explicit Open/Copy labels.
- `copy-demo.mp4`: a recorded click on Copy and the resulting feedback. Terminal Control adds the pointer overlay and caption; the clip runs at 4x speed with a two-second hold on the final feedback.
- The captured implementation's `dist/tui.js` SHA-256 is `8694b945174d8ac19249e537d9b0cc36c76de0459cd3e4a4bf6d8030c8d531e2`.

The test used isolated XDG directories and a fake Mise executable that returned fixtures through the real server process and RPC. A browser launcher stub received the expected HTTP URL. The recorded OSC52 payloads decoded to `localhost:5432` and `smoke/worker`. System browser rendering and physical clipboard delivery were not observed.

Additional local captures covered stale/empty states, narrow-terminal commands, workspace moves, and stopped/changed picker selections. The original recording and test fixture remain under `/tmp/opencode/mise-daemons-smoke-OzBM8r`.

## Explicit Open HTTP enhancement

The `open-http-*` captures show the updated client actions, using a separate synthetic fixture in real OpenCode V2.3.0. `open-http-before.png` is the merged baseline with that same fixture. `open-http-running.png` shows the final sidebar, and `open-http-sidebar.png` crops its sidebar without other alteration. `open-http-picker.png` shows complete targets with long names, and `open-http-narrow.png` shows full-name search in a 100×36 terminal. `open-http-demo.mp4` records clicking Copy and then Open HTTP, at 4× speed with a pointer overlay and a one-second final hold.

The captured `dist/tui.js` SHA-256 is `8c7816dbae172c8173d03df78e9cf0865d5d51f09d48da4dc9d1c14f79e44eff`. Browser launcher logs confirmed `http://localhost:6164/` and `http://[::1]:6164/`; OSC52 payloads preserved the original copy values. Changed-primary and stale-action checks produced no extra dispatches. System browser rendering and physical clipboard delivery were not observed. The original recording and fixtures remain under `/tmp/opencode/mise-http-MFHGXu`.

## Workspace controls and shorter labels

The `controls-*` captures show `Copy | Open` and confirmed workspace Stop All in real OpenCode V2.3.0. The previous `open-http-running.png` is the comparable before state with the same four synthetic daemons.

- `controls-running.png`: final compiled TUI, 150×48, replayed at the recorded `controls-demo-start` marker. `controls-sidebar.png` is an unaltered sidebar crop.
- `controls-confirmation.png`: confirmation names the workspace and keeps data.
- `controls-narrow.png`: confirmation at 100×36 after resize settled.
- `controls-picker.png`: shorter Open labels and complete loopback targets at 100×36.
- `controls-stopped.png`: refreshed empty list with Stop All disabled.
- `controls-demo.mp4`: confirmation, busy state, and refreshed list. The edit removes the wait between clips and adds a two-second confirmation hold and a 1.5-second final hold. Playback is otherwise real time, with a pointer overlay.

The final compiled TUI SHA-256 is `a435cd21ca823da32bf45bdc763b78c223970d2641b46840db30d3925d997dfe`. All stop calls used a fake Mise executable through the real server/RPC. Exact argv was `--yes daemons stop` and cwd was the disposable session workspace. Cancelling, repeat busy clicks, stale/empty clicks, and confirming after a workspace move did not add stop dispatches. An empty-during-confirmation regression dispatched before the guard fix and did not dispatch afterward. Simulated stop failure produced sanitized feedback and a fresh lookup.

The isolated TUI and server were stopped after testing. No user daemons or global settings changed. Browser launcher and OSC52 payloads were checked, but physical browser rendering and clipboard delivery were not observed. Original fixtures, recordings, and additional failure/stale captures remain under `/tmp/opencode/mise-stop-2fTj6m`.
