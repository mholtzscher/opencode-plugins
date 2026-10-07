# Classify

An OpenCode V2 plugin for typed judgments and bounded semantic file search using OpenAI Decisions, TypeSafe AI, Cloudflare Clef, Laya, or Ollama. Its `classify` namespace provides `decide`, `search`, and `grammar`. It returns measurements and source references; it does not execute decisions.

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

Set `TYPESAFE_API_KEY` in the OpenCode server environment. For a local checkout, use the plugin's directory as `package` (for example, `./classify` from this repository's root) and run `bun install` inside `classify/`.

To add the package globally with the CLI, run:

```sh
opencode plugin add @mholtzscher/opencode-classify
```

Then edit its config entry to include the backend options shown above. If switching from Git or a local checkout, replace the existing entry's `package` value and keep its options.

Use `@mholtzscher/opencode-classify@1.0.1` to pin a version. To install from Git, use `"package": "github:mholtzscher/opencode-plugins#main::path:classify"`. Both sources export the server and TUI entries.

To use another provider, replace `backends.default` with a profile from the [configuration guide](./docs/CONFIGURATION.md):

| Provider | Default model | Setup |
| --- | --- | --- |
| [OpenAI Decisions](./docs/CONFIGURATION.md#openai-decisions) | `gpt-6-luna` | Server-side API key |
| [TypeSafe AI](./docs/CONFIGURATION.md#typesafe-ai) | `jev-latest` | Server-side API key |
| [Cloudflare Clef](./docs/CONFIGURATION.md#cloudflare-clef) | `clef` | Account ID and Workers AI token |
| [Ollama](./docs/CONFIGURATION.md#ollama) | `nimble` | Ollama 0.35+, model pulled, server running |
| [Laya](./docs/CONFIGURATION.md#laya) | `english` | Separately managed Laya HTTP server |

OpenAI Decisions is in public beta. It uses the dedicated `/v1/decisions` endpoint, with no chat or Responses fallback. Currently, OpenAI supports only `gpt-6-luna` on that endpoint.

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

In the TUI command palette, choose **Classify: Select backend**. Choosing the row marked `(default)` clears the override. The bottom status row shows `classify: <profile>` for the active session.

Selections persist per session and are shared by connected clients. New sessions, including child sessions, start with the configured default. Switching affects subsequent calls; in-flight calls and retries keep their original backend. There is no automatic failover. See [selection behavior and recovery](./docs/CONFIGURATION.md#session-selection) for details.

## Reuse a named classifier

Add reusable questions under `options.classifiers`:

```json
{
  "incident-triage": {
    "description": "Check whether a report describes an active production incident.",
    "questions": {
      "active": {
        "type": "noul",
        "instructions": "Does state.message describe an active production incident?"
      }
    }
  }
}
```

Then call:

```json
{
  "state": { "message": "Production is down after the deploy." },
  "classifier": "incident-triage"
}
```

Named classifiers use their configured questions unchanged. They can also define a preset `state`, in which case callers supply only `{ "classifier": "name" }`. See [named classifiers](./docs/TOOL_REFERENCE.md#named-classifiers) for preset evidence and state rules.

## Find relevant files

Call `classify_search` to rank files without copying their source into the agent's context:

```json
{
  "query": "Where are failed requests retried with backoff?",
  "paths": ["src", "tests"],
  "terms": ["retry", "backoff"],
  "maxFiles": 16,
  "limit": 5
}
```

Search works outside Git and evaluates bounded file prefixes. Optional terms match those prefixes with case-insensitive literal OR matching. Results include paths, actual line ranges, relevance, failures, coverage, and effective budgets. Check coverage before interpreting an empty or low-scoring result. Configure the limits under `options.search`; see the [search guide](./docs/SEARCH.md).

The effective tool IDs are `classify_decide`, `classify_search`, and `classify_grammar`. Existing callers of the standalone `classify` tool must switch to `classify_decide`; its payload is unchanged. In Code Mode, discover the `classify` namespace and use the returned operation signatures.

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

File objects accept a 1-based `offset` and a line-count `limit`; the example selects lines 120 through 179. Omit both to read the whole file. Partial reads support sources larger than 1 MiB while keeping selected evidence within the request budget.

`files` accepts UTF-8 text, not images. For local image evidence, select an `openai-decisions` backend and use explicit `images` references:

```json
{
  "state": {
    "type": "evidence",
    "text": "Compare image 1 with image 2.",
    "images": [
      { "path": "screenshots/before.png" },
      { "path": "screenshots/after.png" }
    ]
  },
  "questions": {
    "fixed": {
      "type": "noul",
      "instructions": "Is the overlapping text in image 1 absent from image 2?"
    }
  }
}
```

Image-only evidence is also valid. Array order defines image 1, image 2, and so on; duplicate references remain separate. PNG, JPEG, and static WebP are supported, with up to four images, 4 MiB per image, and 8 MiB total raw bytes. Formats are checked from bytes, not extensions. Images use the same native `read` permissions as text evidence. Other backends reject images with `UNSUPPORTED_INPUT` before reading evidence or credentials. No URLs, inline image bytes, animation, resizing, or automatic chat-attachment collection are supported.

The [evidence guide](./docs/EVIDENCE.md) covers image and text budgets, file and diff limits, Tree-sitter code selections, and the `classify_grammar` discovery tool.

## Data and actions

Classification sends supplied or explicitly resolved state to the selected backend. Search sends bounded prefixes from files discovered under the supplied paths. Both send questions and the configured model and may incur API charges. The plugin does not gather conversation history, fetch embedded URLs, or execute decisions. Normal OpenCode history may retain tool inputs, outputs, and native evidence previews. Backend selections are persisted, but there is no additional classification cache, telemetry, history database, or audit store.

Explicit image bytes go to OpenAI as inline data URLs. The plugin does not send image-reference paths to the provider; existing file/code/diff references and paths written into text retain their old behavior. Image bytes and data URLs do not appear in Classify output, logs, progress metadata, or plugin storage. This does not remove normal OpenCode history: public tool inputs contain paths, and native `read` may retain image previews. Check [the live smoke procedure](./docs/SMOKE_TESTING.md#image-evidence-on-a-real-host) before relying on a runtime's preview behavior.

Credentials come from a server-side environment variable or private key file and are resolved at invocation time. Key contents and file-read errors never appear in tool output. High confidence does not authorize another tool; normal OpenCode permissions govern subsequent actions.

## Further reading

| Guide | Contents |
| --- | --- |
| [Configuration](./docs/CONFIGURATION.md) | Provider profiles, credentials, local servers, option limits, session selection |
| [Tool reference](./docs/TOOL_REFERENCE.md) | Input and output contracts, named classifiers, errors, parser, RPC |
| [Evidence](./docs/EVIDENCE.md) | Images, UTF-8 files, Git diffs, Tree-sitter queries, permissions, size limits |
| [Search](./docs/SEARCH.md) | File ranking, configurable work budgets, partial results, coverage |
| [Development](./docs/DEVELOPMENT.md) | Architecture, adding providers, automated verification |
| [Smoke testing](./docs/SMOKE_TESTING.md) | Disposable fixtures, live checks, verification history |
| [Code-evidence validation](./experiments/README.md) | Grammar compatibility, real-host checks, runtime and model comparisons |
