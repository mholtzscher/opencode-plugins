# Classify

An OpenCode V2 plugin for typed judgments using OpenAI Decisions, TypeSafe AI, Cloudflare Clef, Laya, or Ollama. Its `classify` namespace provides `decide`, which returns measurements without executing decisions. Search and grammar discovery remain unregistered while their value is being evaluated. Their implementations remain in the repository.

Credentials, evidence reads, backend selection, and classification run on the **OpenCode server**, including when clients connect remotely. The TUI adds a backend picker and session status indicator. Setup makes no network calls and downloads no models.

## Quick start

### 1. Install and choose a backend

Install [`@mholtzscher/opencode-classify`](https://www.npmjs.com/package/@mholtzscher/opencode-classify) from npm by merging this entry into your project's `opencode.jsonc` or the global `~/.config/opencode/opencode.jsonc`. `opencode.json` is also supported.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@mholtzscher/opencode-classify",
      "options": {
        "backends": { "default": { "provider": "typesafe" } },
        "defaultBackend": "default",
      },
    },
  ],
}
```

Set `TYPESAFE_API_KEY` in the OpenCode server environment. For a local checkout, use the plugin's directory as `package`, such as `./classify` from this repository's root. Run `bun install` inside `classify/`.

For Git installs, use `github:mholtzscher/opencode-plugins#main::path:classify`. Replace an existing package source rather than loading two copies; keep its options. See [configuration](./docs/CONFIGURATION.md#providers) for other providers, credentials, and local-server setup.

### 2. Ask the agent to classify content

Call `classify_decide` with these arguments. The plugin supplies the model and authentication:

```json
{
  "state": "The deploy has failed twice and production is down.",
  "questions": {
    "urgent": {
      "type": "noul",
      "instructions": "Does this describe an active production incident?"
    },
    "category": {
      "type": "choice",
      "instructions": "What kind of event is described?",
      "criteria": {
        "incident": "An active production failure",
        "maintenance": "Planned maintenance",
        "other": "Neither incident nor maintenance"
      }
    },
    "severity": {
      "type": "score",
      "instructions": "How severe is the reported impact?",
      "criteria": [
        "No user impact",
        "Some users affected",
        "Production unavailable"
      ]
    }
  }
}
```

Put content in `state` and each judgment in `instructions`. Both accept text or structured JSON. A call evaluates 1–64 independent questions against one shared state; use another call when a judgment depends on a prior answer.

### 3. Read the result

The tool returns a structured object. Check `ok` before reading `result.answers`; Code Mode callers should not call `JSON.parse`.

| Type | Answer fields | Interpretation |
| --- | --- | --- |
| `noul` | `noul` | Probability of yes in `[0, 1]`, not a boolean. |
| `choice` | `choice`, `probabilities`, `confidence` | One allowed label and the complete label distribution. |
| `score` | `score`, `scale`, `legend`, `probabilities`, `confidence` | Fractional value on a zero-based rubric. With three levels, `1.6` stays `1.6` on a 0–2 scale. |

Confidence is a provider-native uncertainty metric, not a probability of correctness or a value necessarily comparable across providers. The plugin validates native measurements without rounding, renormalizing, or choosing thresholds. Invalid responses fail as a whole.

See the [tool reference](./docs/TOOL_REFERENCE.md) for criteria rules, complete success/error examples, diagnostics, and parser exports.

## Additional judgment patterns

The bundled `classify-decide` skill provides on-demand examples for retrieval, entity matching, structured judgments, evidence, and coding reviews. No separate installation is needed. These are caller-managed recipes, not automation hooks or executed decisions.

## Switch backends in a session

Configure multiple profiles under `options.backends` and name the default with `options.defaultBackend`. This example is the **options object**, not a complete OpenCode config:

```json
{
  "backends": {
    "hosted": { "provider": "typesafe" },
    "local": { "provider": "ollama", "model": "nimble" }
  },
  "defaultBackend": "local"
}
```

Use the server slash command in the TUI, desktop, or web client:

```text
/classify-backend             Show current selection and profiles
/classify-backend hosted      Select hosted for this session
/classify-backend reset       Clear the override and use the configured default
```

In the TUI command palette, choose **Classify: Select backend**. Choosing the row marked `(default)` clears the override. The sidebar's **Classify** section shows the active session's full profile name, wrapping long names without crowding the prompt footer. The indicator is visible only when the sidebar is open.

Selections persist per session and are shared by connected clients. New sessions, including child sessions, start with the configured default. Switching affects subsequent calls; in-flight calls and retries keep their original backend. There is no automatic failover. See [selection behavior and recovery](./docs/CONFIGURATION.md#session-selection) for details.

## Reuse a named classifier

Define reusable questions under `options.classifiers`, then call with `{ "state": ..., "classifier": "name" }`. A classifier can preset `state`, in which case callers supply only `{ "classifier": "name" }`. See [named classifiers](./docs/TOOL_REFERENCE.md#named-classifiers) for configuration and evidence rules.

The effective tool ID is `classify_decide`. Existing callers of the standalone `classify` tool must switch to `classify_decide`; its payload is unchanged. In Code Mode, discover the `classify` namespace and use the returned operation signature.

## Use files and changes as evidence

Pass explicit references instead of copying source into the call:

```json
{
  "state": {
    "type": "evidence",
    "text": "Check whether this change fixes stale cache entries.",
    "files": [
      "src/cache.test.ts",
      { "path": "src/cache.ts", "offset": 120, "limit": 60 }
    ],
    "diffs": [{ "base": "HEAD", "paths": ["src/cache.ts"] }]
  },
  "questions": {
    "fixes_bug": {
      "type": "noul",
      "instructions": "Does the change fix stale cache entries, with tests?"
    }
  }
}
```

References resolve freshly on the server, relative to the invoking session's directory, using native OpenCode permissions. Git diffs include staged and unstaged tracked changes, but not untracked files. The explicit `type: "evidence"` marker enables resolution; ordinary JSON remains literal data.

File `offset` is 1-based and `limit` counts lines. `files` accepts UTF-8 text, not images. For images, select `openai-decisions` and supply `images: [{ "path": "screenshots/a.png" }]` in the evidence wrapper. Other backends reject images before reading evidence or credentials. See [evidence](./docs/EVIDENCE.md) for image examples, limits, permissions, and Tree-sitter selections.

## Data and actions

Classification sends submitted or explicitly resolved state, questions, and the configured model to the selected backend. Calls may incur API charges. The plugin does not gather conversation history, fetch embedded URLs, or execute decisions. Normal OpenCode history may retain tool inputs, outputs, and native evidence previews. Classify saves backend selections but has no classification cache, telemetry, history database, or audit store.

Image bytes go to OpenAI as inline data URLs, without image-reference paths. Paths in file, code, and diff evidence or ordinary text keep their existing behavior. Classify excludes image bytes and data URLs from its output, logs, progress metadata, and storage. Normal OpenCode history can still contain input paths and native image previews. Before relying on a runtime's preview behavior, run [real-host image checks](./docs/SMOKE_TESTING.md#image-evidence-on-a-real-host).

Credentials come from a server-side environment variable or private key file and are resolved at invocation time. Key contents and file-read errors never appear in tool output. High confidence does not authorize another tool; normal OpenCode permissions govern subsequent actions.

## Further reading

| Guide | Contents |
| --- | --- |
| [Configuration](./docs/CONFIGURATION.md) | Provider profiles, credentials, local servers, option limits, session selection |
| [Tool reference](./docs/TOOL_REFERENCE.md) | Input and output contracts, named classifiers, errors, parser, RPC |
| [Evidence](./docs/EVIDENCE.md) | Images, UTF-8 files, Git diffs, Tree-sitter queries, permissions, size limits |
| [Search](./docs/SEARCH.md) | Retained experimental implementation; tool registration is disabled |
| [Development](./docs/DEVELOPMENT.md) | Architecture, adding providers, automated verification |
| [Smoke testing](./docs/SMOKE_TESTING.md) | Safe disposable-project checks and real-host image validation |
| [Code-evidence validation](./experiments/README.md) | Grammar compatibility, real-host checks, runtime and model comparisons |
