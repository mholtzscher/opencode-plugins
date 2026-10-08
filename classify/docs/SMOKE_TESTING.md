# Classify smoke-testing plan

[Back to README](../README.md) · [Configuration](./CONFIGURATION.md) · [Development](./DEVELOPMENT.md)

Use this plan after changing or reloading the plugin. It covers the public tool, evidence resolution, configuration, credentials, and provider transport.

**A passing smoke test verifies connectivity and contracts, not model accuracy.** Record each case as PASS, FAIL, or NOT RUN. Do not count an expected rejection as a failure, or describe an untested backend as verified.

## 1. Safety and prerequisites

- Use a disposable Git repository and synthetic data. Never stage, commit, delete, or rewrite files in the user's real working tree to prepare tests.
- Successful hosted calls incur charges and send evidence to the configured backend. Group independent questions into one request where practical.
- Credentials must be available to the OpenCode **server**, not just the TUI. Use an environment-variable name or private key-file path; do not copy keys into fixtures, prompts, logs, or reports.
- Install the plugin's dependencies and run its automated tests first. From `classify/`, run `bun install`, `bun run typecheck`, and `bun test`. From the repository root, run `bun run check classify` and `bun run check`.
- Verify the effective plugin list: global/ancestor configuration can still contribute plugins and permissions to the disposable project.
- Prefer a separate interactive OpenCode client for the fixture. If moving an existing session, record its original directory and restore it before cleanup.
- Do not force authentication errors, rate limits, outages, or cancellation against production merely to exercise an error path. Use controlled fixtures.

## 2. Prepare a disposable project

Run the following from this repository's root. Node is only used to generate synthetic fixture files; it never reads credentials or calls the provider.

```sh
export CLASSIFY_PLUGIN_DIR="$(pwd)/classify"
node --input-type=module <<'JS'
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const directory = await mkdtemp("/tmp/opencode/classify-smoke-");
const git = (...args) => execFileSync("git", args, { cwd: directory });
const write = (path, content) => writeFile(join(directory, path), content);
git("init", "-q");
for (const path of ["staged.txt", "working.txt", "[literal].txt", "forbidden.txt"]) {
  await write(path, "original\n");
}
await write("deleted.txt", "REMOVE_ME\n");
await write("binary.dat", Buffer.from([0, 1, 2]));
git("add", ".");
git("-c", "user.name=Smoke Test", "-c", "user.email=smoke@example.invalid",
  "commit", "-qm", "Synthetic baseline");

await write("staged.txt", "STAGED_MARKER\n");
git("add", "staged.txt");
await write("working.txt", "WORKING_MARKER\n");
await write("[literal].txt", "LITERAL_MARKER\n");
await rm(join(directory, "deleted.txt"));
await write("untracked.txt", "UNTRACKED_MARKER\n");
const quoted = "quote' $(touch INJECTION_SHOULD_NOT_EXIST).txt";
await write(quoted, "QUOTED_MARKER\n");
git("add", "--", quoted);

await write("hello.txt", "FILE_MARKER café 日本語\n");
await symlink("hello.txt", join(directory, "alias.txt"));
await write("empty.txt", "");
await write("bom.txt", "\ufeffBOM_MARKER\n");
await write("long.txt", "a".repeat(2500) + " LONG_LINE_MARKER\n"
  + "\n".repeat(2100) + "TAIL_MARKER\n");
await write("invalid-utf8.txt", Buffer.from([255]));
await write("oversized.txt", "x".repeat(1048577));
await write("escaped.txt", '"'.repeat(600000));
await write("aggregate-a.txt", "a".repeat(600000));
await write("aggregate-b.txt", "b".repeat(600000));
await write("denied.txt", "SYNTHETIC_DENIED_MARKER\n");
await symlink("denied.txt", join(directory, "denied-alias.txt"));
await mkdir(join(directory, "folder"));

const config = {
  plugins: [{
    package: process.env.CLASSIFY_PLUGIN_DIR,
    options: {
      backends: { default: { provider: "typesafe" } },
      defaultBackend: "default",
      classifiers: {
        "incident-test": {
          description: "Synthetic incident check",
          questions: { active: {
            type: "noul",
            instructions: "Does the supplied evidence explicitly say production is down?",
          } },
        },
        "change-test": {
          description: "Transport-safe synthetic classification",
          questions: { kind: {
            type: "choice",
            instructions: "Select __proto__ for an outage, constructor otherwise.",
            criteria: [
              { label: "__proto__", description: "Production outage" },
              { label: "constructor", description: null },
            ],
          } },
        },
      },
    },
  }],
  permissions: [
    { action: "read", resource: "*denied.txt", effect: "deny" },
    { action: "shell", resource: "*forbidden.txt*", effect: "deny" },
  ],
};
await write("opencode.jsonc", JSON.stringify(config, null, 2));
console.log(directory);
JS
```

Save the printed path as `SMOKE_DIR` and open OpenCode in that directory. If using a key file or Laya instead of the default TypeSafe environment source, change **only the disposable project's** `backends.default` profile using the [configuration guide](./CONFIGURATION.md). Reload after changing options: they are an immutable setup snapshot. Do not overwrite an existing user's configuration.

On platforms without symlink support, mark symlink cases NOT RUN. Git must be installed for diff cases. Paths below are relative to the fixture session unless an absolute path is explicitly requested.

## 3. Calling the tool and judging results

### Live backend selection across clients

Configure two named profiles in the disposable project using the README's `backends` example. Use controlled local endpoints when checking routing; do not send real evidence to hosted profiles merely to test switching.

- In the TUI, open the command palette and choose **Classify: Select backend**. Verify profiles and model labels, current selection, cancel without changes, and the `(default)` marker on the configured backend's row. Selecting that row should clear the session override, without a separate reset option. OpenAI Decisions should be selectable.
- Verify the sidebar's **Classify** section shows the active profile, follows session/tab switches, updates after picker/slash changes and changes from another client, and refreshes on reconnect. With the sidebar open, the full profile name must remain readable (wrapping when necessary), without adding a line above the prompt or displacing the footer's path or shortcuts. Hide and reopen the sidebar: the indicator should disappear and return with the current selection. Unreadable selection must show `unavailable`, not an old or default backend. The home screen should not show a session-specific selection.
- In TUI, desktop, and web, run `/classify-backend`, `/classify-backend <name>`, and `/classify-backend reset`. Verify server-generated confirmation without an LLM turn or inference request.
- Open the same session in another client: verify it observes the selected profile and subsequent classification reports `result.backend` (or `error.backend`). A separate session should still use the configured default.
- Reconnect/reload and reopen the session: an explicit override should persist. Switching while a controlled request is in flight must not reroute that request or retries; the next call uses the new selection.
- Unknown names must not change selection. Remove an overridden profile and reload: calls should fail without HTTP until explicitly reset or switched, never silently fall back. Verify the TUI picker still opens without a current row and can select another profile or reset by choosing the configured default. Canceling must preserve the removed-profile override. A storage or transport failure must stop the picker rather than be treated as a removed profile.
- With a remote TUI, verify profiles and key files are resolved on the server. Picker/RPC output must not contain credentials, key-file paths, or environment-variable names.

Record desktop/web and remote-client cases as NOT RUN unless verified in those actual clients.

These examples are **tool arguments**, not provider HTTP bodies. Ask the agent to invoke `classify_decide` exactly as specified. In Code Mode, discover the `classify` namespace and use the returned `decide` signature. Do not have the agent read and copy file contents into `state` for evidence cases.

Check the `ok` discriminator before reading answers. The migrated tool returns structured output; do not call `JSON.parse` on it. Rerun these smoke checks in the real OpenCode host to verify Code Mode handling and native permissions.

For successes, require:

- Exactly the requested answer IDs and types, with no partial/missing answers.
- `noul`: a finite probability in `[0, 1]`, not a boolean.
- `choice`: an allowed label, every requested probability key, native confidence in `[0, 1]`, and probability sum with absolute error **less than `0.02`**.
- `score`: a finite value in `[0, levels.length - 1]`, every legend/distribution index, and native confidence in `[0, 1]`. Structured legends stay structured.
- Provider-reported model, nonnegative integer input/output token usage, and nonnegative duration. A valid provider request-ID header is preserved when present; its absence is not a failure.
- Named requests additionally contain the configured `result.classifier`.
- No rounding, renormalization, invented confidence, or automatic action execution.

Use clear synthetic facts to check that the backend received the evidence. High yes probabilities for present markers and low probabilities for absent markers are useful diagnostics, **not guaranteed numeric outputs**. Do not require an exact probability, confidence, or score. Fractional scores must remain fractional if returned; an integer result alone does not establish a bug.

For expected failures, require `ok: false`, a sanitized error, no `result`, and no partial answers. Input/evidence failures must not dispatch a provider request; verify this with a recording adapter or controlled HTTP fixture when necessary. Malformed calls may instead be rejected by the host's schema validator before the plugin runs. Record that separately as a host rejection.

### Mixed answer-type baseline

```json
{
  "state": "Production is down for every customer. A customer explicitly requests a refund.",
  "questions": {
    "urgent": {
      "type": "noul",
      "instructions": "Does this describe an active production outage?",
      "criteria": { "true": "Active outage", "false": "No active outage" }
    },
    "category": {
      "type": "choice",
      "instructions": "Classify the event.",
      "criteria": {
        "incident": "Active failure",
        "maintenance": "Planned maintenance",
        "other": null
      }
    },
    "impact": {
      "type": "score",
      "instructions": "Rate customer impact.",
      "criteria": [
        "No impact",
        "Some customers affected",
        "All customers affected"
      ]
    },
    "refund": {
      "type": "noul",
      "instructions": {
        "question": "Does the customer explicitly request a refund?"
      }
    }
  }
}
```

## 4. Live success matrix

Unless specified otherwise, use a `noul` question asking whether the relevant marker/fact occurs in the supplied evidence. Multiple rows can share a call.

| ID | Case / input | Expected result |
| --- | --- | --- |
| S01 | Mixed baseline above | All three native answer types; outage/refund evidence recognized. |
| S02 | Legacy string `state` | Plain text remains supported. |
| S03 | Legacy JSON object with `files: ["denied.txt", "missing.txt"]` but no marker | Classified as literal data; no file access. |
| S04 | Legacy array `[null, false, 2, "Production is down."]` | Valid content; nested primitives retained. |
| S05 | `{ "type": "evidence", "text": "Production is down." }` | Text-only evidence works. |
| S06 | Evidence `text` is an object or nonempty array | Structured text works. |
| S07 | Literal `{ "type": "evidence", "files": ["denied.txt"] }` nested under evidence `text` | Nested data remains inert; no recursive resolution. |
| S08 | String/object/array question instructions and descriptions; optional yes/no criteria | All supported content shapes accepted. |
| S09 | Choice maps with descriptions/null; choice entry lists | Same native map semantics and original labels. |
| S10 | Two-level score on a partial-impact fact | Native zero-based score preserved, including fractions if returned. |
| S11 | Several independent questions in one call | Each evaluates the shared state; none depends on another answer. |
| S12 | `classifier: "incident-test"` with text, array, or evidence state | Stored questions used; classifier name included. |
| S13 | `classifier: "change-test"` | Stored criteria list normalized safely; special label preserved. |
| S14 | Combined evidence `text`, `files: ["hello.txt"]`, and scoped `diffs` | All three evidence sources available in one request. |

## 5. File evidence matrix

Use `state: { "type": "evidence", "files": [...] }`.

| ID | Case | Expected result |
| --- | --- | --- |
| F01 | Relative `hello.txt` | `FILE_MARKER` received; supplied filename retained. |
| F02 | Absolute path to the same file | Same contents; resolved on the server. |
| F03 | Multiple files, including repeated references | Each requested entry represented; labels distinguish files. |
| F04 | `alias.txt` symlink | Same contents as `hello.txt`; canonical target checked for access. |
| F05 | `empty.txt` | Empty **file contents** accepted, unlike an empty `state` string. |
| F06 | Unicode in `hello.txt` | Both `café` and `日本語` preserved. |
| F07 | `bom.txt` | BOM retained in resolved contents; `BOM_MARKER` received. Verify exact preservation with the resolver fixture. |
| F08 | `long.txt` | Both `LONG_LINE_MARKER` and `TAIL_MARKER` received despite native read display limits. |
| F09 | `missing.txt` | `EVIDENCE_ERROR`. |
| F10 | `folder` directory | `EVIDENCE_ERROR`; not expanded into files. |
| F11 | `binary.dat` through `files` | `EVIDENCE_ERROR`; `files` is UTF-8 text only. Use explicit `images` for supported image evidence. |
| F12 | `invalid-utf8.txt` | `EVIDENCE_ERROR`. |
| F13 | `oversized.txt` | `EVIDENCE_ERROR`; no silent truncation. |
| F14 | `escaped.txt` (600,000 quote characters) | `INVALID_INPUT`: serialized JSON exceeds 1 MiB despite smaller raw bytes. |
| F15 | Both `aggregate-a.txt` and `aggregate-b.txt` | `EVIDENCE_ERROR`: aggregate raw evidence exceeds the budget. |
| F16 | Valid `hello.txt` followed by `missing.txt` | Entire call fails; no partial result/provider dispatch. |
| F17 | `*.txt` | Literal path, not a glob; missing literal file yields `EVIDENCE_ERROR`. |
| F18 | `denied.txt`, then `denied-alias.txt` | Both fail with `EVIDENCE_ERROR`; symlink cannot bypass read denial. |
| F19 | Path outside the session/project boundary | Native external-directory/read approvals apply. Test only with another synthetic file; record configured allow/ask/deny behavior. |
| F20 | File grows/shrinks while read; target replaced by symlink | Controlled resolver fixture: fail safely, close file handle, no provider dispatch. |

## 6. Git diff matrix

Use `state: { "type": "evidence", "diffs": [{ "base": "HEAD", ... }] }`. These compare the base revision with the **tracked working tree**, not just the index or unstaged changes. Only mutate the disposable repository.

| ID | Case | Expected result |
| --- | --- | --- |
| D01 | Scope to `staged.txt` | Adds `STAGED_MARKER`. |
| D02 | Scope to `working.txt` | Adds `WORKING_MARKER`. |
| D03 | Scope to `deleted.txt` | Deletion and removal of `REMOVE_ME` appear. |
| D04 | Scope to `[literal].txt` | Adds `LITERAL_MARKER`; brackets are literal, not Git pathspec magic. |
| D05 | Omit `paths` | Tracked changes under the session directory included; `UNTRACKED_MARKER` absent. |
| D06 | Scope to selected paths | Unselected changes absent. |
| D07 | Multiple diff entries | Each base/path selection represented; shared budget enforced. |
| D08 | Use the baseline commit ID instead of `HEAD` | Same comparison for equivalent revisions. |
| D09 | Scope to unchanged `forbidden.txt` | Shell permission denial produces `EVIDENCE_ERROR`, even for an empty patch. |
| D10 | Scope to untracked `empty.txt` | Empty patch accepted; untracked contents not included. |
| D11 | Unknown base `MISSING_TEST_REV` | `EVIDENCE_ERROR`. |
| D12 | `paths: ["../escape"]` | `EVIDENCE_ERROR`; paths cannot escape the session directory. |
| D13 | Quoted fixture filename `quote' $(touch INJECTION_SHOULD_NOT_EXIST).txt` | `QUOTED_MARKER` received; no file named `INJECTION_SHOULD_NOT_EXIST` created. |
| D14 | Change `binary.dat` from bytes `[0,1,2]` to `[0,3,4]`, then diff it | `EVIDENCE_ERROR` for a binary patch. Restore its fixture bytes before other default-scope tests. |
| D15 | Generated patch exceeds remaining request budget | Controlled fixture: failure, never a truncated successful patch. |
| D16 | Session moved/nested directory; provider base/config stays unchanged | File/diff resolution uses the invoking session location, not plugin setup location. Confirm default diff scope does not include sibling directories. |
| D17 | External diff, textconv, pager, or fsmonitor configured in fixture | Controlled fixture: no helper commands run. |

Diffs follow native **shell** permissions, not per-file `read` rules on Git output. Do not interpret D09 as proof that broad `git diff` access protects read-denied files or historical secrets. Native display previews are discarded; the resolver performs a second bounded read/Git run after the native operation.

## 7. Regression cases

Run this through **Code Mode**, not just the service function:

```json
{
  "state": {
    "type": "evidence",
    "text": [{ "message": "Production is down for all customers." }]
  },
  "questions": {
    "impact": {
      "type": "score",
      "instructions": "Rate production impact.",
      "criteria": [
        { "level": "No impact" },
        ["Some customers affected"],
        { "level": "All customers affected" }
      ]
    },
    "kind": {
      "type": "choice",
      "instructions": "Select __proto__ for an outage, constructor otherwise.",
      "criteria": [
        {
          "label": "__proto__",
          "description": { "meaning": "Production outage" }
        },
        { "label": "constructor", "description": null }
      ]
    }
  }
}
```

| ID | Case | Expected result |
| --- | --- | --- |
| R01 | Structured score criteria above | `ok: true`; legend values remain objects/arrays, not stringified descriptions. |
| R02 | Entry-list choice criteria containing `__proto__` | `ok: true`; allowed choice and probability keys preserved. |
| R03 | Ordinary map using `constructor` and `other` | Still works; no compatibility regression. |
| R04 | Named `change-test` using entry-list criteria | Same safe normalization as ad hoc requests. |
| R05 | Original object map with `__proto__` through Code Mode | Known upstream limitation: may still produce `INVALID_INPUT`. Record as KNOWN LIMITATION, not a fixed path. Use the list form. |
| R06 | Same special-label object map passed directly to the classifier service | Works; isolates the Code Mode transport limitation. |
| R07 | Entry list contains duplicate labels, missing description, empty description, or extra fields | `INVALID_INPUT`; do not silently merge, default, or discard entries. |

## 8. Limits and malformed inputs

For accepted upper bounds, use repeated **empty** file references/patches so fixture size does not accidentally exceed the request budget. In Code Mode, generate arrays/maps programmatically rather than pasting hundreds of entries.

| ID | Boundary / malformed case | Expected result |
| --- | --- | --- |
| L01 | 1 and 64 independent questions; 65 questions | First two accepted; 65 rejected. |
| L02 | 64 files; 65 files | 64 accepted within byte budget; 65 rejected. |
| L03 | 16 diffs; 17 diffs | 16 accepted within byte budget; 17 rejected. |
| L04 | 64 paths in one diff; 65 paths | 64 accepted; 65 rejected. |
| L05 | 2 and 255 choice labels, maps and entry lists; 1 and 256 labels | Valid boundaries accepted; invalid counts rejected. Every requested probability key retained. |
| L06 | Nonblank choice label length 128; 129 | 128 accepted; 129 rejected. |
| L07 | 2 and 10 score levels; 1 and 11 levels | Valid boundaries accepted; invalid counts rejected. |
| L08 | Question ID length 64; 65, leading digit, or invalid characters | 64-character valid ID accepted; invalid IDs rejected. IDs follow `^[A-Za-z][A-Za-z0-9_-]{0,63}$`. |
| L09 | Public/text-only serialized JSON at exactly 1 MiB; one byte over | Unit boundary check; exact limit accepted, over rejected. Provider payload includes model/questions/escaping, not just file bytes. OpenAI image bodies use a separate 13 MiB bound. |
| L10 | JSON traversal depth 32; 33 | Unit boundary check; 32 accepted, 33 rejected. |
| I01 | Missing `questions`/`classifier`, or both supplied | `INVALID_INPUT`. |
| I02 | Unknown classifier | `INVALID_INPUT` at `/classifier`, or host enum rejection; no evidence reads/provider dispatch. |
| I03 | Empty question map, blank instructions, unsupported type such as `boolean` | `INVALID_INPUT`. |
| I04 | Unknown top-level/question/evidence/diff/entry fields; attempted provider/model/header override | `INVALID_INPUT`. |
| I05 | Blank state, empty object/array, top-level null/boolean/number | `INVALID_INPUT`. Nested JSON primitives remain allowed. |
| I06 | Evidence marker with no text/files/code/diffs/images; empty reference list | `INVALID_INPUT`. |
| I07 | Malformed file object, blank/NUL path, blank/NUL/base beginning with `-` | `INVALID_INPUT`. Valid file objects accept `path`, `offset`, and `limit`. Image objects accept only `path`. |
| I08 | Yes/no criteria with keys other than `true`/`false`; empty criteria object | `INVALID_INPUT`. |
| I09 | Blank/oversized choice label; empty score description | `INVALID_INPUT`. |
| I10 | Cycles, getters/accessors, sparse arrays, symbols, functions, undefined, nonfinite numbers | Unit/service checks: reject before cloning/serialization; getters never executed. These are not all expressible as normal JSON tool arguments. |

## 9. Configuration, credentials, and registration

Use disposable configuration/key fixtures. Negative configuration cases fail **setup** with sanitized `INVALID_CONFIG`, rather than returning a tool envelope.

| ID | Case | Expected result / execution mode |
| --- | --- | --- |
| C01 | Load/reload server and TUI entries | The `classify` namespace contains `decide`, `search`, and `grammar`; TUI entry performs no classification/credential work. |
| C02 | Setup valid backend without invoking tool | No network calls, model downloads, credential-file reads, or inference. |
| C03 | Named classifiers present/absent | Schema/description enumerate configured names; ad hoc-only schema when absent. |
| C04 | Options changed after setup | Existing snapshot unchanged until reload; normalized named questions deeply frozen. |
| C05 | No backend; unknown backend/fields; literal credential options | Setup rejection, no provider inferred from available keys. |
| C06 | Timeout 1,000–300,000 ms; retries 0–2 | Boundaries accepted; nonintegers/out-of-range values rejected. Defaults: 30,000 ms and one retry. |
| C07 | Up to 32 classifiers; name and description bounds | Valid definitions accepted; 33 classifiers, invalid names, blank/>512-character descriptions, invalid question maps rejected. |
| C08 | TypeSafe defaults and endpoint | `jev-latest`, default `TYPESAFE_API_KEY`, fixed TypeSafe endpoint; no endpoint override. |
| C09 | Laya defaults and origin validation | Default model `english`, origin `http://127.0.0.1:8000`. Loopback HTTP accepted; other hosts require HTTPS. Reject API paths, userinfo, queries, fragments, malformed origins and the former `kev` provider name. |
| C10 | Environment credential present/missing/blank | Selected variable used at invocation; missing/blank yields `MISSING_CREDENTIALS` without HTTP. No secret output. |
| C11 | Key file at absolute or `~/` path; whitespace/final newline; symlink to regular file | Valid key used; surrounding whitespace trimmed. Relative/`~otheruser` paths rejected at setup. |
| C12 | Both `apiKeyEnv` and `apiKeyFile` | Setup rejection; file source never falls back to environment. |
| C13 | Missing/unreadable/nonregular/empty/>16 KiB key file; invalid UTF-8/internal whitespace/control characters | Sanitized `MISSING_CREDENTIALS`, no HTTP/fallback. Use automated fixtures for permissions/platform-specific cases. |
| C14 | Rotate synthetic key file/environment value between invocations | New value used without reload. Record only that authentication changed, never the key. |
| C15 | `openai-decisions` backend | Default `gpt-6-luna`, server-side `OPENAI_API_KEY`, selectable profile, native predicate/choice/score translation; no chat fallback or alternate backend. |
| C16 | Configured adapter lacks a requested question type or image capability | Recording fixture: `UNSUPPORTED_TYPE` for questions, `UNSUPPORTED_INPUT` for images, before evidence/credential/HTTP reads. |
| C17 | Required native read/shell tool unavailable | Evidence resolver fixture: fail closed with `EVIDENCE_ERROR`. |
| C18 | Read/external-directory/shell approval asks, then accept/reject | Manual disposable-session check: native decisions honored; reject yields no provider result. Do not auto-approve to make the test pass. |

## 10. Provider transport, output validation, and cancellation

Run these with `bun test`, recording adapters, injected fetch, or a disposable System One HTTP server. Live TypeSafe tests do not establish live Laya behavior. Never configure an arbitrary OpenAI-compatible chat endpoint as Laya.

| ID | Case | Expected result |
| --- | --- | --- |
| T01 | TypeSafe and Laya request construction | POST `/v1/systemone`, JSON model/questions/expanded state, selected authentication only. Unauthenticated loopback Laya sends no authorization header. |
| T02 | HTTP 401/403 | `AUTH_FAILED`, no retry. |
| T03 | HTTP 429 | `RATE_LIMITED` after permitted retries; `retryable: true`. |
| T04 | HTTP 529 | `PROVIDER_UNAVAILABLE` after permitted retries; `retryable: true`. |
| T05 | Other 5xx | `PROVIDER_UNAVAILABLE`, retryable flag true but **no automatic retry**. |
| T06 | Other unsuccessful status, e.g. 422 | `REQUEST_REJECTED`, no retry. |
| T07 | Network failure / unreachable disposable Laya | `NETWORK_ERROR`; no automatic retry. |
| T08 | Deadline exceeded during fetch/body/retry wait | `TIMEOUT` or original retryable response when another retry cannot fit; one configured deadline covers provider transport. Image resolution has its separate fixed deadline. No automatic timeout retry. |
| T09 | Retry count 0/1/2, 500/1,000 ms waits, valid `Retry-After` | Attempt counts/delays obey limits and one deadline; backend/model never change. |
| T10 | Redirect response | Not followed; unsuccessful response mapped locally. |
| T11 | Oversized, malformed, invalid UTF-8, or non-JSON successful body | `INVALID_RESPONSE`, no retry; streamed byte budget enforced independently of `Content-Length`. |
| T12 | Missing/wrong/extra answer IDs or mismatched types | Entire response rejected; no partial answers. |
| T13 | Nonfinite/out-of-range native measurements, missing confidence/distribution/usage, invalid legend keys/content | `INVALID_RESPONSE`; do not invent missing values. |
| T14 | Probability keys mismatch or absolute sum error >=0.02 | `INVALID_RESPONSE`; rounded distributions within tolerance preserved without normalization. |
| T15 | Native fractional score and structured legend; choice special labels | Values/shapes/labels preserved exactly. |
| T16 | Laya fixture explicitly reports `truncated: true` | `INPUT_TRUNCATED`. Missing marker does not prove Laya read the whole input; live Laya can silently truncate. |
| T17 | Valid/invalid request-ID header | Preserve bounded safe ID only; unsafe header ignored. |
| T18 | Extra upstream fields / raw error body / unexpected exception | Strip unrecognized answer/response fields; locally sanitized errors; no raw bodies, credentials, or arbitrary thrown messages leaked. |
| T19 | Abort before invocation, while resolving evidence/credentials, during fetch/body/retry wait, or just before adapter completion | Cancellation rejects to OpenCode, not a failure/success envelope; no late successful completion. |
| T20 | Stop only a separately managed disposable Laya instance | Subsequent call fails with sanitized `NETWORK_ERROR`; plugin never starts/stops/downloads that service itself. |
| T21 | OpenAI Decisions request and response | POST `/v1/decisions`, text input and named question array, native answer-array mapping, structured legends and `x-request-id` preserved. Refusal, duplicate names/options/indices, mismatched types/labels, or incomplete answers fail atomically. |

For interactive cancellation, use a **separate test client/session** and cancel its pending request. Do not interrupt the session coordinating this checklist. Timed-out or cancelled hosted requests may already have incurred charges.

### Automated coverage map

| Suite | Coverage |
| --- | --- |
| `tests/json.test.ts` | JSON byte/depth limits, cycles, accessors, and non-JSON values. |
| `tests/input.test.ts` | Input contracts, native question bounds, special labels, and criteria-list normalization. |
| `tests/response.test.ts` | Provider response contracts and shared answer validation: distributions, structured legends, usage, truncation, and atomic failure. |
| `tests/tool-description.test.ts` | Tool guidance, named-classifier state modes, and the mixed-type example. |
| `tests/preflight.test.ts` | Provider strategy selection, supported-question checks, cancellation, side-effect-free preflight, and direct OpenAI credential resolution. |
| `tests/evidence.test.ts` | Files, symlinks, Git evidence, byte budgets, atomic failure, interruption and unavailable-provider guards. |
| `tests/config.test.ts` | Defaults, option bounds, origins, credentials-source selection, immutable named classifiers. |
| `tests/credentials.test.ts` | Key files, rotation, source isolation, sanitization, cancellation, OpenAI invocation-time reads. |
| `tests/classification.test.ts` | Named/ad hoc dispatch, preflight-before-evidence ordering, provider-independent availability gates, result/error envelopes, OpenAI credentials, cancellation. |
| `tests/openai-decisions.test.ts` | Decisions HTTP contract, named dispatch, output parsing, native measurements, malformed/refused answers, structured content, special labels. |
| `tests/transport.test.ts` | HTTP/auth/status handling, retries/deadlines/streams, native-response validation, request IDs, interruption. |
| `tests/plugin.test.ts` | Real entry registration/execution, session-location evidence, named/ad hoc list normalization, structured legends, TUI separation. |
| `tests/image-format.test.ts` | Real static PNG/JPEG/WebP containers, malformed/unsupported/animated inputs, bounded parsing. |
| `tests/image-evidence.test.ts`, `tests/bounded-file.test.ts` | Native permissions, canonical identity, byte budgets, mutation, image deadlines, interruption, descriptor cleanup. |
| `tests/search-plugin.test.ts` | Registered search execution, prefix-only evidence, native permissions, stable backend selection, and permission-wait deadlines. |

Matrix rows describe required checks, not a claim that every row has an existing automated regression test. Document NOT RUN cases or add a controlled fixture where a check cannot be exercised safely through the public tool.

## Image evidence on a real host

This procedure implements A9 and V1–V9 in [the image-evidence spec](../../specs/classify-image-evidence-openai-decisions.md). It is opt-in and billable. Obtain explicit authorization before any live OpenAI call. Use the actual registered `classify_decide` tool in a separate session, not a direct adapter/executor call. Automated A1–A8 checks must pass first:

```sh
# From classify/
bun install
bun run typecheck
bun test tests/classification-schemas.test.ts tests/classification.test.ts
bun test tests/image-format.test.ts tests/image-evidence.test.ts tests/bounded-file.test.ts
bun test tests/openai-decisions.test.ts tests/plugin.test.ts
bun test
# From the repository root
bun run check
```

Recording tests must decode the transmitted data URLs and compare MIME and bytes with the permitted source. They must also prove zero sends on denied reads, zero evidence/credential/HTTP reads on capability rejection, atomic failure of a batch, and identical retry bodies after source changes. Do not record base64 request bodies for live validation.

### Generate image fixtures

First prepare the disposable project in section 2 and export its printed path as `SMOKE_DIR`. Run this from the same shell. Node's standard library creates genuine PNG containers without new dependencies. If ImageMagick is already installed, the script also converts the fixtures to JPEG and static WebP. It does not install packages or contact a provider. Without a converter, mark the JPEG/WebP portions of V3 NOT RUN until equivalent inspected fixtures are available.

```sh
export SMOKE_DIR="/tmp/opencode/classify-smoke-REPLACE_WITH_PRINTED_SUFFIX"
node --input-type=module <<'JS'
import { spawnSync } from "node:child_process";
import { copyFile, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const directory = await realpath(process.env.SMOKE_DIR);
if (!directory.startsWith("/tmp/opencode/classify-smoke-")) {
  throw new Error("Use only the recorded disposable project.");
}
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (kind, data) => {
  const body = Buffer.concat([Buffer.from(kind), data]);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
};
const png = (circle) => {
  const size = 256;
  const pixels = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y += 1) {
    const row = y * (1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      const inside = circle
        ? (x - 128) ** 2 + (y - 128) ** 2 <= 80 ** 2
        : x >= 48 && x < 208 && y >= 48 && y < 208;
      const color = inside ? (circle ? [0, 0, 255] : [255, 0, 0]) : [255, 255, 255];
      pixels.set(color, row + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
  ]);
};
const a = png(false);
const b = png(true);
await writeFile(join(directory, "a.png"), a);
await writeFile(join(directory, "b.png"), b);
await copyFile(join(directory, "a.png"), join(directory, "p.png"));
await copyFile(join(directory, "a.png"), join(directory, "denied.png"));
await symlink("denied.png", join(directory, "denied-alias.png"));
await writeFile(join(directory, "context.txt"), "CONTEXT_MARKER_731\n");
await writeFile(join(directory, "unsupported.gif"), Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
// A complete PNG with a valid ancillary chunk, exactly one byte above 4 MiB.
const target = 4 * 1024 * 1024 + 1;
const padding = chunk("paDd", Buffer.alloc(target - a.length - 12));
await writeFile(join(directory, "oversized.png"), Buffer.concat([
  a.subarray(0, a.length - 12), padding, a.subarray(a.length - 12),
]));

const converter = ["magick", "convert"].find((name) =>
  spawnSync(name, ["-version"], { stdio: "ignore" }).status === 0);
if (converter) {
  for (const name of ["a", "b"]) {
    for (const extension of ["jpg", "webp"]) {
      const converted = spawnSync(converter, [join(directory, `${name}.png`),
        join(directory, `${name}.${extension}`)], { stdio: "inherit" });
      if (converted.status !== 0) throw new Error("Fixture conversion failed.");
    }
  }
} else {
  console.error("JPEG/WebP conversion NOT RUN: no existing ImageMagick executable.");
}

const questions = {
  shape: { type: "choice", instructions: "What is the prominent shape in image 1?",
    criteria: { square: null, circle: null, other: null } },
  color: { type: "choice", instructions: "What is the color of that shape in image 1?",
    criteria: { red: null, blue: null, other: null } },
};
const configPath = join(directory, "opencode.jsonc");
// Section 2 writes plain JSON into its disposable .jsonc file.
const config = JSON.parse(await readFile(configPath, "utf8"));
const options = config.plugins[0].options;
options.backends.decisions = { provider: "openai-decisions" };
options.backends.local = { provider: "ollama" };
options.maxRetries = 0;
options.classifiers["image-test"] = {
  description: "Classify a synthetic local image.",
  state: { type: "evidence", images: [{ path: "p.png" }] }, questions,
};
config.permissions.push({ action: "read", resource: "*denied.png", effect: "deny" });
await writeFile(configPath, JSON.stringify(config, null, 2));
await writeFile(join(directory, "image-call.json"), JSON.stringify({
  state: { type: "evidence", images: [{ path: "a.png" }] }, questions,
}, null, 2));
console.log(directory);
JS
```

Run fixture generation once per disposable project; rerunning the symlink creation intentionally fails rather than overwriting existing files. Visually inspect `a.png`, `b.png`, and every converted JPEG/WebP before testing. Operator ground truth is a large solid red square on white in `a`, and a large solid blue circle on white in `b`. Keep that ground truth out of the agent's test prompt, filenames, state text, and question descriptions. Do not let the agent pre-read the images or infer answers from prior calls. Use neutral references and identical questions.

Use a server-side OpenAI key as described in the configuration guide. If using a private key file, change only `backends.decisions` in this disposable config. Reload the plugin and confirm one effective local copy, the `classify` namespace, preset classifier, and native `read`. Record runtime/package versions, plugin revision, and initial test-session backend selection. Select `/classify-backend decisions`; the `local` profile needs no running Ollama for the preflight rejection case.

### Verify native access and history

Before billable successes, use `denied.png` and `denied-alias.png` in separate registered-tool calls. Both must return `EVIDENCE_ERROR` with zero attempts. Confirm zero provider sends in the recording integration tests, not just from live output. Test an allowed native image read and an explicit allow/ask/deny flow on another synthetic copy. Never bypass native failures with direct filesystem reads or auto-approval.

Inspect ordinary OpenCode history for native image previews and record what this actual runtime retains. The Classify output must not contain image bytes or data URLs. Public inputs contain local paths, and native previews may persist separately. Classify does not store images; removing fixture files does not remove normal session history. If native read cannot authorize a supported image on the pinned runtime, stop and record A9 FAIL rather than bypassing it.

### Live Decisions matrix

Invoke the JSON in `image-call.json` as tool arguments, without copying image content into state. V2 replaces the questions with independent choice questions asking the shape of image 1 and image 2, using `square`, `circle`, and `other` as the allowed labels. V4 adds `text: "TEXT_MARKER_417"`, `files: ["context.txt"]`, and independent marker-presence questions alongside a visual question. Do not place expected visual labels in mixed text.

| Case | Action | Expected result |
| --- | --- | --- |
| V1 | Image-only `a.png`, then `b.png`, with identical shape/color questions. | Existing typed result contract; square/red versus circle/blue. Changed pixels must change answers. |
| V2 | `[a.png, b.png]`, then `[b.png, a.png]`; ask each image's shape. | Answers follow reference order, not filenames or earlier calls. |
| V3 | Repeat V1 with corresponding JPEG and static WebP files. | PNG/JPEG/WebP accepted; visual answers agree across encodings. Missing conversion/inspection means NOT RUN for that format. |
| V4 | Image plus explicit text and `context.txt`; ask visual and independent text-marker questions. | Both image and mixed text evidence survive resolution with valid measurements. |
| V5 | `{ "classifier": "image-test" }`, replace `p.png` with `b.png`, invoke again. | Second call reflects fresh pixels; no image cache. |
| V6 | Native read denial for `denied.png` and its alias. | `EVIDENCE_ERROR`, zero attempts; recording tests prove zero sends and no bypass. |
| V7 | Select `/classify-backend local`, repeat a valid image call, then restore `decisions`. | `UNSUPPORTED_INPUT`, zero attempts; recording tests prove no evidence/credential/HTTP reads. |
| V8 | Separate calls with `unsupported.gif`, `{ "path": "https://example.invalid/a.png" }`, and `oversized.png`; also combine a valid first image with an invalid second. | GIF/overflow yield `EVIDENCE_ERROR`; URL yields `INVALID_INPUT` or a recorded host schema rejection. No inference or partial result. |
| V9 | Run the existing mixed answer-type text-only baseline on Decisions after image cases. | Old request/result semantics still work. |

For V5, replace only the disposable fixture between completed calls:

```sh
node --input-type=module <<'JS'
import { copyFile, realpath } from "node:fs/promises";
import { join } from "node:path";
const directory = await realpath(process.env.SMOKE_DIR);
if (!directory.startsWith("/tmp/opencode/classify-smoke-")) throw new Error("Wrong fixture directory.");
await copyFile(join(directory, "b.png"), join(directory, "p.png"));
JS
```

V1–V5 are visual sanity checks, not an accuracy benchmark. Unexpected answers fail the case and require investigation. Do not rerun until a preferred answer appears or revise assertions to fit the observed output. Require the predeclared labels and existing distribution/range contract, not exact probabilities.

Record V1–V9 as PASS, FAIL, or NOT RUN with timestamp, commands/tool arguments, runtime/model versions, sanitized result fields, relevant A1–A9 IDs, history observations, and cleanup. Mark unavailable credentials, billable authorization, converters, clients, or native tools explicitly. A1–A8 plus typecheck/full suite/root checks establish local verification only. End-to-end verification requires A9 and V1–V9 on the real host. Restore the original test-session backend selection before cleanup.

## 11. Report and cleanup

Record:

```text
Date / tester:
OpenCode version / interface (Code Mode, TUI, web):
Plugin revision / effective configuration (redacted):
Backend / requested and reported model:
Laya version / checkpoint revision / actual device / precision (if tested):
Automated checks: command, status, test count, unrelated failures:
Case IDs: PASS / FAIL / NOT RUN / KNOWN LIMITATION:
Failed case: synthetic arguments, expected result, sanitized actual result:
Request ID(s) for provider investigation:
Fixture/session cleanup and original directory restored:
Image cases V1–V9 / acceptance IDs A1–A9 (if tested):
Native image permission and preview/history observations:
```

Keep fixtures until failures have been diagnosed. Then restore the original session directory, close the disposable client, stop only servers started for the test, and delete **only the exact recorded disposable directory**. Check that the quoted-path fixture did not create `INJECTION_SHOULD_NOT_EXIST`. Do not delete broad `/tmp/opencode` paths, reset the user's Git tree, or retain secrets in the test report.

### Known verification baseline

On 2026-09-30, live TypeSafe Code Mode checks against `jev-1.13.0` exercised the primary text/file/diff/named/limit/rejection paths. The subsequent structured legend and safe-label-list fixes passed a combined live regression call, plus 52 automated tests and typecheck. The upstream `__proto__` **object-map** transport limitation remains; the entry-list form is the supported workaround. A subsequent local Laya adapter/service call verified `noul`, `choice`, and `score` on a short synthetic incident report. No separate Laya TUI/web smoke verification was claimed. Repeat this plan after changes rather than treating that historical run as verification of a new build.

Those TypeSafe and Laya checks preceded the Effect migration. The migrated runtime has automated layer and loopback HTTP coverage; its real-host and hosted-provider smoke checks still need to be rerun. Record OpenCode versions and verify cancellation, native evidence permissions, named-state modes, and fresh evidence resolution in the actual client under test.

Live Ollama 0.35.0 validation with `nimble:latest` (Q8_0, digest `9b953de7a5336756ece1cb1e8632e374b3dbdabe3d02d405cf8291da2d43a131`) exercised the classification service, provider layer, HTTP transport, and public output parser on synthetic data. A mixed string-input request returned all three native answer types, usage, and derived score bounds in about 4.7 seconds. A preset named classifier with structured state and choice-entry-list criteria succeeded in about 0.4 seconds. Structured score descriptions were rejected with HTTP 400 and surfaced as `REQUEST_REJECTED`.

The Ollama checks did not exercise an OpenCode client or evidence permissions. One outage example selected `other` despite high severity; connectivity is not an accuracy guarantee. For new local-provider runs, record the Ollama version and model tag, or inspect Laya `/health` for loaded checkpoints, revisions, and actual devices. Start and stop only separately managed test servers, then verify stopped-server `NETWORK_ERROR` without a substitute-provider call.

### OpenAI Decisions public-beta verification

On 2026-10-06, two live calls through `createClassifyTool().execute` and the public output parser succeeded against `https://api.openai.com/v1/decisions`, requested and reported model `gpt-6-luna`. Both used synthetic incident data and a server-local key file, with no retries or fallback. OpenAI documents this as public beta, with only `gpt-6-luna` supported, not GA.

- Mixed text input returned native predicate, choice, and score measurements, complete distributions, usage, and a request ID in about 1.54 seconds. Reported usage was 424 input tokens and zero output tokens.
- A named preset with structured state returned all three types in about 0.22 seconds. Reported usage was 428 input tokens and zero output tokens. Structured instructions/descriptions, `__proto__` and `constructor` choice labels, and structured score legends survived translation and output parsing.
- Native fractional scores, malformed/refused responses, and real plugin-entry dispatch use controlled automated fixtures. The live examples returned an integer score; fractional preservation was not demonstrated by those live calls.

These calls exercised the tool executor, service, credentials, adapter, HTTP transport, and output parser directly in Bun. Interactive OpenCode clients, Code Mode transport, native file/diff permissions, and live cancellation were NOT RUN for this provider. Request IDs were `req_c3e72ef6161f47928aed1ee099b0067d` and `req_12175e242a104b6f9899fabc353258cf`. The temporary runner contained no key contents and was removed after verification. No user configuration or inference servers changed.

### Registered-host image verification, 2026-10-07

The tester ran V1–V9 through the actual OpenCode 2.0.22 executable, Code Mode `execute`, and registered `tools.classify.decide`, not a direct executor or adapter. The tested working tree was based on `bdf413bb1e72416051a750c24201b60284fbc88b`, with the uncommitted image implementation. Bun was 1.4.2; the plugin's installed `@opencode/schema` was 2.0.21. Calls ran approximately 22:46–22:48 UTC.

The separate Git project was `/tmp/opencode/classify-image-host-ySKzDD`, with isolated XDG config/data/cache/state and session `ses_ee774795dffe11FJUrORWKTc48`. Effective-plugin inspection found one active local Classify entry, from this checkout, plus host built-ins. A loopback deterministic chat fixture drove host tool calls without inference, image inspection, or visual answers. It first discovered the Code Mode catalog, then emitted `return await tools.classify.decide(arguments)` with the matrix's declared arguments. Each invocation used `opencode run --standalone --format json --session <test-session>` from the disposable directory. The host created the real calling context and executed native `read`; neither the plugin nor native tools were replaced by mocks.

Only the disposable Classify profile referenced the authorized server-local key-file path. OpenAI key contents were never printed, copied into fixtures, or added to the repository. Requested and reported Decisions model was `gpt-6-luna`, with `maxRetries: 0`, no fallback, and twelve successful billable requests. Total reported usage was 4,403 input tokens and zero output tokens. Every success had one attempt, complete typed answers, valid probability/confidence ranges and distributions, nonnegative duration, usage, and a request ID. Durations were approximately 172–1,322 ms. No live request bodies or image bytes were recorded for provider verification.

The fixture script produced genuine 256×256 PNGs. Existing ImageMagick 7.1.2-31 from the Nix store converted both images to JPEG and static WebP. The tester visually checked all six files before calls. Filenames and tool inputs contained no ground-truth labels beyond the predeclared answer choices. Questions stayed identical when pixels or encoding changed.

| Case | Status | Sanitized observed result |
| --- | --- | --- |
| V1 | PASS | `a.png` yielded square/red; `b.png` yielded circle/blue with identical shape/color questions. |
| V2 | PASS | `[a.png, b.png]` yielded square/circle; reversed references yielded circle/square. |
| V3 | PASS | Both JPEGs and both static WebPs agreed with their PNG shape/color results. |
| V4 | PASS | Image yielded square/red; independent explicit-text and file-marker predicates both returned `noul: 1`. |
| V5 | PASS | Preset `image-test` yielded square/red, then circle/blue after replacing only `p.png` with `b.png`; both results retained the classifier name. |
| V6 | PASS | `denied.png` and `denied-alias.png` each yielded sanitized `EVIDENCE_ERROR`, zero attempts, and no result. Registered-plugin recording tests independently proved zero sends on denial. |
| V7 | PASS | Disposable default changed to `local` and reloaded for one call; valid image evidence yielded `UNSUPPORTED_INPUT`, backend `local`, zero attempts. Restored `decisions` before later calls. Recording tests proved rejection before evidence, credential, and HTTP access. |
| V8 | PASS | GIF and a complete 4 MiB + 1 byte PNG yielded `EVIDENCE_ERROR`, zero attempts. Valid first image plus GIF also failed atomically. URL-shaped path received a host schema rejection for `classify_decide`, before plugin execution. |
| V9 | PASS | Text-only mixed baseline returned outage/refund `noul: 1`, choice `incident`, and score `2` on 0–2, with intact legend and distributions. |

Provider request IDs, in case order:

| Calls | Request IDs |
| --- | --- |
| V1 a, b | `req_c541c3c5b4ab417abda000962400157d`, `req_4805dc5a63d446b8983b6499d4615532` |
| V2 forward, reversed | `req_2261b9e8b96842838435f54c3a07bc28`, `req_5750182168574b3bb65c5ff81cf437cf` |
| V3 a.jpg, b.jpg | `req_ae182a93dadf4f7c8af7b3f401f68303`, `req_4c49f8ff0abf4110bc75580e2911cf77` |
| V3 a.webp, b.webp | `req_9d4225f880704aa59cd8b6a40440a4fa`, `req_e2bba04fe1e147a28ec0a059f7f55c4b` |
| V4 | `req_d8f707c918b84946abee68b701886763` |
| V5 original, fresh | `req_5272c6fc76bc40d1b611999fe2d720ba`, `req_bee65d337e944cdbb8b17790c5658999` |
| V9 | `req_dde4f91c6bc242389f6197e6c64762d9` |

Native access and history observations:

- Explicit disposable native permission rules allowed reads and denied the canonical `*denied.png` target. The alias could not bypass denial. No `--auto` permission flag was used.
- After Classify cases, session context contained the Code Mode inputs and sanitized results, but no image data URL or separate nested native-read message. This is an observation of this runtime, not a general history-retention guarantee.
- A supplementary direct native image `read` completed. Its persisted individual assistant message contained a `file` attachment with MIME `image/png` and an image data URL. Ordinary host history can retain previews independently of Classify output. The deterministic driver's text-only completion detector repeated this supplementary read until the runner timed out; it made no additional Decisions calls. Inspection used only attachment metadata and presence checks, without printing bytes.
- Interactive ask/accept/reject, TUI/web/desktop, live cancellation, and slash-command backend selection were NOT RUN. Profile changes used only disposable configuration reloads. These are additional client checks, not a claim made by V1–V9.

Independent automated verification passed before live calls: `bun run typecheck` and `bun test` in `classify/`, 225 passing tests across 29 files, zero failures, 2,192 assertions. The suite includes A1–A8's schema, capability, resolver, encoding/budget, retry, and registered-plugin fixtures. `bun run check` from the root also passed. Dependencies were already installed; the tester did not rerun `bun install` or alter manifests/lockfiles. A9 and V1–V9 passed for this real host. These neutral synthetic images are a visual sanity check, not an accuracy benchmark.

Cleanup completed. The test session was deleted through its private host API, both tester-owned loopback processes stopped, and only the exact recorded disposable directory was removed, including isolated session history, preview data, runners, and fixtures. The disposable backend default had already returned to `decisions`; no user configuration, existing session/backend selection, shared service, or inference server changed. The tester's only repository edit was this sanitized verification report. The parent session owns commits and PR work.
