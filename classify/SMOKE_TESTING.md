# Classify smoke-testing plan

Use this plan after changing or reloading the plugin. It covers the public tool,
evidence resolution, configuration, credentials, and provider transport.

**A passing smoke test verifies connectivity and contracts, not model accuracy.**
Record each case as PASS, FAIL, or NOT RUN. Do not count an expected rejection as
a failure, or describe an untested backend as verified.

## 1. Safety and prerequisites

- Use a disposable Git repository and synthetic data. Never stage, commit,
  delete, or rewrite files in the user's real working tree to prepare tests.
- Successful hosted calls incur charges and send evidence to the configured
  backend. Group independent questions into one request where practical.
- Credentials must be available to the OpenCode **server**, not just the TUI.
  Use an environment-variable name or private key-file path; do not copy keys
  into fixtures, prompts, logs, or reports.
- Install the plugin's dependencies and run its automated tests first. From
  `classify/`, run `bun install`, `bun run typecheck`, and `bun test`. From the
  repository root, run `bun run check classify` and `bun run check`.
- Verify the effective plugin list: global/ancestor configuration can still
  contribute plugins and permissions to the disposable project.
- Prefer a separate interactive OpenCode client for the fixture. If moving an
  existing session, record its original directory and restore it before cleanup.
- Do not force authentication errors, rate limits, outages, or cancellation
  against production merely to exercise an error path. Use controlled fixtures.

## 2. Prepare a disposable project

Run the following from this repository's root. Node is only used to generate
synthetic fixture files; it never reads credentials or calls the provider.

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
      backend: { provider: "typesafe" },
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

Save the printed path as `SMOKE_DIR` and open OpenCode in that directory. If using
a key file or Kev instead of the default TypeSafe environment source, change
**only the disposable project's** backend using a configuration from
[README.md](./README.md). Reload after changing options: they are an immutable
setup snapshot. Do not overwrite an existing user's configuration.

On platforms without symlink support, mark symlink cases NOT RUN. Git must be
installed for diff cases. Paths below are relative to the fixture session unless
an absolute path is explicitly requested.

## 3. Calling the tool and judging results

These examples are **tool arguments**, not provider HTTP bodies. Ask the agent
to invoke `classify` exactly as specified, or call `tools.classify` in Code Mode.
Do not have the agent read and copy file contents into `state` for evidence cases.

Check the `ok` discriminator before reading answers. In Code Mode, parse the
returned JSON string before making assertions.

For successes, require:

- Exactly the requested answer IDs and types, with no partial/missing answers.
- `noul`: a finite probability in `[0, 1]`, not a boolean.
- `choice`: an allowed label, every requested probability key, native confidence
  in `[0, 1]`, and probability sum with absolute error **less than `0.02`**.
- `score`: a finite value in `[0, levels.length - 1]`, every legend/distribution
  index, and native confidence in `[0, 1]`. Structured legends stay structured.
- Provider-reported model, nonnegative integer input/output token usage, and
  nonnegative duration. A valid provider request-ID header is preserved when
  present; its absence is not a failure.
- Named requests additionally contain the configured `result.classifier`.
- No rounding, renormalization, invented confidence, or automatic action execution.

Use clear synthetic facts to check that the backend received the evidence. High
yes probabilities for present markers and low probabilities for absent markers
are useful diagnostics, **not guaranteed numeric outputs**. Do not require an
exact probability, confidence, or score. Fractional scores must remain fractional
if returned; an integer result alone does not establish a bug.

For expected failures, require `ok: false`, a sanitized error, no `result`, and no
partial answers. Input/evidence failures must not dispatch a provider request;
verify this with a recording adapter or controlled HTTP fixture when necessary.
Malformed calls may instead be rejected by the host's schema validator before
the plugin runs. Record that separately as a host rejection.

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
      "criteria": { "incident": "Active failure", "maintenance": "Planned maintenance", "other": null }
    },
    "impact": {
      "type": "score",
      "instructions": "Rate customer impact.",
      "criteria": ["No impact", "Some customers affected", "All customers affected"]
    },
    "refund": {
      "type": "noul",
      "instructions": { "question": "Does the customer explicitly request a refund?" }
    }
  }
}
```

## 4. Live success matrix

Unless specified otherwise, use a `noul` question asking whether the relevant
marker/fact occurs in the supplied evidence. Multiple rows can share a call.

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
| F11 | `binary.dat` | `EVIDENCE_ERROR`; no binary evidence sent. |
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

Use `state: { "type": "evidence", "diffs": [{ "base": "HEAD", ... }] }`.
These compare the base revision with the **tracked working tree**, not just the
index or unstaged changes. Only mutate the disposable repository.

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

Diffs follow native **shell** permissions, not per-file `read` rules on Git
output. Do not interpret D09 as proof that broad `git diff` access protects
read-denied files or historical secrets. Native display previews are discarded;
the resolver performs a second bounded read/Git run after the native operation.

## 7. Regression cases

Run this through **Code Mode**, not just the service function:

```json
{
  "state": { "type": "evidence", "text": [{ "message": "Production is down for all customers." }] },
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
        { "label": "__proto__", "description": { "meaning": "Production outage" } },
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

For accepted upper bounds, use repeated **empty** file references/patches so
fixture size does not accidentally exceed the request budget. In Code Mode,
generate arrays/maps programmatically rather than pasting hundreds of entries.

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
| L09 | Serialized JSON at exactly 1 MiB; one byte over | Unit boundary check; exact limit accepted, over rejected. Provider payload includes model/questions/escaping, not just file bytes. |
| L10 | JSON traversal depth 32; 33 | Unit boundary check; 32 accepted, 33 rejected. |
| I01 | Missing `questions`/`classifier`, or both supplied | `INVALID_INPUT`. |
| I02 | Unknown classifier | `UNKNOWN_CLASSIFIER`, or host enum rejection; no evidence reads/provider dispatch. |
| I03 | Empty question map, blank instructions, unsupported type such as `boolean` | `INVALID_INPUT`. |
| I04 | Unknown top-level/question/evidence/diff/entry fields; attempted provider/model/header override | `INVALID_INPUT`. |
| I05 | Blank state, empty object/array, top-level null/boolean/number | `INVALID_INPUT`. Nested JSON primitives remain allowed. |
| I06 | Evidence marker with no text/files/diffs; empty file/diff/path list | `INVALID_INPUT`. |
| I07 | File object instead of path, blank/NUL path, blank/NUL/base beginning with `-` | `INVALID_INPUT`. |
| I08 | Yes/no criteria with keys other than `true`/`false`; empty criteria object | `INVALID_INPUT`. |
| I09 | Blank/oversized choice label; empty score description | `INVALID_INPUT`. |
| I10 | Cycles, getters/accessors, sparse arrays, symbols, functions, undefined, nonfinite numbers | Unit/service checks: reject before cloning/serialization; getters never executed. These are not all expressible as normal JSON tool arguments. |

## 9. Configuration, credentials, and registration

Use disposable configuration/key fixtures. Negative configuration cases fail
**setup** with sanitized `INVALID_CONFIG`, rather than returning a tool envelope.

| ID | Case | Expected result / execution mode |
| --- | --- | --- |
| C01 | Load/reload server and TUI entries | One unnamespaced `classify` tool; TUI entry performs no classification/credential work. |
| C02 | Setup valid backend without invoking tool | No network calls, model downloads, credential-file reads, or inference. |
| C03 | Named classifiers present/absent | Schema/description enumerate configured names; ad hoc-only schema when absent. |
| C04 | Options changed after setup | Existing snapshot unchanged until reload; normalized named questions deeply frozen. |
| C05 | No backend; unknown backend/fields; literal credential options | Setup rejection, no provider inferred from available keys. |
| C06 | Timeout 1,000–300,000 ms; retries 0–2 | Boundaries accepted; nonintegers/out-of-range values rejected. Defaults: 30,000 ms and one retry. |
| C07 | Up to 32 classifiers; name and description bounds | Valid definitions accepted; 33 classifiers, invalid names, blank/>512-character descriptions, invalid question maps rejected. |
| C08 | TypeSafe defaults and endpoint | `jev-latest`, default `TYPESAFE_API_KEY`, fixed TypeSafe endpoint; no endpoint override. |
| C09 | Kev defaults and origin validation | Loopback HTTP accepted; other hosts require HTTPS. Reject API paths, userinfo, queries, fragments, malformed origins. |
| C10 | Environment credential present/missing/blank | Selected variable used at invocation; missing/blank yields `MISSING_CREDENTIALS` without HTTP. No secret output. |
| C11 | Key file at absolute or `~/` path; whitespace/final newline; symlink to regular file | Valid key used; surrounding whitespace trimmed. Relative/`~otheruser` paths rejected at setup. |
| C12 | Both `apiKeyEnv` and `apiKeyFile` | Setup rejection; file source never falls back to environment. |
| C13 | Missing/unreadable/nonregular/empty/>16 KiB key file; invalid UTF-8/internal whitespace/control characters | Sanitized `MISSING_CREDENTIALS`, no HTTP/fallback. Use automated fixtures for permissions/platform-specific cases. |
| C14 | Rotate synthetic key file/environment value between invocations | New value used without reload. Record only that authentication changed, never the key. |
| C15 | Reserved `openai-decisions` backend | `PROVIDER_UNAVAILABLE`; no credentials, evidence, HTTP, chat fallback, or alternate backend used. |
| C16 | Configured adapter lacks a requested capability | Service fixture: `UNSUPPORTED_TYPE` before dispatch; unavailable OpenAI gate takes precedence. |
| C17 | Required native read/shell tool unavailable | Evidence resolver fixture: fail closed with `EVIDENCE_ERROR`. |
| C18 | Read/external-directory/shell approval asks, then accept/reject | Manual disposable-session check: native decisions honored; reject yields no provider result. Do not auto-approve to make the test pass. |

## 10. Provider transport, output validation, and cancellation

Run these with `bun test`, recording adapters, injected fetch, or a disposable
System One HTTP server. Live TypeSafe tests do not establish live Kev behavior.
Never configure an arbitrary OpenAI-compatible chat endpoint as Kev.

| ID | Case | Expected result |
| --- | --- | --- |
| T01 | TypeSafe and Kev request construction | POST `/v1/systemone`, JSON model/questions/expanded state, selected authentication only. Unauthenticated loopback Kev sends no authorization header. |
| T02 | HTTP 401/403 | `AUTH_FAILED`, no retry. |
| T03 | HTTP 429 | `RATE_LIMITED` after permitted retries; `retryable: true`. |
| T04 | HTTP 529 | `PROVIDER_UNAVAILABLE` after permitted retries; `retryable: true`. |
| T05 | Other 5xx | `PROVIDER_UNAVAILABLE`, retryable flag true but **no automatic retry**. |
| T06 | Other unsuccessful status, e.g. 422 | `REQUEST_REJECTED`, no retry. |
| T07 | Network failure / unreachable disposable Kev | `NETWORK_ERROR`; no automatic retry. |
| T08 | Deadline exceeded during fetch/body/retry wait | `TIMEOUT` or original retryable response when another retry cannot fit; one deadline covers the invocation. No automatic timeout retry. |
| T09 | Retry count 0/1/2, 500/1,000 ms waits, valid `Retry-After` | Attempt counts/delays obey limits and one deadline; backend/model never change. |
| T10 | Redirect response | Not followed; unsuccessful response mapped locally. |
| T11 | Oversized, malformed, invalid UTF-8, or non-JSON successful body | `INVALID_RESPONSE`, no retry; streamed byte budget enforced independently of `Content-Length`. |
| T12 | Missing/wrong/extra answer IDs or mismatched types | Entire response rejected; no partial answers. |
| T13 | Nonfinite/out-of-range native measurements, missing confidence/distribution/usage, invalid legend keys/content | `INVALID_RESPONSE`; do not invent missing values. |
| T14 | Probability keys mismatch or absolute sum error >=0.02 | `INVALID_RESPONSE`; rounded distributions within tolerance preserved without normalization. |
| T15 | Native fractional score and structured legend; choice special labels | Values/shapes/labels preserved exactly. |
| T16 | Kev explicitly reports `truncated: true` | `INPUT_TRUNCATED`. Missing marker does not prove an arbitrary server never truncates. |
| T17 | Valid/invalid request-ID header | Preserve bounded safe ID only; unsafe header ignored. |
| T18 | Extra upstream fields / raw error body / unexpected exception | Strip unrecognized answer/response fields; locally sanitized errors; no raw bodies, credentials, or arbitrary thrown messages leaked. |
| T19 | Abort before invocation, while resolving evidence/credentials, during fetch/body/retry wait, or just before adapter completion | Cancellation rejects to OpenCode, not a failure/success envelope; no late successful completion. |
| T20 | Stop only a separately managed disposable Kev instance | Subsequent call fails with sanitized `NETWORK_ERROR`; plugin never starts/stops/downloads that service itself. |

For interactive cancellation, use a **separate test client/session** and cancel
its pending request. Do not interrupt the session coordinating this checklist.
Timed-out or cancelled hosted requests may already have incurred charges.

### Automated coverage map

| Suite | Coverage |
| --- | --- |
| `tests/schema.test.ts` | Input/output contracts, JSON limits, labels, distributions, structured legends, criteria-list normalization. |
| `tests/evidence.test.ts` | Files, symlinks, Git evidence, byte budgets, atomic failure, interruption and unavailable-provider guards. |
| `tests/config.test.ts` | Defaults, option bounds, origins, credentials-source selection, immutable named classifiers. |
| `tests/credentials.test.ts` | Key files, rotation, source isolation, sanitization, cancellation, OpenAI no-read guard. |
| `tests/service.test.ts` | Named/ad hoc dispatch, capability checks, result/error envelopes, OpenAI gate, cancellation. |
| `tests/transport.test.ts` | HTTP/auth/status handling, retries/deadlines/streams, native-response validation, request IDs, interruption. |
| `tests/plugin.test.ts` | Real entry registration/execution, session-location evidence, named/ad hoc list normalization, structured legends, TUI separation. |

Matrix rows describe required checks, not a claim that every row has an existing
automated regression test. Document NOT RUN cases or add a controlled fixture
where a check cannot be exercised safely through the public tool.

## 11. Report and cleanup

Record:

```text
Date / tester:
OpenCode version / interface (Code Mode, TUI, web):
Plugin revision / effective configuration (redacted):
Backend / requested and reported model:
Kev revision / checkpoint / backend / precision (if tested):
Automated checks: command, status, test count, unrelated failures:
Case IDs: PASS / FAIL / NOT RUN / KNOWN LIMITATION:
Failed case: synthetic arguments, expected result, sanitized actual result:
Request ID(s) for provider investigation:
Fixture/session cleanup and original directory restored:
```

Keep fixtures until failures have been diagnosed. Then restore the original
session directory, close the disposable client, stop only servers started for
the test, and delete **only the exact recorded disposable directory**. Check
that the quoted-path fixture did not create `INJECTION_SHOULD_NOT_EXIST`. Do not
delete broad `/tmp/opencode` paths, reset the user's Git tree, or retain secrets
in the test report.

### Known verification baseline

On 2026-09-30, live TypeSafe Code Mode checks against `jev-1.13.0` exercised the
primary text/file/diff/named/limit/rejection paths. The subsequent structured
legend and safe-label-list fixes passed a combined live regression call, plus
52 automated tests and typecheck. The upstream `__proto__` **object-map** transport
limitation remains; the entry-list form is the supported workaround. No live Kev
or separate TUI/web smoke verification was claimed. Repeat this plan after
changes rather than treating that historical run as verification of a new build.
