# Classify

One server-side `classify` tool for bounded judgments. TypeSafe AI and an externally managed Kev HTTP server use the verified System One contract. OpenAI Decisions is **unavailable** until its documented API adapter is implemented. There is no chat or Responses fallback.

The TUI entry is a no-op. Credentials and classification run on the OpenCode server, including when the TUI connects remotely. Setup makes no network calls and downloads no models.

## Install and configure

Merge one of the following plugin entries into your existing `plugins` array. Do not replace unrelated settings. A local checkout uses `"package": "./classify"`; install its dependencies with `bun install` from `classify/`. For installation from GitHub, replace that package value with:

```text
github:mholtzscher/opencode-plugins#main::path:classify
```

The repository's root configuration activates this plugin with TypeSafe AI. Set `TYPESAFE_API_KEY` in the OpenCode server environment before invoking it.

### Hosted TypeSafe

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "./classify",
    "options": { "backend": { "provider": "typesafe" } }
  }]
}
```

Set `TYPESAFE_API_KEY` in the server environment. The model defaults to `jev-latest`. To pin a model, set `backend.model` to an exact ID documented by TypeSafe and available to your account. The illustrative response below is not a promise that its model version is available.

#### Use a key file instead

Replace the `backend` object with:

```json
{
  "provider": "typesafe",
  "apiKeyFile": "~/.config/opencode/typesafe.key"
}
```

The file must contain only the key, not JSON or an `export` statement. Surrounding whitespace and a final newline are trimmed. Use a private file outside the repository and restrict access with `chmod 600 ~/.config/opencode/typesafe.key`.

`apiKeyFile` accepts an absolute path or a `~/` path relative to the OpenCode server user's home directory. Relative project paths and `~otheruser` paths are rejected. The file must exist on the server, not the remote TUI machine. It must be a readable regular UTF-8 file of at most 16 KiB containing one nonblank key without internal whitespace or control characters. Symlinks to regular files are permitted.

Choose either `apiKeyFile` or `apiKeyEnv`, never both. Selecting a file disables the default environment source and never falls back to it. The plugin reads the file at each invocation, so key rotation does not require a reload. It never reads the file during setup. Missing, unreadable, empty, oversized, or malformed files return sanitized `MISSING_CREDENTIALS` errors before HTTP. Kev also accepts `apiKeyFile`. OpenAI accepts the option but its unavailable adapter never opens it.

### Unauthenticated loopback Kev

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "./classify",
    "options": {
      "backend": { "provider": "kev", "baseURL": "http://127.0.0.1:8009" },
      "classifiers": {
        "incident-triage": {
          "description": "Check whether a report describes an active production incident.",
          "questions": {
            "active": { "type": "noul", "instructions": "Does state.message describe an active production incident?" }
          }
        }
      }
    }
  }]
}
```

This sends no authorization header and uses `kev-latest`. Start Kev separately before invoking the tool.

### Authenticated local Kev

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "./classify",
    "options": {
      "backend": {
        "provider": "kev",
        "baseURL": "http://127.0.0.1:8009",
        "model": "kev-latest",
        "apiKeyEnv": "KEV_API_KEY"
      },
      "timeoutMs": 120000,
      "maxRetries": 0,
      "classifiers": {
        "change-kind": {
          "description": "Categorize a code-change summary into one allowed label.",
          "questions": {
            "kind": {
              "type": "choice",
              "instructions": "Which category best describes this change?",
              "criteria": {
                "bugfix": "Corrects existing behavior",
                "feature": "Adds a new capability",
                "maintenance": "Upkeep without a behavior change",
                "unknown": "Insufficient evidence"
              }
            }
          }
        },
        "incident-triage": {
          "description": "Assess whether a report describes an incident and rate its impact.",
          "questions": {
            "active": { "type": "noul", "instructions": "Does this report describe an active production incident?" },
            "impact": {
              "type": "score",
              "instructions": "Rate the user impact described in the report.",
              "criteria": ["No user impact", "Some users affected", "Production unavailable"]
            }
          }
        }
      }
    }
  }]
}
```

Set matching `KEV_API_KEY` values for the Kev process and the OpenCode server. `apiKeyEnv` names an environment variable; it is not a literal key. The longer deadline allows slower local inference. `maxRetries: 0` disables automatic retries.

### Self-hosted Kev behind HTTPS

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "./classify",
    "options": {
      "backend": {
        "provider": "kev",
        "baseURL": "https://kev.example.com",
        "apiKeyEnv": "COMPANY_KEV_API_KEY"
      },
      "timeoutMs": 60000,
      "maxRetries": 0
    }
  }]
}
```

Replace the origin and set the named variable on the OpenCode server. Expose `/v1/systemone` without redirects. `baseURL` must be an HTTP or HTTPS origin with an optional trailing slash, no API path, user information, query, or fragment. HTTP is allowed only for `localhost`, `127.0.0.1`, and `[::1]`; other origins require HTTPS. These checks do not protect against malicious operator configuration or DNS changes.

### Reserved OpenAI Decisions

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "./classify",
    "options": { "backend": { "provider": "openai-decisions" } }
  }]
}
```

This registers the tool but returns `PROVIDER_UNAVAILABLE` on valid invocations without credential lookup or HTTP. `OPENAI_API_KEY` is reserved; no model default is defined. See the [implementation gate](../specs/classify-tool-plugin.md#openai-implementation-gate) before adding a real adapter.

### Option limits

`backend` is required. No provider is inferred from available keys. TypeSafe uses the fixed `https://api.typesafe.ai/v1/systemone` endpoint. Kev defaults to `http://127.0.0.1:8009`, `kev-latest`, and no authentication. If `apiKeyEnv` is configured, its server-side value must be present and nonblank at invocation time. Alternatively, configure `apiKeyFile` as described above.

`timeoutMs` defaults to 30,000 and accepts integers from 1,000 to 300,000. `maxRetries` defaults to 1 and accepts 0–2 retries after the first attempt. Up to 32 named classifiers are allowed. Each has a nonblank description of at most 512 characters and a valid question map. Names and question IDs match `^[A-Za-z][A-Za-z0-9_-]{0,63}$`. Unknown option fields, including literal credentials, fail setup with a sanitized `INVALID_CONFIG` error. Options are an immutable snapshot; reload the plugin after changes. There is no plugin storage.

## Tool contract

The server entry uses `Plugin.define({ id: "classify", setup })` and `ctx.tool.transform(editor => editor.add(...))`. The concrete registration is in [`index.ts`](./index.ts); the full generated JSON Schema and runtime validators are in [`schema.ts`](./schema.ts). Its definition is:

```ts
{
  name: "classify",
  description, // Includes configured names and descriptions.
  input: buildToolInputSchema(options.classifiers ?? {}),
  execute: async (input, context) => ({
    content: JSON.stringify(await service.classify(input, context.signal)),
  }),
}
```

Tool arguments are exactly one of `{ state, questions }` or `{ state, classifier }`, never both. Without named classifiers only the ad hoc branch is advertised. The named branch enumerates configured names. Both reject extra fields. Tool arguments cannot override backend, endpoint, model, credentials, or headers.

Put content to evaluate in `state` and the judgment in each question's `instructions`. Both accept nonblank strings, nonempty JSON objects, or nonempty JSON arrays. `state` also supports the explicit evidence wrapper below, which reads files and generates Git diffs on the server. Nested JSON permits null, booleans, and finite numbers. Question IDs are response keys, not model instructions. Each call evaluates 1–64 independent questions against one shared state. For judgments depending on prior answers, make another call.

| Type | Criteria | Native result |
| --- | --- | --- |
| `noul` | Optional object containing `true`, `false`, or both, with nonempty descriptions | `noul` is the probability of yes in `[0, 1]`, not a boolean. No invented confidence. |
| `choice` | Map of 2–255 distinct nonblank labels, at most 128 characters each, to descriptions or null; alternatively a list of `{ label, description }` entries | One allowed `choice`, the exact label distribution, and native `confidence`. |
| `score` | Ordered array of 2–10 nonempty level descriptions | Fractional `score` in `[0, levels.length - 1]`, the upstream legend, distribution, and native `confidence`. |

Descriptions accept the same content shapes as instructions. The choice/score limits are conservative shared plugin rules. Confidence is not a probability of correctness. Distributions must match all requested labels or indices and have absolute sum error below `0.02`; the plugin never renormalizes, rounds, thresholds, or rescales values. Missing required native measurements, mismatched IDs/types, invalid usage or legends fail the entire result. No partial answers escape. Reported Kev truncation fails with `INPUT_TRUNCATED`; a missing marker does not prove an arbitrary server never truncates.

Score legends preserve native nonblank strings, nonempty objects, and nonempty arrays rather than converting structured descriptions to strings. The legend must contain exactly the requested zero-based level indices; null, primitive booleans/numbers, and empty descriptions are rejected.

Options and inputs have a bounded JSON traversal, at most 32 levels deep. The serialized System One request and streamed response body are limited to 1 MiB.

## Usage

These JSON blocks are tool arguments, not provider HTTP requests. The plugin adds model and authentication.

### Yes/no probability

```json
{
  "state": "Please cancel my subscription and refund the last payment.",
  "questions": {
    "refund_requested": {
      "type": "noul",
      "instructions": "Does the customer explicitly request a refund?",
      "criteria": { "true": "The customer asks to receive money back", "false": "The customer does not ask to receive money back" }
    }
  }
}
```

Read `result.answers.refund_requested.noul` as a number. The tool does not authorize or issue a refund.

### One allowed label

```json
{
  "state": { "title": "Fix stale cache after deploy", "files": ["cache.ts", "cache.test.ts"] },
  "questions": {
    "change_kind": {
      "type": "choice",
      "instructions": "Which category best describes this change?",
      "criteria": { "bugfix": "Corrects existing behavior", "feature": "Adds a new capability", "maintenance": "Refactoring or upkeep without a behavior change", "unknown": "The supplied evidence is insufficient" }
    }
  }
}
```

`unknown` is a caller-defined label, not an automatic low-confidence fallback.

Choice criteria also accept a transport-safe entry list:

```json
{
  "state": "Production is down.",
  "questions": {
    "kind": {
      "type": "choice",
      "instructions": "Select __proto__ for a production outage, constructor otherwise.",
      "criteria": [
        { "label": "__proto__", "description": "Production outage" },
        { "label": "constructor", "description": null }
      ]
    }
  }
}
```

Use this form for labels such as `__proto__`: the current OpenCode Code Mode object transport cannot preserve that label as an object key. The plugin safely converts entry lists to the backend's native criteria map using own properties, retaining the original label in answers and probabilities. Both `label` and `description` are required; descriptions may be null. Duplicate labels and unknown entry fields fail input validation. Ordinary criteria maps remain supported, and named classifier definitions may use either form. The list form works around the upstream object-key transport issue; it does not repair Code Mode's map transport itself.

### Fractional rubric score

```json
{
  "state": "The checkout endpoint times out for about half of our customers.",
  "questions": {
    "impact": {
      "type": "score",
      "instructions": "Rate the user impact described in this report.",
      "criteria": ["No user impact", "Some users affected", "Most users cannot complete the task"]
    }
  }
}
```

An illustrative `1.6` remains `1.6` on the zero-based scale 0–2, not a percentage.

### Several independent judgments

```json
{
  "state": "The deploy has failed twice and production is down.",
  "questions": {
    "urgent": { "type": "noul", "instructions": "Does this describe an active production incident?" },
    "category": { "type": "choice", "instructions": "What kind of event is described?", "criteria": { "incident": "An active production failure", "maintenance": "Planned maintenance", "other": "Neither incident nor maintenance" } },
    "severity": { "type": "score", "instructions": "How severe is the reported impact?", "criteria": ["No user impact", "Some users affected", "Production unavailable"] }
  }
}
```

### Named classifier

```json
{ "state": { "message": "Production is down after the deploy." }, "classifier": "incident-triage" }
```

Named mode sends the stored questions unchanged. The caller cannot override them. With the authenticated Kev example, `{ "state": "Fix stale cache after deploy", "classifier": "change-kind" }` also works.

### Files and diffs as first-class evidence

```json
{
  "state": {
    "type": "evidence",
    "text": "Check whether this change fixes stale cache entries.",
    "files": ["src/cache.ts", "src/cache.test.ts"],
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

The agent passes references, not file contents. The plugin expands them to `{ text, files: [{ path, content }], diffs: [{ base, paths?, content }] }` before calling the configured backend. Named classifiers support the same wrapper. `text`, `files`, and `diffs` are individually optional; supply at least one. `text` accepts the usual string/object/array content. The marker `type: "evidence"` is required so existing arbitrary JSON (including objects with a `files` key) remains inert. That marker is reserved at the top level of `state`; wrap literal data containing it under `text`.

File paths resolve relative to the invoking session's current directory, not the plugin's setup directory or the TUI machine. Absolute file paths are also accepted. File reads use the canonical path for native `read` permission checks, including external-directory approval. Symlinks are resolved before approval. Up to 64 files are allowed, and each must be a regular UTF-8 text file; missing files, directories, binary data, invalid UTF-8, and oversized evidence fail without a provider request. No glob expansion, URL fetching, or implicit file discovery occurs.

Each of up to 16 diffs requires a Git revision `base` (for example `HEAD` or a commit ID). It compares that revision with the **tracked working tree**, incorporating both staged and unstaged changes; it excludes untracked files. Deleted files are included. Optional `paths` selects up to 64 literal paths relative to the session directory and cannot escape it; omit `paths` for all tracked changes in the session's Git scope. Git runs in the session directory with native `shell` permissions. Git pathspec magic, external diff commands, text conversion, pagers, and filesystem-monitor commands are disabled. Binary diffs fail rather than silently omitting their contents.

The current plugin API exposes no standalone permission-request primitive. The resolver invokes the registered native `read`/`shell` executors before doing its own bounded file/Git read; native display previews are discarded because they can truncate. This means reads/diff generation happen twice internally, not twice in the agent's context. If a required native tool is missing or denies access, resolution fails closed. Diff access follows `shell` policy, just like running `git diff` directly; it does not enforce per-file `read` rules on Git's output. Use a narrow shell policy for repositories containing sensitive history.

The fully expanded serialized provider request still has the 1 MiB limit, including JSON escaping, questions, and model. Evidence is never silently truncated. File/Git/permission failures return sanitized `EVIDENCE_ERROR`; expanded JSON that exceeds the request budget returns `INVALID_INPUT`. Cancellation aborts resolution and provider work. These reads may send private source code or history to the configured backend and may be retained in normal session history (native tool progress or previews may also be observable).

### Output envelopes

Check `ok` before reading answers. This success is illustrative, not a measured provider call:

```json
{
  "ok": true,
  "result": {
    "provider": "typesafe",
    "model": "jev-1.13.0",
    "answers": {
      "urgent": { "type": "noul", "noul": 0.98 },
      "category": { "type": "choice", "choice": "incident", "probabilities": { "incident": 0.9, "maintenance": 0.02, "other": 0.08 }, "confidence": 0.85 },
      "severity": { "type": "score", "score": 1.6, "legend": { "0": "No user impact", "1": "Some users affected", "2": "Production unavailable" }, "probabilities": { "0": 0.1, "1": 0.2, "2": 0.7 }, "confidence": 0.4 }
    },
    "usage": { "input_tokens": 312, "output_tokens": 48 },
    "durationMs": 145
  }
}
```

Named success adds `result.classifier`. `model` preserves the provider's reported model, not the requested alias. `requestID` appears only for a validated `x-typesafe-request-id` header. `durationMs` uses a monotonic clock across the whole invocation, including retries.

```json
{
  "ok": false,
  "error": {
    "code": "PROVIDER_UNAVAILABLE",
    "message": "OpenAI Decisions is unavailable until its documented API adapter is implemented. Configure TypeSafe or Kev instead.",
    "retryable": false,
    "provider": "openai-decisions"
  }
}
```

Session cancellation is rethrown to OpenCode, not returned as a failure envelope.

## Transport and errors

Only explicit HTTP 429 and 529 responses automatically retry. Delays are 500 ms, then 1,000 ms, or a longer valid `Retry-After`. One deadline covers fetch, body reads, retry delays, and all attempts. If another delay would reach the deadline, the original retryable error is returned. Redirects are forbidden. Backend and model never change during retries.

| Code | Meaning |
| --- | --- |
| `INVALID_INPUT`, `UNKNOWN_CLASSIFIER`, `UNSUPPORTED_TYPE` | Invalid arguments, missing configured name, or unsupported type. No HTTP. |
| `EVIDENCE_ERROR` | File/Git evidence could not be resolved, access was denied, or a required native tool is unavailable. No HTTP. |
| `MISSING_CREDENTIALS` | Set the configured server-side variable or supply a valid configured key file. No HTTP. |
| `AUTH_FAILED` | HTTP 401/403. No retry. |
| `RATE_LIMITED` | HTTP 429 after permitted attempts. Retryable. |
| `PROVIDER_UNAVAILABLE` | HTTP 529 or other 5xx is retryable. Other 5xx do not automatically retry. The OpenAI gate is not retryable. |
| `REQUEST_REJECTED` | Other unsuccessful status, including 422. No retry. |
| `NETWORK_ERROR`, `TIMEOUT` | Connection failure or invocation deadline. Retryable but never automatically retried. |
| `INVALID_RESPONSE`, `INPUT_TRUNCATED` | Invalid/oversized JSON, native contract violation, or explicit Kev truncation. No retry. |
| `INTERNAL_ERROR` | Unexpected local failure, sanitized. |

Errors use locally constructed messages and may include HTTP `status`; raw upstream bodies and arbitrary thrown messages are never included. `retryable` means a caller could retry later, not that doing so is free or idempotent. A timed-out request may already have incurred cost. Usage only preserves what the successful upstream response reports; it may omit failed-attempt costs.

## Privacy and actions

Calls may send private content to the configured backend and incur API charges. Only caller-supplied or explicitly resolved `state`, the selected question map, and configured model are in the request. The plugin reads only explicitly referenced evidence files/Git diffs and the operator-configured credential file; it does not gather conversation history, fetch embedded URLs, or execute decisions. Normal OpenCode tool input/output history may retain submitted state and answers. There is no additional cache, telemetry, history database, or audit store.

Never put literal secrets in plugin options. Keys are resolved at invocation time from only the selected environment variable or credential file. Key contents and file read errors never appear in tool output. Keys on a remote TUI machine do not configure the server. High confidence neither makes a decision correct nor authorizes another tool. Normal OpenCode permissions still govern subsequent actions.

## Run Kev separately

Use Kev's own HTTP server, not an OpenAI-compatible chat server. In a separate checkout of [Kev](https://github.com/jaredpalmer/kev):

```sh
uv sync --extra serve
uv run --extra serve python -m kev.serve --run jaredpalmer/kev-0.8b --port 8009
```

This is the upstream-documented starting point. The first run downloads weights; checkpoint, hardware, precision, and runtime requirements belong to the operator. Kev binds to loopback by default. Set `KEV_API_KEY` when starting authenticated Kev and give OpenCode the same key through `apiKeyEnv`.

`kev-latest` is a serving alias for the checkpoint already loaded by the process, not a per-call checkpoint selector. Kev currently echoes the requested alias as `model`. It does not identify immutable weights. Inspect `GET /v1/models` manually for checkpoint, backend, and precision details. The plugin never installs Python, downloads weights, starts or stops Kev, exposes a listener, or polls for readiness. A stopped server produces a sanitized network error.

## Verification

From `classify/` run `bun install`, `bun run typecheck`, and `bun test`. From the repository root run `bun run check`. Tests use recording adapters, injected fetch, and local HTTP fixtures. They check contracts and transport behavior, not model accuracy.

See [SMOKE_TESTING.md](./SMOKE_TESTING.md) for disposable-fixture setup, the complete test-case matrix, expected outcomes, regression checks, and reporting/cleanup instructions.

### Manual OpenCode and live smoke procedure

Live TypeSafe calls through OpenCode Code Mode have verified text/file/diff evidence, named classifiers, native answer types, structured score legends, and transport-safe choice criteria lists against synthetic inputs (`jev-1.13.0`). This is a connectivity/contract smoke check, not a general model-accuracy claim. No live Kev or separate TUI/web-client smoke check has been performed. The following is the full manual procedure for additional verification:

1. Create a temporary project outside this repository, for example under `/tmp/opencode/classify-smoke`. Give its `opencode.jsonc` only this plugin's absolute directory path and one of the configurations above. Start a V2 TUI or web client in that project. Verify the effective plugin list because global configuration can still load other plugins.
2. Configure TypeSafe and set its key on the actual server. Ask the agent to invoke `classify` with the mixed example exactly as written. Check `ok: true`, all three native answer types, unchanged fractional score, complete distributions and legends, reported model, token usage, and duration. Record the OpenCode version and model. Interrupt a pending call and verify it does not complete as a successful tool result.
3. Reload with a named classifier and submit the named example. Check `result.classifier` and the configured answer IDs. Verify the tool description and schema list only your configured names.
4. Start only your separately managed test Kev instance. Record `git rev-parse HEAD` in that Kev checkout. Inspect `http://127.0.0.1:8009/v1/models` manually, using authentication if configured. Record checkpoint, backend, and precision. Load the Kev configuration and repeat the mixed and named requests.
5. Stop only the test Kev process you started, repeat a request, and check `NETWORK_ERROR` without submitted content or keys. Do not stop unrelated servers.
6. Configure the reserved OpenAI backend and verify `PROVIDER_UNAVAILABLE`, with no request to OpenAI or substitute provider.

Threshold tuning and comparative accuracy require representative labeled data and are outside v1.
