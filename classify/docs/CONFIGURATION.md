# Classify configuration

[Back to README](../README.md)

Use the [installation example](../README.md#quick-start) for the full OpenCode configuration. Provider examples below are **single backend profiles**: place one at `options.backends.<name>` and set `options.defaultBackend` to that name.

## Shared options

| Option | Default | Constraints |
| --- | --- | --- |
| `backends` | Required | 1–32 named provider profiles |
| `defaultBackend` | Required | Must name a configured profile |
| `classifiers` | None | Up to 32 [named classifiers](./TOOL_REFERENCE.md#named-classifiers) |
| `timeoutMs` | `30000` | Integer from 1,000 to 300,000 |
| `maxRetries` | `1` | 0–2 retries after the first attempt; `0` disables retries |
| `search` | Bounded defaults | Retained [search budgets and exclusions](./SEARCH.md#configuration); the search tool is currently unregistered |

Profile names, classifier names, and question IDs match `^[A-Za-z][A-Za-z0-9_-]{0,63}$`. The profile name `reset` is reserved. Profiles may use the same provider with different models, endpoints, accounts, or credential sources. Classifiers, timeout, and retry settings are shared across profiles.

Both `backends` and `defaultBackend` are required even with one profile. No provider is inferred from available keys. The former single-`backend` configuration is rejected; migrate it to a named entry under `backends`. The former `kev` provider name is also rejected; use `laya` with a Laya endpoint and checkpoint name.

Unknown option fields, including literal credentials, fail setup with a sanitized `INVALID_CONFIG` error. Options are an immutable setup snapshot: reload the plugin after editing them. Switching between configured profiles and rotating credentials do not require a reload.

## Credentials

Credentials must be available on the **OpenCode server**, not a remote TUI machine. Choose either `apiKeyEnv` or `apiKeyFile`, never both. `apiKeyEnv` names an environment variable, not a literal key; its value must be present and nonblank when invoked.

To use a key file instead of a provider's default environment variable:

```json
{
  "provider": "typesafe",
  "apiKeyFile": "~/.config/opencode/typesafe.key"
}
```

- Put only the key in the file, not JSON or an `export` statement. Surrounding whitespace and a final newline are trimmed.
- Use a private file outside the repository, for example with `chmod 600 ~/.config/opencode/typesafe.key`.
- Paths must be absolute or start with `~/`, relative to the server user's home. Project-relative and `~otheruser` paths are rejected.
- The file must be a readable regular UTF-8 file of at most 16 KiB, containing one nonblank key without internal whitespace or control characters. Symlinks to regular files are accepted.
- Selecting a file disables the default environment source, with no fallback. Files are read at each invocation, never during setup, so rotation needs no reload.
- Missing, unreadable, empty, oversized, or malformed files return sanitized `MISSING_CREDENTIALS` before HTTP.

All implemented providers support both credential sources. Capability preflight runs before credential reads.

## Providers

### TypeSafe AI

```json
{ "provider": "typesafe" }
```

Set `TYPESAFE_API_KEY` in the server environment or select another credential source. The endpoint is fixed at `https://api.typesafe.ai/v1/systemone`; the model defaults to `jev-latest`. To pin a model, set `model` to an exact ID documented by TypeSafe and available to your account. Illustrative response versions in these docs are not promises of model availability.

### Cloudflare Clef

```json
{
  "provider": "cloudflare",
  "accountID": "0123456789abcdef0123456789abcdef",
  "model": "clef"
}
```

Replace `accountID` with your 32-character hexadecimal Cloudflare account ID. Set `CLOUDFLARE_AUTH_TOKEN` on the server to an API token with Workers AI permission for that account, or select another credential source.

The model defaults to `clef`; `clef-flash` is the only other accepted selector. The plugin sends the selector in the body, chooses the matching fixed Workers AI REST endpoint, and unwraps the `success`/`result` envelope before validating native measurements. Results report `provider: "cloudflare"`; a validated `cf-ray` header becomes `requestID`.

The plugin supports text and structured JSON, not Clef's separate image input extension. Cloudflare documents a 65,536-token context window and truncation of long text. The plugin's byte limit does not guarantee that an input fits this window. An explicit `truncated: true` result fails with `INPUT_TRUNCATED`, but absence of that marker does not prove full input coverage. See the [Clef documentation](https://developers.cloudflare.com/workers-ai/models/clef/).

### Ollama

Install [Ollama 0.35 or later](https://ollama.com/download), run `ollama pull nimble`, and start its server separately:

```json
{ "provider": "ollama" }
```

Defaults are `http://127.0.0.1:11434`, model `nimble`, and no authorization header. Requests go to `/v1/systemone`. Set `model` to another installed decision-model tag, such as `nimble:9b`. For another server, set `baseURL` to its origin using the [origin rules](#local-server-origins). If it requires a bearer token, set `apiKeyEnv` or `apiKeyFile`.

The address resolves from the OpenCode server. The plugin does not start Ollama or pull models. Increase the shared `timeoutMs` if cold model loads exceed the default 30 seconds.

Ollama's Nimble endpoint accepts up to **26 choice options** and a **64 KiB request body**, tighter than the plugin's general limits. Use string descriptions for score criteria: Ollama 0.35.0 rejects structured score descriptions with HTTP 400. The plugin preserves question content rather than converting it to strings. Oversized or unsupported requests may return `REQUEST_REJECTED`. Results report `provider: "ollama"`; test confidence thresholds on your own data.

### Laya

For an unauthenticated loopback server:

```json
{ "provider": "laya", "baseURL": "http://127.0.0.1:8000" }
```

Defaults are `http://127.0.0.1:8000`, model `english`, and no authorization header. Laya serves `/v1/systemone`; results report `provider: "laya"`. Other checkpoint names include `multilingual` and `typed-decisions`.

For authenticated local Laya, add `apiKeyEnv: "LAYA_API_KEY"` and set matching key values for Laya and OpenCode. For a self-hosted server behind HTTPS:

```json
{
  "provider": "laya",
  "baseURL": "https://laya.example.com",
  "apiKeyEnv": "COMPANY_LAYA_API_KEY"
}
```

Replace the origin, expose `/v1/systemone` without redirects, and set the named variable on the OpenCode server. A shared `timeoutMs` of `120000` can accommodate slower local inference; set `maxRetries: 0` to disable retries.

Laya's confidence semantics differ from Jev's. Choice questions have a **100-option HTTP cap** and smaller practical token budgets, and long states can be silently truncated. The plugin does not expose Laya's token-budget controls or extra confidence and routing metadata. Keep inputs short and validate accuracy and thresholds on your own examples. An explicit `truncated: true` response fails with `INPUT_TRUNCATED`; a missing marker does not prove full input coverage.

#### Start Laya with mise

From this repository's root, with mise 2026.9.18 or later:

```sh
mise daemons start laya
mise run opencode
```

Configure a Laya profile before launching OpenCode; starting the daemon does not change the selected backend. The root `mise.toml` uses Pitchfork to supervise Laya 0.3.22 on `http://127.0.0.1:8000`. First start uses uv to install `laya[serve]` in a cached Python 3.12 environment and downloads the English checkpoint from Hugging Face. PyTorch's backend is selected automatically. Startup allows up to 20 minutes for installation and model loading. No API key is configured; the listener is loopback-only.

```sh
mise daemons status laya
mise daemons logs laya
mise daemons stop laya
```

The daemon stays running after OpenCode exits; stop it explicitly when finished. This setup does not enable login startup or shell-entry autostart.

#### Start Laya manually

Use [Laya's HTTP server](https://github.com/NandhaKishorM/laya):

```sh
LAYA_HOST=127.0.0.1 LAYA_PORT=8000 LAYA_MODELS=english uv tool run --python 3.12 --torch-backend=auto --from 'laya[serve]==0.3.22' laya-serve
```

The first run installs dependencies and downloads weights. Checkpoint, hardware, precision, and runtime requirements belong to the operator. Set `LAYA_HOST=127.0.0.1` explicitly because Laya otherwise binds to all interfaces. For authentication, set `LAYA_API_KEY` on Laya and give OpenCode the same key through its configured credential source.

`model` selects a checkpoint per request. `LAYA_MODELS` controls preloading, not which checkpoints clients can select. Unknown names fall back to automatic routing, so check names carefully. The response's model string does not identify immutable weights; inspect `GET /health` for loaded checkpoints, revisions, and actual devices.

The plugin never installs Python, downloads weights, starts or stops Laya, exposes a listener, or polls for readiness. A stopped server produces a sanitized network error.

### OpenAI Decisions

```json
{ "provider": "openai-decisions" }
```

Defaults are model `gpt-6-luna` and credential variable `OPENAI_API_KEY`. You can instead set `apiKeyEnv` or `apiKeyFile`, using the same credential rules as TypeSafe. Profiles are selectable through the picker and slash command.

The [Decisions API](https://developers.openai.com/api/docs/guides/decisions) is in public beta and currently supports only `gpt-6-luna`. The plugin sends bearer-authenticated requests to `https://api.openai.com/v1/decisions`, never Chat Completions or Responses. A configured `model` is passed unchanged; unsupported models produce `REQUEST_REJECTED`, with no fallback.

The adapter maps `noul` to a native `predicate`, choice criteria to `choices`, and score criteria to ordered `levels`. Strings remain text; structured state, instructions, and descriptions are JSON-serialized. Optional yes/no criteria are appended to predicate instructions. Score levels use their zero-based indices as wire labels; returned indices and labels are validated before restoring the original structured legend. Native probabilities, confidence, fractional scores, and reported token usage remain unchanged. Refusals fail the entire call with sanitized `INVALID_RESPONSE`, without partial answers.

OpenAI Decisions is the only image-capable backend in this plugin. Supply explicit [local image evidence](./EVIDENCE.md#images), including image-only or named preset evidence. The adapter sends inline base64 data URLs in ordered user-message image parts. Text-only calls retain string input. Hosted URLs, `file_id`, caller-supplied inline bytes, GIF/animation, resizing, OCR preprocessing, automatic conversation attachments, and image search are not supported. Other profiles return `UNSUPPORTED_INPUT` before any evidence or credential reads, with no failover.

Image limits are fixed, not profile options: four references, 4 MiB per image, 8 MiB aggregate raw bytes, and 13 MiB for the complete encoded image request. Public input, resolved non-image state/questions, text-only requests, and responses retain 1 MiB bounds. The image resolver has its own 30-second deadline including permission waits; `timeoutMs` applies to provider transport. Pending descriptor operations and cleanup can extend the image deadline. Increasing `timeoutMs` does not increase image budgets or the image-resolution deadline.

Image-reference paths stay local to resolution; file/code/diff paths and paths supplied in text keep their old behavior. Native `read` permissions and external-directory approvals still apply. Classify stores no images, but ordinary OpenCode history may retain paths and native previews. Explicit image calls send image bytes to OpenAI and may incur charges. Verify the pinned runtime using the opt-in [smoke procedure](./SMOKE_TESTING.md#image-evidence-on-a-real-host).

## Local-server origins

For Laya and Ollama, `baseURL` must be an HTTP or HTTPS origin with an optional trailing slash: no API path, user information, query, or fragment. HTTP is allowed only for `localhost`, `127.0.0.1`, and `[::1]`; other origins require HTTPS. These checks do not protect against malicious operator configuration or DNS changes. Redirects are forbidden.

## Session selection

Use [`/classify-backend` or the TUI picker](../README.md#switch-backends-in-a-session) to switch profiles without reloading or making a provider call. Switching executes on the server without an LLM turn. Confirmation is recorded in the session; the TUI picker also shows a toast. Desktop and web use the slash command; there is no custom picker for those clients.

- Overrides persist in server plugin storage and are shared by clients connected to the same session. Reopening a session preserves its override; new and child sessions use the configured default.
- Each invocation captures its backend. In-flight evidence reads, HTTP calls, and retries keep that backend even if selection changes. Results include `result.backend` or `error.backend` when selection succeeds.
- The TUI status follows the active session and updates after picker/slash changes, changes from other clients, and reconnects. `…` means loading; `unavailable` means selection could not be read. This reports selection, not provider health.
- There is no automatic failover or liveness probing. A configured profile does not imply a running server or available credentials.
- Removing an overridden profile makes classification fail until you select another profile or reset. It never silently sends evidence to the default. The picker still opens for recovery; choosing the configured default clears the override. Other selection-read failures stop the picker without changing selection.
- Credentials are resolved only at invocation and are not exposed through picker/RPC metadata. See the [RPC reference](./TOOL_REFERENCE.md#backend-selection-rpc) for client integration.

## Repository development configuration

The root [`opencode.jsonc`](../../opencode.jsonc) defaults to `ollama-nimble` and also configures `ollama-clef-flash`, `cloudflare-clef`, `cloudflare-clef-flash`, and `typesafe-jev-latest`. Hosted profiles contain operator-specific account and server-local key-file settings; replace them for another operator. Shared settings use `timeoutMs: 120000` and `maxRetries: 0`.

`mise run opencode` launches OpenCode with this configuration but does not start inference servers. Pull the selected Ollama model and start Ollama separately. To use Laya, add a Laya profile and start its server separately.
