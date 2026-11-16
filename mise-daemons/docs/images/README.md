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
