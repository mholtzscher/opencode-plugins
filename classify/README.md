# Classify

One server-side `classify` tool for bounded judgments. TypeSafe AI, Cloudflare Clef, and externally managed Laya and Ollama servers use the System One contract. OpenAI Decisions is **unavailable** until its documented API adapter is implemented. There is no chat or Responses fallback.

The TUI entry is a no-op. Credentials and classification run on the OpenCode server, including when the TUI connects remotely. Setup makes no network calls and downloads no models.

The server entry uses `@opencode/plugin/effect` with Effect 4. OpenCode owns the registration scope and interrupts the native Effect pipeline. Each provider supplies a layer implementing `DecisionBackend`; credentials, evidence access, OpenCode integration, and HTTP transport are injectable services. Tool input and output use Effect Schema. Results are structured objects rather than JSON strings, so Code Mode callers should no longer call `JSON.parse`.

## Install and configure

Merge one of the following plugin entries into your existing `plugins` array. Do not replace unrelated settings. A local checkout uses `"package": "./classify"`; install its dependencies with `bun install` from `classify/`. For installation from GitHub, replace that package value with:

```text
github:mholtzscher/opencode-plugins#main::path:classify
```

The repository's root configuration uses the hosted `typesafe` provider with an operator-specific server-local key file. `mise run opencode` launches OpenCode with that configuration and does not start Laya. For another operator, configure TypeSafe credentials as described below. To use local Laya instead, replace the classify backend with the loopback Laya configuration below and start Laya separately. The former `kev` provider name is no longer accepted; update existing configurations to `laya` and use a Laya endpoint and checkpoint name.

### Local Laya with mise

Local Laya is optional. With mise 2026.9.18 or later, start it from the repository root before launching OpenCode configured with the `laya` provider:

```sh
mise daemons start laya
mise run opencode
```

Mise uses Pitchfork to supervise Laya 0.3.22 on `http://127.0.0.1:8000`. The first start uses uv to install `laya[serve]` in a cached Python 3.12 environment and downloads the English checkpoint from Hugging Face. PyTorch's backend is selected automatically for the host. Startup allows up to 20 minutes for installation and model loading. No API key is configured; the listener is loopback-only.

To manage the server separately:

```sh
mise daemons start laya
mise daemons status laya
mise daemons logs laya
mise daemons stop laya
```

The daemon stays running after OpenCode exits. Its declarations are in the root `mise.toml`; configure the classify endpoint and model using the Laya examples below. Starting the daemon does not change the root TypeSafe backend. Stop it explicitly when finished. This setup does not enable login startup or shell-entry autostart.

Laya serves `/v1/systemone`, and results report `provider: "laya"`. Laya's confidence semantics differ from Jev's, choice questions have a 100-option HTTP cap and smaller practical token budgets, and long states can be silently truncated. The plugin does not expose Laya's token-budget controls or extra confidence and routing metadata. Use short inputs and validate accuracy and thresholds on your own examples.

### Hosted TypeSafe

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./classify",
      "options": { "backend": { "provider": "typesafe" } },
    },
  ],
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

Choose either `apiKeyFile` or `apiKeyEnv`, never both. Selecting a file disables the default environment source and never falls back to it. The plugin reads the file at each invocation, so key rotation does not require a reload. It never reads the file during setup. Missing, unreadable, empty, oversized, or malformed files return sanitized `MISSING_CREDENTIALS` errors before HTTP. Laya also accepts `apiKeyFile`. OpenAI accepts the option but its unavailable adapter never opens it.

### Unauthenticated loopback Laya

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./classify",
      "options": {
        "backend": { "provider": "laya", "baseURL": "http://127.0.0.1:8000" },
        "classifiers": {
          "incident-triage": {
            "description": "Check whether a report describes an active production incident.",
            "questions": {
              "active": {
                "type": "noul",
                "instructions": "Does state.message describe an active production incident?",
              },
            },
          },
        },
      },
    },
  ],
}
```

This sends no authorization header and uses `english`. Start Laya separately before invoking the tool.

### Authenticated local Laya

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./classify",
      "options": {
        "backend": {
          "provider": "laya",
          "baseURL": "http://127.0.0.1:8000",
          "model": "english",
          "apiKeyEnv": "LAYA_API_KEY",
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
                  "unknown": "Insufficient evidence",
                },
              },
            },
          },
          "incident-triage": {
            "description": "Assess whether a report describes an incident and rate its impact.",
            "questions": {
              "active": {
                "type": "noul",
                "instructions": "Does this report describe an active production incident?",
              },
              "impact": {
                "type": "score",
                "instructions": "Rate the user impact described in the report.",
                "criteria": [
                  "No user impact",
                  "Some users affected",
                  "Production unavailable",
                ],
              },
            },
          },
        },
      },
    },
  ],
}
```

Set matching `LAYA_API_KEY` values for the Laya process and the OpenCode server. `apiKeyEnv` names an environment variable; it is not a literal key. The longer deadline allows slower local inference. `maxRetries: 0` disables automatic retries.

### Self-hosted Laya behind HTTPS

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./classify",
      "options": {
        "backend": {
          "provider": "laya",
          "baseURL": "https://laya.example.com",
          "apiKeyEnv": "COMPANY_LAYA_API_KEY",
        },
        "timeoutMs": 60000,
        "maxRetries": 0,
      },
    },
  ],
}
```

Replace the origin and set the named variable on the OpenCode server. Expose `/v1/systemone` without redirects. `baseURL` must be an HTTP or HTTPS origin with an optional trailing slash, no API path, user information, query, or fragment. HTTP is allowed only for `localhost`, `127.0.0.1`, and `[::1]`; other origins require HTTPS. These checks do not protect against malicious operator configuration or DNS changes.

### Reserved OpenAI Decisions

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./classify",
      "options": { "backend": { "provider": "openai-decisions" } },
    },
  ],
}
```

This registers the tool but returns `PROVIDER_UNAVAILABLE` on valid invocations without credential lookup or HTTP. `OPENAI_API_KEY` is reserved; no model default is defined. See the [implementation gate](../specs/classify-tool-plugin.md#openai-implementation-gate) before adding a real adapter.

### Hosted Cloudflare Clef

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./classify",
      "options": {
        "backend": {
          "provider": "cloudflare",
          "accountID": "0123456789abcdef0123456789abcdef",
          "model": "clef",
        },
      },
    },
  ],
}
```

Replace `accountID` with your 32-character hexadecimal Cloudflare account ID. Set `CLOUDFLARE_AUTH_TOKEN` on the OpenCode server to an API token with Workers AI permission for that account. `apiKeyEnv` can select another variable, or `apiKeyFile` can select a server-local token file using the same rules as TypeSafe.

The model defaults to `clef`. Set `model: "clef-flash"` for the faster model. Only these two selectors are accepted. The plugin sends the selector in the body and chooses the matching fixed Workers AI REST endpoint. It unwraps the Cloudflare `success`/`result` envelope before validating native measurements. Results report `provider: "cloudflare"`; a validated `cf-ray` header becomes `requestID`.

The plugin supports text and structured JSON, not Clef's separate image input extension. Cloudflare documents a 65,536-token context window and truncation of long text. The byte limit does not guarantee that an input fits the token window. Keep inputs short. An explicit `truncated: true` result fails with `INPUT_TRUNCATED`, but absence of that marker does not prove full input coverage. See the [Clef documentation](https://developers.cloudflare.com/workers-ai/models/clef/).

### Local Ollama with Nimble

Install [Ollama 0.35 or later](https://ollama.com/download), run `ollama pull nimble`, and start the Ollama server separately. Configure the plugin with:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./classify",
      "options": { "backend": { "provider": "ollama" } },
    },
  ],
}
```

This uses `http://127.0.0.1:11434/v1/systemone`, sends no authorization header, and requests `nimble`. Set `backend.model` to another installed decision-model tag (for example, `nimble:9b`). For an Ollama server at another origin, set `backend.baseURL` to that origin; use HTTPS for non-loopback hosts. If the server requires a bearer token, configure `apiKeyEnv` or `apiKeyFile` as with Laya. The address is resolved from the **OpenCode server**, not the TUI machine. The plugin does not start Ollama or pull models. Increase `timeoutMs` if cold model loads take longer than the default 30 seconds.

Ollama's Nimble endpoint accepts up to 26 choice options and a 64 KiB request body, tighter than the plugin's general limits. Use string descriptions for score criteria: Ollama 0.35.0 rejects structured score descriptions with HTTP 400. The plugin preserves question content rather than converting it to strings. Keep states short; an oversized or unsupported request may return `REQUEST_REJECTED`. Responses use the same typed System One measurements, and `provider` is `"ollama"`. Test confidence thresholds on your own data.

### Option limits

`backend` is required. No provider is inferred from available keys. TypeSafe uses the fixed `https://api.typesafe.ai/v1/systemone` endpoint. Laya defaults to `http://127.0.0.1:8000`, `english`, and no authentication. Other checkpoint names include `multilingual` and `typed-decisions`. Ollama defaults to `http://127.0.0.1:11434`, `nimble`, and no authentication. If `apiKeyEnv` is configured, its server-side value must be present and nonblank at invocation time. Alternatively, configure `apiKeyFile` as described above.

`timeoutMs` defaults to 30,000 and accepts integers from 1,000 to 300,000. `maxRetries` defaults to 1 and accepts 0–2 retries after the first attempt. Up to 32 named classifiers are allowed. Each has a nonblank description of at most 512 characters, a valid question map, and optional `state` using the same content/evidence shapes as tool input. Names and question IDs match `^[A-Za-z][A-Za-z0-9_-]{0,63}$`. Unknown option fields, including literal credentials, fail setup with a sanitized `INVALID_CONFIG` error. Options are an immutable snapshot; reload the plugin after changes. There is no plugin storage.

## Provider architecture

[`providers/backend.ts`](./providers/backend.ts) defines the `DecisionBackend` Effect service, and [`providers/registry.ts`](./providers/registry.ts) selects the provider layer for the configured backend. Configuration defaults (model, key variable, local origins) are applied by the options schema in [`backend-config.ts`](./backend-config.ts); each provider module owns its endpoint and response decoding. TypeSafe, Laya, Ollama, and Cloudflare share System One backend construction in [`protocols/system-one.ts`](./protocols/system-one.ts). The unavailable OpenAI layer fails preflight without IO. [`layers.ts`](./layers.ts) composes the selected provider with credentials, transport, and evidence services. The plugin builds these layers once in its lifetime scope; each tool invocation passes its own OpenCode execution context.

To add a provider, implement `ProviderDefinition` with a `DecisionBackend` layer in a provider module, register it in `registry.ts`, add its ID to `providers/ids.ts`, and extend the backend configuration schema. For System One-compatible APIs, implement `SystemOneDefinition` with an endpoint, response decoder, and optional request-ID header and reuse the shared layer construction. Other protocols can supply their own layer without changing the classifier program. Add configuration rejection, HTTP contract, malformed response, and output parser tests. Layer construction and preflight must remain free of credential, evidence, and network reads.

Each backend exposes `provider`, `preflight(questions)`, and `decide(request)`. Both methods return Effects with typed failures. Preflight owns availability and capability checks and must not read evidence, credentials, or the network. [`service.ts`](./service.ts) validates input and resolves named classifiers, calls preflight before resolving evidence, and then dispatches through `decide`. The OpenAI layer also rejects direct `decide` calls without HTTP.

## Tool contract

The server entry uses `Plugin.define({ id: "classify", effect })`. The registration in [`index.ts`](./index.ts) uses the input and output codecs from [`schemas.ts`](./schemas.ts). Bounded JSON security checks run before structural decoding. Request-aware checks validate provider distributions and score legends. The executor provides the services built in the plugin scope:

```ts
{
  name: "classify",
  description, // Includes configured names and descriptions.
  input: buildInputSchema(options.classifiers),
  output: ClassifyOutputSchema,
  execute: (input, context) => classify(options, input, context).pipe(
    Effect.provideContext(services),
    Effect.map((output) => ({ output })),
  ),
}
```

Tool arguments are exactly one of `{ state, questions }`, `{ state, classifier }` for a classifier without configured state, or `{ classifier }` for a classifier with configured state. Never supply both `questions` and `classifier`. Without named classifiers only the ad hoc branch is advertised. Named branches enumerate configured names separately according to whether state is configured. All branches reject extra fields. Tool arguments cannot override configured state, backend, endpoint, model, credentials, or headers.

The agent-facing description is built by [`tool-description.ts`](./tool-description.ts) and includes a mixed-type request, structured output and `ok` handling, answer fields, scale/confidence semantics, and the self-contained evidence boundary. Input-schema field descriptions repeat constraints that Code Mode's generated TypeScript signature may otherwise omit. Agents do not need to read this README to make and interpret a call.

Put content to evaluate in `state` and the judgment in each question's `instructions`. Both accept nonblank strings, nonempty JSON objects, or nonempty JSON arrays. `state` also supports the explicit evidence wrapper below, which reads files and generates Git diffs on the server. Nested JSON permits null, booleans, and finite numbers. Question IDs are response keys, not model instructions. Each call evaluates 1–64 independent questions against one shared state. For judgments depending on prior answers, make another call.

| Type | Criteria | Native result |
| --- | --- | --- |
| `noul` | Optional object containing `true`, `false`, or both, with nonempty descriptions | `noul` is the probability of yes in `[0, 1]`, not a boolean. No invented confidence. |
| `choice` | Map of 2–255 distinct nonblank labels, at most 128 characters each, to descriptions or null; alternatively a list of `{ label, description }` entries | One allowed `choice`, the exact label distribution, and native `confidence`. |
| `score` | Ordered array of 2–10 nonempty level descriptions | Fractional `score` in `[0, levels.length - 1]`, explicit `scale: { min: 0, max: levels.length - 1 }`, the upstream legend, distribution, and native `confidence`. |

Descriptions accept the same content shapes as instructions. These are plugin validation limits, not a guarantee that a backend accepts the request. Laya imposes tighter choice and token budgets. Confidence is a provider-native uncertainty metric, not a probability of correctness; its meaning is provider-specific and values are not necessarily comparable across providers. Distributions must match all requested labels or indices and have absolute sum error below `0.02`; the plugin never renormalizes, rounds, thresholds, or rescales values. Missing required native measurements, mismatched IDs/types, invalid usage or legends fail the entire result. No partial answers escape. A Laya response reporting `truncated: true` fails with `INPUT_TRUNCATED`; absence of that marker does not prove the input was read in full.

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
      "criteria": {
        "true": "The customer asks to receive money back",
        "false": "The customer does not ask to receive money back"
      }
    }
  }
}
```

Read `result.answers.refund_requested.noul` as a number. The tool does not authorize or issue a refund.

### One allowed label

```json
{
  "state": {
    "title": "Fix stale cache after deploy",
    "files": ["cache.ts", "cache.test.ts"]
  },
  "questions": {
    "change_kind": {
      "type": "choice",
      "instructions": "Which category best describes this change?",
      "criteria": {
        "bugfix": "Corrects existing behavior",
        "feature": "Adds a new capability",
        "maintenance": "Refactoring or upkeep without a behavior change",
        "unknown": "The supplied evidence is insufficient"
      }
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
      "criteria": [
        "No user impact",
        "Some users affected",
        "Most users cannot complete the task"
      ]
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

### Named classifier

```json
{
  "state": { "message": "Production is down after the deploy." },
  "classifier": "incident-triage"
}
```

Named mode sends the stored questions unchanged. The caller cannot override them. With the authenticated Laya example, `{ "state": "Fix stale cache after deploy", "classifier": "change-kind" }` also works.

#### Preset state

A named classifier can also define what to evaluate. Add this entry under `options.classifiers`:

```json
{
  "change-review": {
    "description": "Evaluate current changes against project rules.",
    "state": {
      "type": "evidence",
      "files": ["AGENTS.md"],
      "diffs": [{ "base": "HEAD" }]
    },
    "questions": {
      "compliant": {
        "type": "noul",
        "instructions": "Do the changes follow the supplied project rules?"
      }
    }
  }
}
```

Invoke it with only the name:

```json
{ "classifier": "change-review" }
```

Configured state can be a nonblank string, nonempty object/array, or evidence wrapper. Supplying caller state when the classifier defines its own is rejected with `INVALID_INPUT`, even if the values match; there is no merge or override. Classifiers without configured state still require caller state. The tool's description identifies which mode each name uses.

Evidence references are validated at setup but not read then. Files and diffs are resolved freshly on every invocation, relative to the invoking session's directory, through the same native permissions and size limits as caller-supplied evidence. Static content is an immutable configuration snapshot; evidence contents are not cached. The unavailable OpenAI adapter still skips evidence resolution.

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
      "category": {
        "type": "choice",
        "choice": "incident",
        "probabilities": {
          "incident": 0.9,
          "maintenance": 0.02,
          "other": 0.08
        },
        "confidence": 0.85
      },
      "severity": {
        "type": "score",
        "score": 1.6,
        "scale": { "min": 0, "max": 2 },
        "legend": {
          "0": "No user impact",
          "1": "Some users affected",
          "2": "Production unavailable"
        },
        "probabilities": { "0": 0.1, "1": 0.2, "2": 0.7 },
        "confidence": 0.4
      }
    },
    "usage": { "input_tokens": 312, "output_tokens": 48 },
    "attempts": 1,
    "durationMs": 145
  }
}
```

Named success adds `result.classifier`. `model` preserves the provider's reported model, not the requested alias. All answer measurements shown above and both usage counts are required. `scale` is derived from the requested rubric; native score, legend, probabilities, and confidence are unchanged. `requestID` appears only for a validated `x-typesafe-request-id` header, or `cf-ray` for Cloudflare, from the final attempt, including on HTTP, response-body, or native-response validation failures. `attempts` counts HTTP dispatches (initial request plus retries); zero on failure means no dispatch. `durationMs` uses a monotonic clock across the whole invocation, including evidence resolution and retries, and is returned on both success and failure. Usage reports only the successful attempt, not necessarily total billed tokens.

```json
{
  "ok": false,
  "error": {
    "code": "PROVIDER_UNAVAILABLE",
    "message": "OpenAI Decisions is unavailable until its documented API adapter is implemented. Configure TypeSafe or Laya instead.",
    "retryable": false,
    "provider": "openai-decisions",
    "attempts": 0,
    "durationMs": 0.1
  }
}
```

Session cancellation is rethrown to OpenCode, not returned as a failure envelope.

The existing envelope and native field names (`noul`, `confidence`, etc.) remain unchanged. New diagnostic fields and score bounds are additive. The published TypeScript types now reflect required native measurements rather than advertising them as optional.

### Output schema and parser

[`output.ts`](./output.ts) exports `classifyOutputSchema` (JSON Schema 2020-12) and `parseClassifyOutput`. Package consumers can import them from `opencode-classify-plugin/output` and types from `opencode-classify-plugin/types`:

```ts
import { parseClassifyOutput } from "opencode-classify-plugin/output";

const output = parseClassifyOutput(raw); // Structured object, or JSON text from older versions.
if (output.ok) {
  console.log(output.result.answers);
} else {
  console.log(output.error.code, output.error.path, output.error.retryAfterMs);
}
```

The parser checks the envelope, required measurements, distributions, score bounds, and diagnostics without rounding or renormalizing. It throws a sanitized `TypeError` for malformed output, including `null`. The JSON Schema expresses structural constraints; the parser additionally enforces distribution sums and cross-field consistency. Neither verifies agreement with an original request it has not received. OpenCode receives a typed output object. This is a compatibility change for callers that previously parsed a JSON string; the parser still accepts legacy JSON text.

The exported JSON Schema is generated from the Effect output definition. It uses `anyOf` for discriminated alternatives and includes `$defs` for referenced definitions. Consumers that inspect the previous inline `oneOf` layout must update those lookups; JSON Schema validators should consume the complete document, including `$defs`.

## Transport and errors

Only explicit HTTP 429 and 529 responses automatically retry. Delays are 500 ms, then 1,000 ms, or a longer valid `Retry-After`. One deadline covers fetch, body reads, retry delays, and all attempts. If another delay would reach the deadline, the original retryable error is returned. Redirects are forbidden. Backend and model never change during retries.

| Code | Meaning |
| --- | --- |
| `INVALID_INPUT`, `UNSUPPORTED_TYPE` | Invalid arguments (including an unknown classifier name or the wrong state mode for a named classifier, reported at `/classifier` or `/state`) or unsupported type. No HTTP. |
| `EVIDENCE_ERROR` | File/Git evidence could not be resolved, access was denied, or a required native tool is unavailable. No HTTP. |
| `MISSING_CREDENTIALS` | Set the configured server-side variable or supply a valid configured key file. No HTTP. |
| `AUTH_FAILED` | HTTP 401/403. No retry. |
| `RATE_LIMITED` | HTTP 429 after permitted attempts. Retryable. |
| `PROVIDER_UNAVAILABLE` | HTTP 529 or other 5xx is retryable. Other 5xx do not automatically retry. The OpenAI gate is not retryable. |
| `REQUEST_REJECTED` | Other unsuccessful status, including 422. No retry. |
| `NETWORK_ERROR`, `TIMEOUT` | Connection failure or invocation deadline. Retryable but never automatically retried. |
| `INVALID_RESPONSE`, `INPUT_TRUNCATED` | Invalid/oversized JSON, native contract violation, or explicit Laya truncation marker. No retry. |
| `INTERNAL_ERROR` | Unexpected local failure, sanitized. |

Errors use locally constructed messages and may include HTTP `status`; raw upstream bodies and arbitrary thrown messages are never included. Input validation includes a JSON Pointer `path` and the expected constraint where available (for example, `/questions/severity/criteria` for a malformed score rubric); messages do not echo submitted values, and arbitrary choice labels are not included in paths. An empty pointer refers to the input root. Failures also include `attempts`, `durationMs`, and a safe final-attempt `requestID` when available. `retryAfterMs` preserves a valid provider `Retry-After` wait in milliseconds (seconds or a standard HTTP date, past dates clamped to zero), not the plugin's exponential backoff. `retryable` means a caller could retry later, not that doing so is free or idempotent. A timed-out request may already have incurred cost. Usage only preserves what the successful upstream response reports; it may omit failed-attempt costs.

## Privacy and actions

Calls may send private content to the configured backend and incur API charges. Only caller-supplied, preset, or explicitly resolved `state`, the selected question map, and configured model are in the request. The plugin reads only explicitly referenced evidence files/Git diffs and the operator-configured credential file; it does not gather conversation history, fetch embedded URLs, or execute decisions. Normal OpenCode tool input/output history may retain submitted state and answers. There is no additional cache, telemetry, history database, or audit store.

Never put literal secrets in plugin options. Keys are resolved at invocation time from only the selected environment variable or credential file. Key contents and file read errors never appear in tool output. Keys on a remote TUI machine do not configure the server. High confidence neither makes a decision correct nor authorizes another tool. Normal OpenCode permissions still govern subsequent actions.

## Run Laya separately

Use [Laya's HTTP server](https://github.com/NandhaKishorM/laya), not an OpenAI-compatible chat server:

```sh
LAYA_HOST=127.0.0.1 LAYA_PORT=8000 LAYA_MODELS=english uv tool run --python 3.12 --torch-backend=auto --from 'laya[serve]==0.3.22' laya-serve
```

The first run installs dependencies and downloads weights. Checkpoint, hardware, precision, and runtime requirements belong to the operator. Set `LAYA_HOST=127.0.0.1` explicitly because Laya otherwise binds to all interfaces. Set `LAYA_API_KEY` when starting authenticated Laya and give OpenCode the same key through `apiKeyEnv`.

`model` selects a Laya checkpoint per request. `LAYA_MODELS` controls preloading, not which checkpoints clients can select. Unknown model names fall back to Laya's automatic routing, so check configured names carefully. The response's model string does not identify immutable weights; inspect `GET /health` for loaded checkpoints, revisions, and actual devices. The plugin never installs Python, downloads weights, starts or stops Laya, exposes a listener, or polls for readiness. The repository's mise daemon manages startup separately. A stopped server produces a sanitized network error.

## Verification

From `classify/` run `bun install`, `bun run typecheck`, and `bun test`. From the repository root run `bun run check`. Tests use recording adapters, injected fetch, and local HTTP fixtures. They check contracts and transport behavior, not model accuracy.

See [SMOKE_TESTING.md](./SMOKE_TESTING.md) for disposable-fixture setup, the complete test-case matrix, expected outcomes, regression checks, and reporting/cleanup instructions.

### Manual OpenCode and live smoke procedure

Live Ollama 0.35.0 validation with `nimble:latest` (Q8_0, digest `9b953de7a5336756ece1cb1e8632e374b3dbdabe3d02d405cf8291da2d43a131`) exercised the plugin's classification service, provider layer, HTTP transport, and public output parser on synthetic data. A mixed string-input request returned all three native answer types, usage, and derived score bounds in about 4.7 seconds. A preset named classifier with structured state and choice-entry-list criteria succeeded in about 0.4 seconds. Structured score descriptions were rejected with HTTP 400 and surfaced as `REQUEST_REJECTED`. These checks did not exercise an OpenCode client or evidence permissions. One outage example selected `other` despite high severity; connectivity is not an accuracy guarantee.

Before the Effect migration, live TypeSafe calls through OpenCode Code Mode verified text/file/diff evidence, named classifiers, native answer types, structured score legends, and transport-safe choice criteria lists against synthetic inputs (`jev-1.13.0`). A local Laya adapter/service smoke check verified all three native answer types on a short synthetic incident report. These are connectivity/contract checks, not general model-accuracy claims. The migrated runtime has automated layer and loopback HTTP coverage; its real-host and hosted-provider smoke checks still need to be rerun. No separate Laya TUI/web-client smoke check has been performed. The following is the full manual procedure for additional verification:

1. Create a temporary project outside this repository, for example under `/tmp/opencode/classify-smoke`. Give its `opencode.jsonc` only this plugin's absolute directory path and one of the configurations above. Start a V2 TUI or web client in that project. Verify the effective plugin list because global configuration can still load other plugins.
2. Configure TypeSafe and set its key on the actual server. Ask the agent to invoke `classify` with the mixed example exactly as written. Check `ok: true`, all three native answer types, unchanged fractional score, complete distributions and legends, reported model, token usage, and duration. Record the OpenCode version and model. Interrupt a pending call and verify it does not complete as a successful tool result.
3. Reload with a named classifier and submit the named example. Check `result.classifier` and the configured answer IDs. Verify the tool description and schema list only your configured names. Add a classifier with configured evidence state, invoke it with only `{ "classifier": "name" }`, and verify that files/diffs resolve from the session directory. Change a referenced file and invoke again to confirm fresh resolution. Confirm caller-state overrides and omitted state for classifiers without configured state fail with `INVALID_INPUT`, and denied evidence access makes no provider request.
4. Start only your separately managed test Laya instance. Record the Laya version. Inspect `http://127.0.0.1:8000/health` manually. Record loaded checkpoints, revisions, and actual devices. Load the Laya configuration and repeat the mixed and named requests.
5. With Ollama 0.35 or later running and `nimble` pulled on the OpenCode server, load the Ollama configuration and repeat the mixed and named requests. Record the Ollama version and model tag.
6. Stop only the test Laya or Ollama process you started, repeat a request, and check `NETWORK_ERROR` without submitted content or keys. Do not stop unrelated servers.
7. Configure the reserved OpenAI backend and verify `PROVIDER_UNAVAILABLE`, with no request to OpenAI or substitute provider.

Threshold tuning and comparative accuracy require representative labeled data and are outside v1.
