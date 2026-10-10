# Classify smoke testing

[Back to README](../README.md) · [Configuration](./CONFIGURATION.md) · [Development](./DEVELOPMENT.md)

Live checks verify host integration and provider contracts, not model accuracy. Run [automated verification](./DEVELOPMENT.md#verification) first. Use controlled fixtures for malformed input, transport failures, retries, byte limits, and cancellation races.

## Safety and setup

1. Create a disposable Git project under `/tmp/opencode/` with synthetic text, staged and unstaged changes, an untracked file, and a symlink. Record its exact directory.
2. Load one local Classify copy and check the effective plugin list. Global and ancestor configuration can add other sources. Confirm that only `decide` registers in the `classify` namespace. Search and grammar discovery remain disabled.
3. Configure the disposable project's backend using [provider profiles](./CONFIGURATION.md#providers). Reference credentials through a server environment-variable name or private key file. Keep secrets out of fixtures and reports.
4. Use a separate OpenCode client and session. Record the runtime, plugin revision, client, provider, and model. Obtain explicit authorization for billable hosted calls, which send evidence to the provider.
5. Configure native read and shell permissions for allow, ask, and deny cases on synthetic files. Honor the user's permission responses. Use controlled local endpoints for routing and failure checks.

Invoke the registered `classify_decide` tool, not a direct service or adapter. In Code Mode, discover the namespace and use the returned signature. Pass evidence references without first copying their contents into state.

## Core live checklist

Use the [README request](../README.md#2-ask-the-agent-to-classify-content) and [evidence examples](./EVIDENCE.md). Mark each applicable case PASS, FAIL, or NOT RUN.

| Boundary | Check |
| --- | --- |
| Typed results | Call with `noul`, `choice`, and `score` questions together. Check `ok` on the structured result before reading answers. Require the requested IDs and types, valid ranges and distributions, usage, and duration. Preserve fractional scores and structured legends if returned. Do not require an exact probability or use `JSON.parse`. |
| Literal JSON | Objects containing `files` without `type: "evidence"` stay literal. Nested evidence markers must not resolve references. |
| Named classifiers | Test caller-supplied and preset state. The result must identify the classifier. The wrong state mode must fail without a provider request. |
| Text and code | Relative files, partial ranges, symlinks, and Tree-sitter captures resolve from the invoking session, not plugin setup. Mutating a fixture between calls changes the evidence. |
| Git diffs | A scoped `HEAD` diff includes staged and unstaged tracked changes and deletions. It excludes untracked files and treats paths containing quotes or brackets literally. A nested session's default scope excludes sibling directories. |
| Native permissions | Allowed references succeed. Read-denied files and aliases fail. Exercise permission prompts with both acceptance and rejection. Diff access follows shell policy, not per-file read policy. |
| Atomic failure | Valid evidence followed by a missing or denied reference fails without partial answers or a provider request. Confirm zero sends with recording tests, not live output alone. |
| Code Mode regression | Structured score legends and choice-entry lists preserve `__proto__` and `constructor` labels. Code Mode cannot preserve `__proto__` as an object-map key. Use entry lists. |
| Cancellation | Cancel a controlled pending request in the separate client. Interruption propagates to OpenCode, with no late result. Hosted cancellation may still incur charges. |

Native display previews may truncate. Include markers beyond display limits when checking evidence content. Expected rejections pass when they match the contract. Record whether the host rejected the schema or the plugin returned an error envelope. Automated tests verify limits and security behavior, not a live model's coverage of long inputs.

## Backend selection across clients

Configure two profiles with controlled endpoints to verify routing without sending real evidence.

- Run `/classify-backend`, `/classify-backend <name>`, and `/classify-backend reset`. Confirm that none starts an LLM turn or inference request.
- In the TUI, use **Classify: Select backend**. Cancel must preserve selection. Choosing the row marked `(default)` must clear the override. Confirm that the sidebar shows the complete profile name, follows session changes, and refreshes on reconnect. Hiding the sidebar must hide the indicator.
- Open the same session in another client and confirm that it sees the override. Reopening the session must preserve it. New and child sessions must use the default.
- Switch during a controlled request. That request and its retries must retain the original backend. The next call must use the new selection.
- Try an unknown profile name and confirm that selection stays unchanged. Remove an overridden profile and confirm that calls fail without fallback, while the picker still allows recovery. Other selection or storage failures must show unavailable rather than a stale selection or the default.
- With a remote client, confirm that profiles, credentials, and evidence resolve on the server. The picker and RPC metadata must expose neither credential sources nor their contents.

Mark web, desktop, and remote-client behavior NOT RUN unless tested in those actual clients.

## Image evidence on a real host

Only OpenAI Decisions supports images. Before live calls, complete the [image implementation tests](./DEVELOPMENT.md#evidence-maintenance).

Prepare and visually inspect two synthetic images with different shapes and colors and neutral filenames `a` and `b`. Create PNG, JPEG, and static WebP versions with an already available converter. Mark missing formats NOT RUN. Keep expected answers out of state, filenames, and prompts except the predeclared choice labels. The caller must not read the images before classification or infer answers from earlier calls.

Add a denied image and alias, an unsupported format, a file above 4 MiB, and a mutable preset image `p.png`. Configure an OpenAI Decisions profile and a non-image-capable profile in the disposable project. See [image contracts and limits](./EVIDENCE.md#images).

### Verify native access and history

Test allowed, prompted, and denied image reads, including the denied alias, through the registered tool. Stop if the pinned host cannot authorize a supported image. Direct filesystem access is not a substitute. Inspect ordinary OpenCode history for native previews and record what persists. Classify output must contain no image bytes or data URLs. Public paths and native previews may remain in host history.

### Live Decisions matrix

| Case | Action | Expected result |
| --- | --- | --- |
| V1 | Classify `a.png`, then `b.png`, with identical independent shape and color questions. | Answers match the inspected images and contain valid typed measurements. |
| V2 | Ask each image's shape with `[a, b]`, then `[b, a]`. | Answers follow reference order. |
| V3 | Repeat V1 with inspected JPEG and static WebP versions. | Visual answers agree across encodings. |
| V4 | Combine an image, explicit text marker, and marker file; ask independent visual/text questions. | Both image and text evidence survive resolution. |
| V5 | Invoke a named preset using `p.png`, replace it with `b.png`, and invoke it again. | The second call uses fresh pixels. Both results retain the classifier name. |
| V6 | Invoke with a read-denied image and its alias in separate calls. | Each returns `EVIDENCE_ERROR` with zero attempts. |
| V7 | Make a valid image call on the non-image backend. | It returns `UNSUPPORTED_INPUT` with zero attempts and no fallback. |
| V8 | Test an unsupported format, URL reference, oversized file, and a batch with a valid first image and invalid second image. | Format and overflow failures return `EVIDENCE_ERROR`. A URL yields `INVALID_INPUT` or host rejection. No case starts inference or returns partial results. |
| V9 | Test mixed text-only answer types after image calls. | Text requests and results retain their existing behavior. |

These are visual sanity checks, not accuracy benchmarks. Investigate unexpected answers instead of retrying until a preferred answer appears. Recording fixtures prove zero reads or sends. Live output alone does not. The [image spec](../../specs/classify-image-evidence-openai-decisions.md) separates local checks A1 through A8 from real-host checks A9 and V1 through V9.

## Report and cleanup

Record the following:

- Timestamp and runtime, plugin, client, provider, and model versions.
- Redacted configuration, commands, and tool arguments.
- Each case's PASS, FAIL, or NOT RUN status, sanitized results, and request IDs.
- Native permission and history observations.
- Missing credentials, billable authorization, clients, converters, or native tools.
- Cleanup and restoration of the test session.

Keep automated and live results separate.

Restore the test session's original directory and backend. Close clients and stop servers started for the test. Keep failing fixtures until diagnosed, then delete only the exact recorded disposable directory. Removing fixtures does not remove normal OpenCode history. Rerun relevant checks for the current revision rather than relying on historical reports.
