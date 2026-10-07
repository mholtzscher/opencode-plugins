# Classify tool reference

[Back to README](../README.md) · [Configuration](./CONFIGURATION.md) · [Evidence](./EVIDENCE.md)

The `classify` namespace contains `decide`, `search`, and `grammar`, with effective IDs `classify_decide`, `classify_search`, and `classify_grammar`. This page describes `decide`. See [search](./SEARCH.md) for file ranking and [evidence](./EVIDENCE.md) for grammar discovery and code extraction.

The former standalone `classify` operation is now `classify_decide`, with unchanged arguments and output. Update tool-ID references and permission rules that target the old ID. Code Mode callers should discover the namespace and use its returned signatures.

## Input

Tool arguments are exactly one of:

| Shape | Use |
| --- | --- |
| `{ "state": ..., "questions": ... }` | Ad hoc questions |
| `{ "state": ..., "classifier": "name" }` | Named classifier without preset state |
| `{ "classifier": "name" }` | Named classifier with preset state |

Never supply both `questions` and `classifier`. All branches reject extra fields. Tool arguments cannot override configured state, backend, endpoint, model, credentials, or headers. Without named classifiers, only the ad hoc branch is advertised; named branches enumerate configured names according to their state mode.

`state` and question `instructions` accept nonblank strings, nonempty JSON objects, or nonempty JSON arrays. Nested JSON permits null, booleans, and finite numbers. State also accepts the explicit [evidence wrapper](./EVIDENCE.md). Each call evaluates 1–64 independent questions against one shared state. Question IDs are response keys, not model instructions, and match `^[A-Za-z][A-Za-z0-9_-]{0,63}$`. Use another call when a judgment depends on prior answers.

Options and inputs have bounded JSON traversal, at most 32 levels deep. The serialized System One request and streamed response body are each limited to 1 MiB. Provider limits may be tighter.

## Questions and measurements

| Type | Criteria | Native result |
| --- | --- | --- |
| `noul` | Optional object containing `true`, `false`, or both, with nonempty descriptions | `noul`: probability of yes in `[0, 1]`, not a boolean. No invented confidence. |
| `choice` | Map of 2–255 distinct nonblank labels (up to 128 characters each) to descriptions or null; alternatively an entry list | One allowed `choice`, the exact label distribution, and native `confidence`. |
| `score` | Ordered array of 2–10 nonempty level descriptions | Fractional `score` in `[0, levels.length - 1]`, derived `scale`, native legend, distribution, and `confidence`. |

Descriptions accept the same content shapes as instructions. These are plugin validation limits; see [provider restrictions](./CONFIGURATION.md#providers) for tighter choice, body, and token budgets.

Confidence is a provider-native uncertainty metric, not a probability of correctness. Its meaning is provider-specific and values are not necessarily comparable across providers. The plugin never renormalizes, rounds, thresholds, or rescales values.

Distributions must match all requested labels or indices and have absolute sum error below `0.02`. Missing required native measurements, mismatched IDs/types, invalid usage, or invalid legends fail the entire result; no partial answers escape.

### Yes/no criteria

The [quick-start example](../README.md#2-ask-the-agent-to-classify-content) omits optional yes/no criteria. To describe the two outcomes explicitly, use:

```json
{
  "type": "noul",
  "instructions": "Does the customer explicitly request a refund?",
  "criteria": {
    "true": "The customer asks to receive money back",
    "false": "The customer does not ask to receive money back"
  }
}
```

Read the answer's `noul` as a number. The tool does not authorize or issue a refund.

### Choice entry lists

An `unknown` choice is a caller-defined label, not an automatic low-confidence fallback. Criteria also accept this transport-safe form:

```json
{
  "type": "choice",
  "instructions": "Select __proto__ for a production outage, constructor otherwise.",
  "criteria": [
    { "label": "__proto__", "description": "Production outage" },
    { "label": "constructor", "description": null }
  ]
}
```

Use entry lists for labels such as `__proto__`: the current OpenCode Code Mode object transport cannot preserve that label as an object key. The plugin safely converts entries to the backend's native criteria map using own properties, retaining the original labels in answers and probabilities. Both fields are required; descriptions may be null. Duplicate labels and unknown entry fields fail validation. Named classifiers accept either form. This workaround does not repair Code Mode's map transport itself.

### Score legends

Scores remain on the zero-based rubric: with three levels, `1.6` is a fractional score on 0–2, not a percentage. Legends preserve native nonblank strings, nonempty objects, and nonempty arrays rather than converting structured descriptions to strings. A legend must contain exactly the requested zero-based indices; null, primitive booleans/numbers, and empty descriptions are rejected.

## Named classifiers

Configure up to 32 definitions under `options.classifiers`. Each needs a nonblank description of at most 512 characters and a valid question map. Names use the same format as question IDs. See the [README example](../README.md#reuse-a-named-classifier) for caller-supplied state.

To preset what a classifier evaluates, include `state` in its definition:

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

Configured state accepts text, a nonempty object/array, or evidence. Supplying caller state when a preset exists returns `INVALID_INPUT`, even if the values match; there is no merge or override. Classifiers without preset state require caller state. Configured questions are sent unchanged, and the tool description identifies each name's state mode.

Static content is an immutable configuration snapshot. Evidence references are validated at setup, then resolved freshly on every invocation relative to the session's directory, under the same permissions and limits as caller-supplied evidence. Evidence contents are not cached. The unavailable OpenAI adapter skips resolution.

## Output envelopes

The tool returns a structured object. Check `ok` before reading answers. This success corresponds to the quick-start question map and is illustrative, not a measured provider call:

```json
{
  "ok": true,
  "result": {
    "backend": "default",
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

All answer measurements shown above and both usage counts are required. `scale` is derived from the requested rubric; native score, legend, probabilities, and confidence are unchanged.

| Field | Meaning |
| --- | --- |
| `backend` | Selected profile, included when selection succeeds |
| `classifier` | Added on named-classifier success |
| `model` | Provider-reported model, not the requested alias |
| `attempts` | HTTP dispatches, including retries; zero on failure means no dispatch |
| `durationMs` | Monotonic elapsed time across the whole invocation, including evidence and retries; included on success and failure |
| `usage` | Successful attempt's reported tokens, not necessarily total billed tokens |
| `requestID` | Validated final-attempt `x-typesafe-request-id`, `x-request-id` for OpenAI, or `cf-ray` for Cloudflare; may also appear on HTTP, body, or native-response validation failures |

An illustrative failure:

```json
{
  "ok": false,
  "error": {
    "code": "MISSING_CREDENTIALS",
    "message": "Set the configured API-key environment variable on the OpenCode server.",
    "retryable": false,
    "provider": "openai-decisions",
    "attempts": 0,
    "durationMs": 0.1
  }
}
```

Session cancellation is rethrown to OpenCode, not returned as a failure envelope.

## Transport and errors

Only explicit HTTP **429 and 529** responses automatically retry. Delays are 500 ms, then 1,000 ms, or a longer valid `Retry-After`. One deadline covers fetch, body reads, retry delays, and all attempts. If another delay would reach the deadline, the original retryable error is returned. Redirects are forbidden. Backend and model never change during retries.

| Code | Meaning |
| --- | --- |
| `INVALID_INPUT`, `UNSUPPORTED_TYPE` | Invalid arguments or unsupported type. Unknown classifiers and wrong named-state modes are reported at `/classifier` or `/state`. No HTTP. |
| `EVIDENCE_ERROR` | File/code/Git evidence failed, access was denied, or a required native tool is unavailable. No HTTP. |
| `MISSING_CREDENTIALS` | Set the configured server-side variable or supply a valid key file. No HTTP. |
| `AUTH_FAILED` | HTTP 401/403. No retry. |
| `RATE_LIMITED` | HTTP 429 after permitted attempts. Retryable. |
| `PROVIDER_UNAVAILABLE` | HTTP 529 or other 5xx is retryable, but other 5xx do not automatically retry. |
| `REQUEST_REJECTED` | Other unsuccessful status, including 422. No retry. |
| `NETWORK_ERROR`, `TIMEOUT` | Connection failure or invocation deadline. Retryable but never automatically retried. |
| `INVALID_RESPONSE`, `INPUT_TRUNCATED` | Invalid/oversized JSON, native contract violation, or explicit upstream truncation marker. No retry. |
| `INTERNAL_ERROR` | Unexpected local failure, sanitized. |

Errors use locally constructed messages and may include HTTP `status`. Raw upstream bodies and arbitrary thrown messages are never included. Input validation includes a JSON Pointer `path` and expected constraint where available (for example, `/questions/severity/criteria`). Messages do not echo submitted values, and arbitrary choice labels are excluded from paths. An empty pointer refers to the input root.

Failures include `attempts`, `durationMs`, and a safe final-attempt `requestID` when available. `retryAfterMs` preserves a valid provider `Retry-After` in milliseconds, not the plugin's backoff. It accepts seconds or a standard HTTP date, clamping past dates to zero. `retryable` means a caller could retry later, not that doing so is free or idempotent. A timed-out request may already have incurred cost, and successful-attempt usage can omit failed-attempt costs.

## Output schema and parser

[`output.ts`](../output.ts) exports `classifyOutputSchema` (JSON Schema 2020-12) and `parseClassifyOutput`. Package consumers can import them from `opencode-classify-plugin/output`, and types from `opencode-classify-plugin/types`:

```ts
import { parseClassifyOutput } from "opencode-classify-plugin/output";

const output = parseClassifyOutput(raw); // Structured object, or legacy JSON text.
if (output.ok) {
  console.log(output.result.answers);
} else {
  console.log(output.error.code, output.error.path, output.error.retryAfterMs);
}
```

The parser checks the envelope, required measurements, distributions, score bounds, and diagnostics without rounding or renormalizing. It throws a sanitized `TypeError` for malformed output, including `null`. JSON Schema expresses structural constraints; the parser also enforces distribution sums and cross-field consistency. Neither verifies agreement with an original request it has not received.

OpenCode receives a typed output object. Callers migrating from string results should remove `JSON.parse`; the public parser still accepts legacy JSON text. Native field names remain unchanged, diagnostics and score bounds are additive, and published TypeScript types reflect required native measurements.

The JSON Schema is generated from the Effect output definition. It uses `anyOf` for discriminated alternatives and `$defs` for referenced definitions. Consumers inspecting the previous inline `oneOf` layout must update those lookups; validators should consume the complete document, including `$defs`.

## Backend-selection RPC

The exported [`./rpc`](../rpc.ts) entry defines `ClassifyBackends` (`classify-backends`) with `list`, `getSelection`, and `setSelection` methods and a `changed` event.

Pass the session ID and the session's location when calling RPC from a client; omit `backend` in `setSelection` to reset. Requests outside the plugin instance's location are rejected. If a stored profile was removed, `getSelection` returns the declared `unknown_backend` error with `data.defaultBackend` for recovery. Storage and session-access failures remain `unavailable`.

Events are live-only: read selection again after reconnecting. See [session selection](./CONFIGURATION.md#session-selection) for persistence, switching, and recovery behavior.
