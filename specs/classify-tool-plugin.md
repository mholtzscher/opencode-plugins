# Classify tool plugin

Status: Reviewed with no feedback. Ready for task breakdown. Implementation has not started. Date: 2026-09-30 Effort: L for the TypeSafe/Laya release. OpenAI implementation requires a separate estimate after its API contract is verified.

## Problem

OpenCode agents need a tool for bounded judgments without asking a generative model to produce and parse an answer. The caller supplies the content to evaluate and typed questions. The tool returns decisions and the provider's uncertainty measurements.

The plugin must support ad hoc questions and reusable named classifiers. The user chooses the backend in configuration, not in tool arguments. The target backends are TypeSafe AI, OpenAI Decisions, and an externally managed Laya server. The former `kev` provider is rejected; it is not an alias for `laya`.

## Agreed scope

- Register one server-side tool named `classify`.
- Support native `noul`, `choice`, and `score` questions.
- Evaluate a question map against one shared state per call.
- Support ad hoc question maps and named classifiers stored in plugin options.
- Return native results. Do not threshold probabilities into booleans or decide what counts as uncertain.
- Implement TypeSafe and Laya using their shared System One HTTP contract.
- Include an explicit OpenAI adapter gate. TypeSafe/Laya may ship before OpenAI is available.
- Connect to an externally managed Laya HTTP server. Do not manage model processes in the plugin.

## Discovery and constraints

### Repository

Each plugin is an independent TypeScript/Bun package with its own `package.json`, `bun.lock`, and `tsconfig.json`. There is no Bun workspace. Use `@opencode/plugin` and `Plugin.define`, following `github-tools/index.ts` for the server entry pattern.

OpenCode V2 registers tools with `ctx.tool.transform`. Tool executors receive a cancellation signal. Configuration comes from `ctx.options` through the object form of a `plugins` entry.

The new package will be `classify/`, with package name `opencode-classify-plugin` and plugin ID `classify`. Keep both server and TUI exports consistent with the repository. The TUI entry is a no-op. Classification and credentials live exclusively on the OpenCode server.

Do not automatically activate the plugin in the root `opencode.jsonc`. Update the root README's plugin inventory and development guidance during implementation. Correct its stale statement that the root configuration loads all plugins when touching that section.

### Verified provider behavior

| Backend | Verified contract | Consequence |
| --- | --- | --- |
| TypeSafe AI | `POST https://api.typesafe.ai/v1/systemone`; bearer authentication; `state`, `model`, and `questions`; typed `answers` and token usage | Implement directly against the official HTTP API. |
| Laya | `POST /v1/systemone`; TypeSafe-compatible answer shapes; optional bearer authentication via `LAYA_API_KEY` | Share request serialization and response validation with TypeSafe, but document different limits and confidence semantics. |
| OpenAI Decisions | Announced as a limited preview using Luna with predefined answers. No public wire contract found in the documentation checked on this date | Do not guess its endpoint, model ID, schemas, probability semantics, or batching behavior. |

`noul` is a probability of yes in `[0, 1]`, not a misspelling of boolean. It has no separate native confidence field. `choice` returns one allowed label and a distribution. `score` returns a probability-weighted position on ordered levels and may be fractional. Choice and score have provider-supplied confidence, which is not a probability of correctness.

The official TypeSafe API permits at most 255 choice options and 10 score levels. The plugin validates 2–255 choices and 2–10 score levels. Laya's HTTP server caps choice questions at 100 options, with smaller practical token budgets that can trim similar labels into indistinguishable inputs. These are plugin validation rules, not claims that all providers have identical limits. Laya's choice/score confidence is one minus normalized entropy, unlike Jev's confidence formula; thresholds must be validated for the chosen backend. Long states can be silently truncated, and the plugin does not expose Laya's token-budget controls or extra routing/confidence metadata.

## Recommendation and alternatives

Use a small shared classification service, a System One adapter reused by TypeSafe/Laya, and a separate gated OpenAI adapter. Keep provider wire formats out of tool registration.

| Approach | Benefit | Cost | Decision |
| --- | --- | --- | --- |
| Ad hoc TypeSafe-only tool | Smallest implementation | Omits reusable classifiers and local inference | Does not meet the agreed scope. |
| Shared service with TypeSafe/Laya and gated OpenAI | Working hosted and local paths with a stable tool contract | OpenAI cannot be advertised as working yet | Recommended. |
| Model hosting, backend routing, fallback, and classifier UI | More automation and controls | Adds process management, privacy policy, persistent state, and UI work | Outside v1. |

Use native `fetch` rather than a provider SDK for the verified System One contract. This keeps cancellation, request limits, retries, and error sanitization under one implementation. Revisit if the real OpenAI contract requires an SDK.

## Tool contract

Register `classify` without a namespace. Its JSON Schema has two exclusive object branches, both with `additionalProperties: false`:

1. Ad hoc mode requires `state` and `questions`.
2. Named mode requires `state` and `classifier`.

Never accept both `questions` and `classifier`. Neither branch accepts a provider, model, endpoint, credentials, or arbitrary request headers.

Descriptions must distinguish the content in `state` from the judgment in `instructions`. Question IDs are response keys, not instructions to the model. Questions in a map are independent. For judgments that depend on previous answers, the caller makes another tool call.

### OpenCode tool definition

The planned server entry in `classify/index.ts` registers this definition. This is specification code, not an implementation added to the repository:

```ts
import { Plugin } from "@opencode/plugin";
import { parseOptions } from "./config.js";
import { createAdapter } from "./providers/adapter.js";
import { buildToolInputSchema } from "./schema.js";
import { createClassifier } from "./service.js";

export default Plugin.define({
  id: "classify",
  async setup(ctx) {
    const options = parseOptions(ctx.options);
    const service = createClassifier(options, createAdapter(options));
    const classifiers = Object.entries(options.classifiers ?? {});
    const description = [
      "Evaluate content against independent typed questions using the user's configured decision backend.",
      "Put the content being judged in state and each judgment in question.instructions.",
      "noul returns the probability of yes; choice selects one allowed label; score rates ordered rubric levels.",
      "Supply questions for an ad hoc request, or classifier for a configured question map, never both.",
      "Returns native results and available uncertainty data, not explanations or permission to execute an action.",
      ...(classifiers.length === 0
        ? []
        : [
            "Configured classifiers:",
            ...classifiers.map(
              ([name, value]) => `${name}: ${value.description}`
            ),
          ]),
    ].join("\n");

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "classify",
        description,
        input: buildToolInputSchema(options.classifiers ?? {}),
        execute: async (input, context) => {
          const output = await service.classify(input, context.signal);
          return { content: JSON.stringify(output) };
        },
      });
    });
  },
});
```

`buildToolInputSchema` in `classify/schema.ts` must produce a concrete JSON Schema, not an unconstrained object. Its generated definition follows this shape:

```ts
import type { ClassifierDefinition } from "./config.js";

export function buildToolInputSchema(
  classifiers: Record<string, ClassifierDefinition>
) {
  const content = {
    anyOf: [
      { type: "string", minLength: 1 },
      { type: "object", minProperties: 1 },
      { type: "array", minItems: 1 },
    ],
  };
  const question = {
    oneOf: [
      {
        type: "object",
        properties: {
          type: { const: "noul" },
          instructions: content,
          criteria: {
            type: "object",
            properties: { true: content, false: content },
            minProperties: 1,
            additionalProperties: false,
          },
        },
        required: ["type", "instructions"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { const: "choice" },
          instructions: content,
          criteria: {
            type: "object",
            minProperties: 2,
            maxProperties: 255,
            propertyNames: { type: "string", minLength: 1, maxLength: 128 },
            additionalProperties: { anyOf: [content, { type: "null" }] },
          },
        },
        required: ["type", "instructions", "criteria"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { const: "score" },
          instructions: content,
          criteria: {
            type: "array",
            items: content,
            minItems: 2,
            maxItems: 10,
          },
        },
        required: ["type", "instructions", "criteria"],
        additionalProperties: false,
      },
    ],
  };
  const adHoc = {
    type: "object",
    properties: {
      state: content,
      questions: {
        type: "object",
        minProperties: 1,
        maxProperties: 64,
        propertyNames: { pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$" },
        additionalProperties: question,
      },
    },
    required: ["state", "questions"],
    additionalProperties: false,
  };
  const names = Object.keys(classifiers);
  return names.length === 0
    ? adHoc
    : {
        type: "object",
        oneOf: [
          adHoc,
          {
            type: "object",
            properties: {
              state: content,
              classifier: { type: "string", enum: names },
            },
            required: ["state", "classifier"],
            additionalProperties: false,
          },
        ],
      };
}
```

The implementation must typecheck this schema against the installed V2 plugin API and exercise it through the real tool registration in A11. Runtime validation additionally enforces whitespace, JSON depth/size, and response constraints that this schema cannot fully express.

### Usage examples

The following JSON blocks are arguments to the agent's `classify` tool, not direct HTTP requests. The plugin adds the configured model and authentication. Example responses below are illustrative, not measured provider calls.

#### Yes/no probability

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

Read `result.answers.refund_requested.noul` as the probability of yes. A result of `0.98` remains a number. The caller may compare it to a threshold, but the tool does not issue a refund or return an invented boolean.

#### One allowed label

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

Read `result.answers.change_kind.choice` as one of the supplied labels. `unknown` is an explicit caller-defined label, not an automatic low-confidence fallback.

#### Fractional rubric score

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

Read `result.answers.impact.score` on the supplied zero-based scale of 0–2. A value such as `1.6` is valid and remains fractional. It is not a probability of an incident and is not automatically rescaled to 0–100.

#### Several independent judgments in one call

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

#### Configured named classifier

```json
{
  "state": { "message": "Production is down after the deploy." },
  "classifier": "incident-triage"
}
```

Named mode uses the stored question map unchanged. The agent cannot override its questions. Include each configured classifier's name and description in the tool description, and enumerate names in the named-mode schema. With no classifiers configured, omit the named branch. No separate discovery tool is needed.

#### Successful tool output

This illustrative response matches the mixed incident example. The actual OpenCode tool content is the JSON serialization of this envelope:

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
    "durationMs": 145
  }
}
```

Named-mode success additionally includes `result.classifier`. `requestID` is optional and appears only when supplied by the provider.

#### Failed tool output

```json
{
  "ok": false,
  "error": {
    "code": "PROVIDER_UNAVAILABLE",
    "message": "OpenAI Decisions is unavailable until its documented API adapter is implemented. Configure TypeSafe or Laya instead.",
    "retryable": false,
    "provider": "openai-decisions"
  }
}
```

The caller checks `ok` before reading answers. Errors contain no partial classification. Session interruption does not produce this envelope; OpenCode treats it as cancellation.

## Types

All types below are new. `classify/types.ts` owns the public classification contract and errors. `classify/config.ts` owns options. Runtime validation remains required; TypeScript declarations alone do not validate tool input or HTTP responses.

```ts
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type Content = string | JsonValue[] | { [key: string]: JsonValue };
export type ProviderID = "typesafe" | "laya" | "openai-decisions";
export type QuestionType = "noul" | "choice" | "score";

export type Question =
  | {
      type: "noul";
      instructions: Content;
      criteria?: { true?: Content; false?: Content };
    }
  | {
      type: "choice";
      instructions: Content;
      criteria: Record<string, Content | null>;
    }
  | {
      type: "score";
      instructions: Content;
      criteria: Content[];
    };

export type Questions = Record<string, Question>;

export type ClassifyInput =
  | { state: Content; questions: Questions; classifier?: never }
  | { state: Content; classifier: string; questions?: never };

export interface DecisionRequest {
  state: Content;
  questions: Questions;
}

export type Answer =
  | { type: "noul"; noul: number }
  | {
      type: "choice";
      choice: string;
      probabilities?: Record<string, number>;
      confidence?: number;
    }
  | {
      type: "score";
      score: number;
      legend?: Record<string, string>;
      probabilities?: Record<string, number>;
      confidence?: number;
    };

export interface DecisionResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens?: number; output_tokens?: number };
  requestID?: string;
}

export interface ClassifyResult extends DecisionResponse {
  provider: ProviderID;
  classifier?: string;
  durationMs: number;
}

export type ErrorCode =
  | "INVALID_CONFIG"
  | "INVALID_INPUT"
  | "UNKNOWN_CLASSIFIER"
  | "MISSING_CREDENTIALS"
  | "PROVIDER_UNAVAILABLE"
  | "UNSUPPORTED_TYPE"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "REQUEST_REJECTED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "INPUT_TRUNCATED"
  | "INTERNAL_ERROR";

export interface Failure {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  provider?: ProviderID;
  status?: number;
}

export type ClassifyOutput =
  { ok: true; result: ClassifyResult } | { ok: false; error: Failure };
```

TypeSafe and Laya require all their documented fields, including choice/score distributions and confidence, score legends, and token usage. The optional fields in the common response allow future OpenAI results without invented measurements. Missing native fields in TypeSafe/Laya are errors, not permission to omit them.

An OpenAI adapter must not convert an arbitrary confidence score into `noul`. It may support `noul` only if it can obtain a documented probability of yes. A categorical yes/no selection alone is not equivalent. Capability failures return `UNSUPPORTED_TYPE` before dispatch, never a disguised chat request.

### Configuration types

```ts
export type BackendOptions =
  | {
      provider: "typesafe";
      model?: string;
      apiKeyEnv?: string;
    }
  | {
      provider: "laya";
      baseURL?: string;
      model?: string;
      apiKeyEnv?: string;
    }
  | {
      provider: "openai-decisions";
      model?: string;
      apiKeyEnv?: string;
    };

export interface ClassifierDefinition {
  description: string;
  questions: Questions;
}

export interface ClassifyOptions {
  backend: BackendOptions;
  timeoutMs?: number;
  maxRetries?: number;
  classifiers?: Record<string, ClassifierDefinition>;
}
```

- `backend` is required. Do not infer a backend from available keys or select a cloud backend by default.
- TypeSafe defaults to model `jev-latest`, environment variable `TYPESAFE_API_KEY`, and the fixed official endpoint.
- Laya defaults to checkpoint `english` and origin `http://127.0.0.1:8000`. Other checkpoint names include `multilingual` and `typed-decisions`. It sends no authorization header unless a credential source is configured. If `apiKeyEnv` is configured, the variable must be present and nonempty. `model` selects a checkpoint per request, not a serving alias.
- OpenAI reserves environment variable `OPENAI_API_KEY`. Its model default is deliberately not defined before the implementation gate. The gated implementation does not resolve credentials or send a request.
- `timeoutMs` defaults to 30,000. Accept integers from 1,000 through 300,000.
- `maxRetries` defaults to 1. Accept integers from 0 through 2. It counts retries after the initial attempt.
- Allow at most 32 named classifiers. Each description is a nonblank string of at most 512 characters.
- Unknown option fields are configuration errors. Never accept literal secrets in plugin options.
- Parse configuration into an immutable snapshot during setup. Changes take effect on plugin reload. Do not persist options or results in plugin storage.

### Example configurations

Each example is an alternative `opencode.jsonc` configuration. Merge its plugin entry into the existing `plugins` array rather than replacing unrelated configuration. `./classify` assumes a local checkout; the implementation README must also document this repository's GitHub subdirectory installation form.

#### Hosted TypeSafe with ad hoc questions

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./classify",
      "options": {
        "backend": { "provider": "typesafe" },
      },
    },
  ],
}
```

Set `TYPESAFE_API_KEY` in the OpenCode server environment. This uses `jev-latest`, a 30-second invocation deadline, and one permitted retry for explicit rate-limit/overload responses. With no configured classifiers, only ad hoc mode appears in the tool schema. To select an available pinned model, set `backend.model` to the exact model ID documented by TypeSafe; do not assume the illustrative response version is available to the account.

#### Unauthenticated loopback Laya with a named classifier

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
        },
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

Run Laya separately on port 8000. This configuration sends no authorization header, selects the `english` checkpoint, and enables both ad hoc requests and `incident-triage`.

#### Authenticated local Laya with reusable classifiers

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

Set `LAYA_API_KEY` for both the separately started Laya process and the OpenCode server. The values must match. The longer deadline permits slower local inference; the plugin still does not start Laya or wait for it to boot. `maxRetries: 0` disables automatic retries.

With this config, the agent can invoke `classify` with `{ "state": "Fix stale cache after deploy", "classifier": "change-kind" }`, or submit an ad hoc question map. Both use the same configured backend.

#### Self-hosted Laya behind HTTPS

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

Replace the example origin with the operator's endpoint and set `COMPANY_LAYA_API_KEY` in the OpenCode server environment. The server or proxy must expose `/v1/systemone` without redirecting. Non-loopback HTTP origins are rejected. This uses the same Laya adapter, not a fourth backend or a plugin-managed deployment.

#### Reserved OpenAI Decisions configuration

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./classify",
      "options": {
        "backend": { "provider": "openai-decisions" },
      },
    },
  ],
}
```

This configuration is valid but unavailable in the initial release. Every invocation returns the gated `PROVIDER_UNAVAILABLE` error above without a network call or credential lookup. It does not use OpenAI chat or Responses as a substitute. Only after the gate is complete will the README document a verified model and working authentication requirements.

For any backend, environment variables belong on the OpenCode server. Keys on the TUI machine do not configure a remote server. Never put a literal key in these configuration objects.

## Interfaces and ownership

`classify/providers/adapter.ts` owns the provider boundary. `classify/service.ts` owns named-classifier resolution and capability checks. `classify/schema.ts` owns input, question, and response validation plus the generated tool schema.

```ts
export interface DecisionAdapter {
  readonly provider: ProviderID;
  readonly supportedTypes: readonly QuestionType[];
  decide(
    request: DecisionRequest,
    signal: AbortSignal
  ): Promise<DecisionResponse>;
}

// config.ts
export function parseOptions(value: unknown): ClassifyOptions;

// schema.ts
export function parseInput(value: unknown): ClassifyInput;
export function parseQuestions(value: unknown): Questions;
export function validateResponse(
  value: unknown,
  request: DecisionRequest,
  provider: "typesafe" | "laya"
): DecisionResponse;

// service.ts
export function createClassifier(
  options: ClassifyOptions,
  adapter: DecisionAdapter
): {
  classify(input: unknown, signal: AbortSignal): Promise<ClassifyOutput>;
};

// providers/adapter.ts
export function createAdapter(options: ClassifyOptions): DecisionAdapter;
```

The adapter factory returns a TypeSafe/Laya adapter or an unavailable OpenAI adapter. The unavailable adapter exposes no supported types and reports `PROVIDER_UNAVAILABLE`, rather than allowing the generic capability check to report an unsupported type. It must fail without accessing credentials or the network.

Internal code may throw typed classification errors. The service converts expected failures into `ClassifyOutput`. Unexpected failures become a sanitized `INTERNAL_ERROR`. Session cancellation is rethrown and remains an OpenCode interruption, not a successful tool completion containing a cancellation message.

`index.ts` validates options and registers the tool through `Plugin.define` and `ctx.tool.transform`. Its executor passes `context.signal` to the service and returns `{ content: JSON.stringify(output) }`. Successful answers appear only inside `ok: true`. A failed call never returns partial answers.

Invalid configuration stops this plugin's setup with a sanitized configuration error. A valid configuration with missing credentials or a gated provider still registers the tool and reports an actionable failure on invocation. Setup performs no network requests or model downloads.

## Validation rules

- `state` and `instructions` accept nonblank strings, nonempty JSON objects, or nonempty JSON arrays. Nested JSON may contain null, booleans, and finite numbers. No undefined values, nonfinite numbers, cycles, or non-JSON objects.
- Each call has 1–64 questions. Each classifier's stored map obeys the same limits.
- Question IDs and classifier names match `^[A-Za-z][A-Za-z0-9_-]{0,63}$`.
- Choice criteria have 2–255 distinct nonblank labels, each at most 128 characters. Preserve label spelling and descriptions. Treat map entries as own properties, including labels such as `__proto__` and `constructor`.
- Score criteria have 2–10 nonempty level descriptions. The score range is `[0, levels.length - 1]`. Do not round to an integer or rescale it.
- Noul criteria may contain only `true` and `false`. If provided, at least one description must be present.
- Reject unknown fields in tool objects and question definitions. Permit extra upstream response fields, but return only documented, validated fields.
- Reject a serialized System One request exceeding 1 MiB and JSON nesting deeper than 32 levels before dispatch. Apply the same bounded traversal to options and tool inputs.
- Bound the response body to 1 MiB while reading its stream. A larger response is `INVALID_RESPONSE`. Do not rely only on `Content-Length`.
- Response question IDs must exactly match the requested IDs and answer types must match their questions.
- Noul and confidence values must be finite and within `[0, 1]`. All distributions must contain exactly the requested labels or score indices, with finite probabilities in `[0, 1]` and absolute sum error less than `0.02`. This is a plugin validation tolerance for rounded distributions. Do not renormalize distributions.
- Choice must be an allowed label. Score legends must contain exactly the expected level indices with string values. Return the validated upstream legend, including its rendering of structured levels.
- Native token counts must be nonnegative integers. `model` must be a nonblank string. Preserve the model reported by the provider rather than replacing it with the requested alias.
- If Laya reports `truncated: true`, reject with `INPUT_TRUNCATED`. A missing marker does not prove the server read the input in full; Laya can silently truncate long states. Use short inputs and validate them on the selected checkpoint.

## Transport, errors, and privacy

### System One requests

Serialize `{ state, model, questions }` without merging state and instructions into a prompt. TypeSafe uses its fixed HTTPS endpoint. For Laya, `baseURL` is an HTTP or HTTPS origin with an optional trailing slash, not a URL containing an API path, query, fragment, or user information. Append `/v1/systemone` exactly once.

Permit HTTP only for `localhost`, `127.0.0.1`, and `[::1]`. Non-loopback Laya endpoints require HTTPS. This is a transport constraint, not protection against malicious user configuration or DNS changes. Tool arguments cannot change the configured destination. Use `redirect: "error"` so credentials and state cannot follow a redirect.

Resolve the selected API-key environment variable at invocation time. Never enumerate unrelated environment variables. Do not copy credentials into tool output, descriptions, errors, logs, or storage.

### Cancellation and retries

One timeout deadline covers dispatch, response reads, retry delays, and all attempts. Combine it with the session signal and release timers/listeners after completion. Pre-aborted signals cause no HTTP request.

Retry only explicit HTTP `429` and TypeSafe-compatible `529` responses. Before OpenAI is implemented, its retryable statuses remain behind the gate. Do not retry authentication errors, validation failures, malformed successful responses, network failures, or timeouts. A timed-out request may already have incurred cost.

Use an abortable exponential delay of 500 ms for the first retry and 1,000 ms for the second. Honor a valid `Retry-After` delay when it is longer. If the next delay reaches or exceeds the remaining deadline, return the original retryable error without another attempt. No retries change backend or model.

| Failure | Result |
| --- | --- |
| Missing configured key | `MISSING_CREDENTIALS`, no HTTP request |
| Unknown classifier | `UNKNOWN_CLASSIFIER`, no HTTP request |
| Unsupported question type | `UNSUPPORTED_TYPE`, no HTTP request |
| Gated OpenAI adapter | `PROVIDER_UNAVAILABLE`, no HTTP request |
| HTTP 401/403 | `AUTH_FAILED`, no retry |
| HTTP 429 after attempts are exhausted | `RATE_LIMITED`, retryable |
| HTTP 529 after attempts are exhausted, or other 5xx | `PROVIDER_UNAVAILABLE`, retryable; other 5xx are not automatically retried |
| Other non-success HTTP status, including 422 | `REQUEST_REJECTED`, no retry |
| Fetch connection failure | `NETWORK_ERROR`, retryable but no automatic retry |
| Deadline expiry | `TIMEOUT`, retryable but no automatic retry |
| Invalid/oversized JSON or mismatched answer map | `INVALID_RESPONSE`, no retry |
| Explicit upstream truncation | `INPUT_TRUNCATED`, no retry |

`retryable` means a caller could retry later, not that retrying is free or idempotent. Retain a validated `x-typesafe-request-id` as `requestID` when present. `durationMs` measures the entire invocation, including retries, with a monotonic clock. Preserve usage when supplied. Do not infer prices or add usage for failed attempts that the upstream did not report.

### Privacy and side effects

Only caller-supplied `state` and the selected question map leave the server. The plugin does not read files, gather session history, fetch URLs embedded in state, or run the selected decision as an action.

Calls may send private content to the configured backend and incur API charges. The README must say this explicitly and explain that normal OpenCode tool input/output history may retain the submitted state and answers. No additional classifier cache, history database, telemetry, or audit store exists in v1.

Error messages are locally constructed. Do not include raw upstream bodies, arbitrary thrown messages, input snippets, or authorization headers. High confidence does not authorize another tool or make a decision correct. Normal OpenCode permissions still govern subsequent actions.

## Local Laya integration

Use Laya's HTTP server, not an OpenAI-compatible chat server. Checkpoint, hardware, precision, and runtime requirements belong to the operator, not the plugin.

Start a separately managed Laya 0.3.22 server:

```sh
LAYA_HOST=127.0.0.1 LAYA_PORT=8000 LAYA_MODELS=english uv tool run --python 3.12 --torch-backend=auto --from 'laya[serve]==0.3.22' laya-serve
```

The first run installs dependencies and downloads weights. Set `LAYA_HOST=127.0.0.1` explicitly because Laya otherwise binds to all interfaces. For authenticated local use, set `LAYA_API_KEY` when starting Laya and configure the plugin's `apiKeyEnv` to name the server-side variable holding the same key. The repository also offers opt-in `mise daemons start laya` with mise 2026.9.18 or later; `mise run opencode` does not start Laya or change the root TypeSafe backend.

`model` selects `english`, `multilingual`, or `typed-decisions` per request. `LAYA_MODELS` controls preloading, not which checkpoints clients can select. Unknown model names fall back to Laya's automatic routing, so check configured names carefully. The response's model string does not identify immutable weights. Inspect `GET /health` for loaded checkpoints, revisions, and actual devices when verifying a local deployment.

Do not install Python, download weights, expose a listener, poll the server, or kill its process as part of plugin setup/unload. A down server produces a normal network error.

## OpenAI implementation gate

The initial `providers/openai-decisions.ts` is an explicit unavailable implementation. It must not issue a guessed `/v1/decisions` request or substitute the Responses API, chat completion, or TypeSafe's hosted LLM adapter.

Before implementing the real adapter, its implementer must obtain authoritative public documentation or user-provided preview documentation and account access. Update this spec with:

1. The exact endpoint or SDK method, authentication, model IDs, and versioning.
2. Supported input formats, choice/rubric limits, and whether questions can share a request.
3. The response shape, refusal behavior, and meaning of each score, probability, and confidence field.
4. Its mapping to each supported native tool type. Types with no faithful mapping remain unsupported.
5. Cancellation, deadlines, request IDs, token usage, rate limits, and documented retry behavior.
6. Sanitized contract fixtures and a live smoke-test procedure.

If OpenAI only supports one question per request, document the fan-out behavior, partial-failure policy, usage aggregation, concurrency bound, and cost before enabling question-map calls. Do not silently add that policy during adapter implementation.

Gate owner: the implementing developer. The user provides preview materials/access if private documentation is needed. Completion of this gate is not required to release the TypeSafe/Laya plugin. The initial README must label OpenAI unavailable, not supported.

## Project layout

```text
specs/
└── classify-tool-plugin.md          # new: this specification
classify/                           # new: independent plugin package
├── package.json                    # new: server/TUI exports, test and typecheck scripts
├── bun.lock                        # new: dependencies installed within classify/
├── tsconfig.json                   # new: strict TypeScript, include nested providers/tests
├── README.md                       # new: setup, usage, privacy, errors, provider status
├── index.ts                        # new: plugin setup and classify registration
├── tui.ts                          # new: no-op TUI entry, no credentials or inference
├── types.ts                        # new: questions, answers, results, typed errors
├── config.ts                       # new: options validation and defaults
├── schema.ts                       # new: tool schema and runtime contract validation
├── service.ts                      # new: request resolution, capability checks, output envelope
├── transport.ts                    # new: bounded fetch, deadlines, retries, HTTP error mapping
├── providers/
│   ├── adapter.ts                  # new: DecisionAdapter interface and factory
│   ├── system-one.ts               # new: shared TypeSafe/Laya serialization and decoding
│   └── openai-decisions.ts         # new: unavailable adapter, later replaced after gate
└── tests/
    ├── config.test.ts              # new: options, defaults, credential/URL restrictions
    ├── schema.test.ts              # new: input and upstream answer validation
    ├── service.test.ts             # new: named/ad hoc behavior and result envelopes
    ├── transport.test.ts           # new: local HTTP fixtures, retries, deadlines, redaction
    └── plugin.test.ts              # new: fake OpenCode host, tool schema and cancellation
README.md                           # modify: plugin inventory and focused verification
```

Use flat application files and a small `providers/` directory. No general plugin framework, provider registry, RPC API, or generated client is needed. The package's only runtime dependency initially is `@opencode/plugin`, using the repository's compatible V2 version. Add TypeScript and Bun/Node types as development dependencies. Define `test: "bun test"` and `typecheck: "tsc --noEmit"`; include nested source and test files in the compiler configuration.

Existing plugin code, root dependencies, and the root plugin activation list are unchanged.

## Deliverables

| ID | Outcome | Effort | Owning paths | Dependencies | Acceptance |
| --- | --- | --- | --- | --- | --- |
| D1 | Independent package plus validated types, configuration, and tool schema | M | `classify/package.json`, `bun.lock`, `tsconfig.json`, `types.ts`, `config.ts`, `schema.ts`, `tests/config.test.ts`, `tests/schema.test.ts` | None | A1, A2, A3 |
| D2 | Working System One transport for TypeSafe and Laya, with failures and cancellation | L | `classify/transport.ts`, `providers/adapter.ts`, `providers/system-one.ts`, `tests/transport.test.ts`, response tests in `tests/schema.test.ts` | D1 | A4, A5, A6, A7, A8 |
| D3 | Ad hoc/named service, gated OpenAI behavior, and OpenCode tool integration | M | `classify/service.ts`, `providers/openai-decisions.ts`, `index.ts`, `tui.ts`, `tests/service.test.ts`, `tests/plugin.test.ts` | D1, D2 | A9, A10, A11 |
| D4 | Documentation and release validation for the verified backends | M | `classify/README.md`, root `README.md`, all package verification | D3 | A12, A13 |
| D5 | Real OpenAI Decisions adapter after verified API discovery | Estimate after gate | `classify/providers/openai-decisions.ts`, any new OpenAI contract tests, `classify/README.md`, this spec's OpenAI contract | D3 and OpenAI gate | A14 |

D1–D4 define the initial releasable plugin. D5 is a blocked follow-up, not an implicit obligation to invent an integration. D2 includes shared transport and contract tests so this work has an explicit owner.

## Acceptance and validation

Run these commands from `classify/` after installing dependencies there. `bun run check` runs from the repository root. Live provider checks are explicit opt-in manual checks, not part of `bun test`.

| ID | Behavior to check | Expected result | Procedure and prerequisites |
| --- | --- | --- | --- |
| A1 | Independent package and both entries compile | No root workspace required; server and no-op TUI typecheck | In `classify/`, run `bun install`, then `bun run typecheck`. |
| A2 | Input union, JSON bounds, and native question constraints | Both valid modes pass; both/neither selectors, blank input, excess questions/options/levels, deep JSON, and unknown fields fail before HTTP | `bun test tests/schema.test.ts`. Include minimum/maximum boundaries and special choice labels. |
| A3 | User-controlled backend configuration | Correct defaults; no inferred cloud provider; invalid URL/options fail; named classifier map obeys constraints | `bun test tests/config.test.ts`. |
| A4 | TypeSafe/Laya request contract | All three types and structured state/instructions serialize into the same correct System One body; only endpoint/model/auth differ | `bun test tests/transport.test.ts` against an injected fetch/local fixture server. Assert HTTP method, path, headers, and body. |
| A5 | Upstream answer validation | Valid values pass unchanged, including fractional scores; missing/extra question IDs, wrong types/labels, bad probability sums, nonfinite/out-of-range values, bad legends/usage, and truncated input fail atomically | `bun test tests/schema.test.ts`. Include a rounded 255-label distribution within tolerance and one outside it. |
| A6 | Deadline and session interruption | Abort reaches in-flight requests, response reads, and retry waits; pre-abort sends no request; deadline covers all attempts; no retry or completed success after cancellation | `bun test tests/transport.test.ts` and `bun test tests/plugin.test.ts`. Use controlled signals and delayed local responses. |
| A7 | Retry/error mapping | Only 429/529 automatically retry; configured attempt limit and Retry-After/deadline rules hold; 401/422, network failures, timeouts, and bad 200 bodies do not auto-retry | `bun test tests/transport.test.ts`. Assert attempt counts and terminal codes, including `maxRetries: 0`. |
| A8 | Privacy and response limits | Keys and submitted secrets do not appear in errors/logs; redirects fail; oversized streamed bodies fail; only configured environment variable is used | `bun test tests/transport.test.ts`. Use sentinel secrets, a malicious error body, a redirect server, and a chunked response exceeding 1 MiB. |
| A9 | Named/ad hoc resolution | Stored questions are unchanged; unknown names and illegal overrides send no request; response reports provider, model, optional classifier, usage, and duration | `bun test tests/service.test.ts` with a recording adapter. |
| A10 | OpenAI gate | Configuring OpenAI gives `PROVIDER_UNAVAILABLE` with zero credential reads and HTTP calls; no chat fallback | `bun test tests/service.test.ts`. Assert the factory's unavailable behavior. |
| A11 | OpenCode registration and lifecycle | Exactly one unnamespaced `classify` tool; named classifiers discoverable; content is a valid output envelope; signal forwarded; setup has no network side effects; TUI has no inference | `bun test tests/plugin.test.ts`, then manually load only this plugin in a temporary V2 project and exercise the tool in the TUI or web client. |
| A12 | TypeSafe/Laya live smoke checks | A mixed question map returns validated noul/choice/score answers; native values/distributions survive; usage/model recorded; stopped Laya gives a sanitized network error | Manually load the plugin in a temporary project. Use TypeSafe with a valid server-side API key, then a separately started Laya server. Submit the ad hoc example and a named request. Inspect Laya `/health`; stop only the test server and repeat. Access/hardware required. Exact automated live command is outside this spec; document a tested procedure in `classify/README.md`. |
| A13 | Release docs, examples, and regression checks | README includes the concrete tool definition/contract, each native usage example, named/mixed usage, output envelopes, and the five config scenarios. Config examples validate, and their named calls resolve. Docs distinguish working TypeSafe/Laya from gated OpenAI; no root activation change; typecheck/tests pass; no new lint failures | In `classify/`, `bun run typecheck` and `bun test`; add example fixtures to `tests/config.test.ts` and `tests/service.test.ts` and validate them without external HTTP. From root, `bun run check`. Compare any existing lint failures against the unchanged baseline. Review `git diff` for unintended files. |
| A14 | Real OpenAI implementation | Verified documentation captured, only faithful supported types enabled, fixtures pass, live call succeeds, no synthesized probabilities or hidden fallback | Requires preview/public docs and account access. Add the exact fixture command and live procedure to this spec before D5 starts. A10 then becomes tests of the documented unavailable/access-denied cases rather than a permanent stub. |

Deterministic tests prove the tool contract and transport behavior, not model accuracy. Live smoke checks prove connectivity and valid native responses. Threshold tuning and comparative accuracy require representative labeled data and are outside v1.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| OpenAI's eventual API does not match System One types or batching | A false claim of backend interchangeability | Keep the adapter unavailable until documented; use capability checks and a separate contract update. |
| A valid classification is incorrect or responds to hostile content | The agent may choose a bad next action | Keep classification separate from action execution; return uncertainty data without claiming correctness; retain normal tool permissions. |
| Probability/confidence semantics differ across backends or checkpoints | Shared thresholds give misleading results | Preserve provider identity and native fields; do not fabricate or normalize confidence; document alias and calibration limitations. |
| Local Laya precision, context limits, or optional truncation changes the judgment | Local results differ from hosted results or omit content | Reject reported truncation; document `/health` inspection, short inputs, and operator-owned serving settings. |
| External calls leak state or expose credentials in failures | Private source material or keys escape | User-selected backend, no fallback/redirects, explicit payload only, sanitized errors, no extra logging/storage. |
| Automatic retries incur additional charges | A single tool call costs more than one upstream attempt | Only retry explicit rate-limit/overload replies; bounded attempts/deadline; document that usage may not include failed attempts. |

## Non-goals

- Training/fine-tuning classifiers or measuring model quality against a dataset.
- Boolean threshold policies, abstention decisions, multilabel fan-out, or action execution.
- Image/audio inputs, arbitrary string generation, extraction schemas, or embeddings.
- Starting Laya from the plugin, choosing GPU hardware, downloading models, or deploying a server.
- Per-call backend/model overrides, automatic routing, provider fallback, or credential login UI.
- Session/file/URL ingestion, bulk state batches, persistent result caches, classifier editing tools, custom TUI panels, or RPC exports.

## Review and open items

- The user reviewed this specification and submitted no annotations. No design changes were requested.
- The implementing developer owns OpenAI contract discovery. The gate blocks D5 only.
- Live TypeSafe and Laya verification requires credentials/runtime access. If unavailable during implementation, report these checks as unverified rather than replacing them with mocked success claims.

## Sources

Original discovery checked on 2026-09-30; Laya provider references updated on 2026-10-01. Upstream `main` links are discovery evidence, not immutable version pins; record the Laya version and checkpoint revisions used for live verification. The serving command pins Laya 0.3.22, matching the repository's mise daemon.

- [OpenCode V2 server plugins](https://opencode.ai/v2/docs/build/plugins)
- [OpenCode V2 CLI plugins and exports](https://opencode.ai/v2/docs/build/plugins/cli)
- [TypeSafe official API reference](https://docs.typesafe.ai/api.md)
- [TypeSafe Noul semantics](https://docs.typesafe.ai/primitives/noul.md)
- [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript.md)
- [Laya repository, System One serving, limits, and checkpoint routing](https://github.com/NandhaKishorM/laya)
- [OpenAI DevDay announcements, Decisions preview](https://community.openai.com/t/devday-2026-announcements-and-developer-resources/1402006)
- [OpenAI public API documentation index checked for the wire contract](https://developers.openai.com/api/docs)
