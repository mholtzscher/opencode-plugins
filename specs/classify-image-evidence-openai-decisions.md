# Image evidence with OpenAI Decisions

Status: Implemented and locally/live verified, pending PR checks. Approved for implementation on 2026-10-07. Date: 2026-10-07. Estimated effort: L, approximately 1–2 days including regression tests and documentation.

## Problem and scope

Classify cannot currently judge screenshots or product photos. Its tool accepts text and structured JSON, and resolves explicit text file, code, and diff evidence. Users need to ask the existing typed questions against images without copying image bytes into tool arguments.

Add local image references to the existing `type: "evidence"` state. OpenAI Decisions is the only image-capable backend in this pilot. Support image-only and mixed evidence requests, including named classifiers with preset evidence. Keep answers, question types, backend selection, and text-only calls compatible.

The initial request included local files and URLs. Discovery established that Decisions cannot fetch hosted URLs, and the pinned OpenCode plugin API has no direct per-URL permission-request method. The user chose a local-only pilot rather than authorizing downloads through Classify permissions or introducing a separate fetch tool. URL support is deferred, not silently implemented.

## Verified API and architecture

- [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions), checked 2026-10-07: `POST /v1/decisions`, model `gpt-6-luna`, accepts a string or user messages containing `input_text` and `input_image` parts. Images require inline base64 data URLs. Hosted URLs and `file_id` are unsupported.
- [OpenCode V2 plugin guide](https://opencode.ai/v2/docs/build/plugins): registered native tools can be invoked with the calling tool context. Installed `@opencode/schema` 2.0.21 exposes no direct permission-request method on `Tool.Context`.
- `classification.ts` validates and resolves named classifiers, calls backend preflight, resolves evidence, then dispatches. Capability rejection must stay before evidence, credentials, or network reads.
- `EvidenceAccess.resolve` returns text/JSON `Content` and is also used by file search. Do not change its return type to include binary content.
- `providers/openai-decisions.ts` already has a custom request encoder. It shares credentials, bounded HTTP transport, retries, deadlines, and answer decoding through `protocols/system-one.ts`.
- `requireBoundedJson` currently enforces a 1 MiB JSON limit on input and encoded provider payloads. Raising that global limit would weaken unrelated input and response boundaries.
- `evidence.ts` uses canonical paths, descriptor identity checks, scoped cleanup, native `read` permission checks, and bounded file reads. Image access must follow the same file-access protections.
- The plugin is an independent Bun package. No workspace or TUI contract changes are needed.

## Proposed input

```json
{
  "state": {
    "type": "evidence",
    "text": "Compare the before and after screenshots. Image 1 is before; image 2 is after.",
    "images": [
      { "path": "screenshots/before.png" },
      { "path": "screenshots/after.png" }
    ],
    "files": ["src/components/settings.tsx"]
  },
  "questions": {
    "fixed": {
      "type": "noul",
      "instructions": "Is the overlapping text in image 1 absent from image 2?"
    }
  }
}
```

Each image reference is exactly `{ path: string }`. Paths are nonblank literal file paths without null characters, resolved against the invoking session directory, not the plugin directory. Absolute paths follow existing evidence permissions. No shorthand strings, URLs, caller-supplied MIME types, inline bytes, or image transformations in the pilot.

Array order defines image identity. Instructions can refer to image 1, image 2, and so on. Duplicates remain duplicates and count against budgets. An evidence state containing only `images` is valid. An empty array is invalid. Ordinary JSON without the evidence marker stays literal, including objects with an `images` key.

## Limits and file validation

Fixed plugin limits, not claims about OpenAI's maximums:

| Boundary | Limit |
| --- | --- |
| Images per call | 4 |
| Raw bytes per image | 4 MiB |
| Raw image bytes per call | 8 MiB |
| Formats | PNG, JPEG, WebP |
| Public tool arguments | Existing 1 MiB and depth 32 |
| Resolved non-image state and questions | Existing 1 MiB bounds |
| Complete encoded image request | 13 MiB, depth 32 |
| Provider responses | Existing 1 MiB limit |
| Image-resolution deadline | 30 seconds total, including permission waits |

Reads are sequential and bounded by the smaller of the per-image limit and remaining aggregate budget. Never truncate, resize, or omit evidence. A one-byte overflow fails before inference. Resolve and read images once per invocation; provider retries reuse the encoded body and do not re-read files.

Determine MIME type from bytes, not the extension or caller metadata. Use bounded checks for supported signatures and basic container structure:

- Check the PNG signature and IHDR.
- Check JPEG SOI and a valid frame header.
- Check the WebP RIFF/WEBP header, size, and supported image chunk.

Reject obvious malformed containers, empty content, text, SVG, PDF, GIF, and animated PNG or WebP. These checks do not decode pixels or detect all corruption. The provider rejects remaining decoder failures. This pilot adds no pixel-count limit or dimension-based transformation.

Use a regular-file descriptor, canonicalize the path, and verify descriptor/path identity before and after native permission checking. Reject non-regular files and path replacement races. Apply existing bounded-file mutation/size checks. Close handles on success, failure, interruption, and timeout.

The native `read` tool authorizes local access, as it does for text evidence. It may create an image preview in ordinary OpenCode history. A live smoke check must confirm this works with the pinned runtime; do not bypass permission failures with direct reads.

## Types and interfaces

Schemas own public input types. Add a strict image reference schema using the existing path constraints, export its inferred type, add bounded `images` to `EvidenceSchema`, and include it in evidence-presence checks and schema descriptions.

Focused changes to `classify/types.ts`:

```diff
 export type EvidenceState = typeof EvidenceSchema.Type;
+export type EvidenceImage = NonNullable<EvidenceState["images"]>[number];
+export interface ResolvedImage {
+  readonly mime: "image/png" | "image/jpeg" | "image/webp";
+  readonly byteLength: number;
+  readonly dataURL: string;
+}
 export interface DecisionRequest {
   questions: Questions;
   state: Content;
+  images?: readonly ResolvedImage[];
 }
```

`ResolvedImage` is internal resolved evidence. Never accept it through the public tool schema or serialize it into tool output. Its MIME, byte count, and data URL are created only by the image resolver. The original path is not sent to the provider.

Focused changes to `classify/providers/backend.ts`:

```diff
+export interface EvidenceRequirements {
+  readonly images: boolean;
+}
 export interface DecisionAdapter {
-  preflight: (questions: Questions) => Effect.Effect<void, ClassificationError>;
+  preflight: (
+    questions: Questions,
+    requirements?: EvidenceRequirements
+  ) => Effect.Effect<void, ClassificationError>;
 }
```

The optional second argument preserves text-only search callers. Extend `createPreflight` with an optional `supportsImages` argument defaulting to false. Only the OpenAI Decisions definition opts in. All providers, including adapters that do not use System One, must enforce the requirement. Add a defensive image rejection in non-image-capable `decide` methods so direct internal callers cannot silently discard images.

Add `UNSUPPORTED_INPUT` to `ERROR_CODES` for otherwise valid evidence unsupported by the selected backend. Keep `UNSUPPORTED_TYPE` reserved for question types. Capability failures have zero provider attempts and occur before any evidence I/O. Adding an error code is additive, but downstream exhaustive switches may need updates.

New `classify/image-evidence.ts` service contract:

```ts
export class ImageEvidence extends Context.Service<
  ImageEvidence,
  {
    resolve: (
      images: readonly EvidenceImage[],
      context: Tool.Context
    ) => Effect.Effect<readonly ResolvedImage[], ClassificationError>;
  }
>()("classify/ImageEvidence") {}
```

Provide its live layer through `layers.ts`, with `OpenCodeAccess` for session directory and native read checks. Keep binary resolution separate from `EvidenceAccess`, which remains text-only for search compatibility.

Classification orchestration:

1. Parse input and resolve named classifier state.
2. Preflight questions and `{ images: isEvidence(source) && source.images !== undefined }`.
3. Resolve the non-image evidence through the existing code, stripping `images` from the source sent to `EvidenceAccess`. For image-only evidence, use `{}` as the temporary text state and skip `EvidenceAccess`; replace it with the ordinal manifest below before dispatch.
4. Resolve all images under the dedicated deadline. Failure aborts the entire call.
5. For image calls, append an ordinal manifest to resolved state as `{ evidence: existingResolvedState, images: [{ index: 1 }, ...] }`. This shape applies only to the new image path. It lets the model connect numbered references to ordered image parts without receiving local paths. Validate this non-image state together with questions under the existing input budget.
6. Call the selected backend with `{ questions, state, images }`. Omit `images` entirely for old calls.

OpenAI encoding:

```diff
   encode: (model, request) => ({
-    input: text(request.state),
+    input: request.images?.length
+      ? [{
+          role: "user",
+          content: [
+            { type: "input_text", text: text(request.state) },
+            ...request.images.map((image) => ({
+              type: "input_image",
+              image_url: image.dataURL,
+            })),
+          ],
+        }]
+      : text(request.state),
     model,
```

Keep question encoding and response decoding unchanged. No Responses/chat fallback and no backend failover.

Extend `SystemOneDefinition` with `supportsImages?: boolean`. In `encodeRequest`, use the 13 MiB encoded-body budget only when the definition supports images and the request contains them. Add an optional limits argument to `requireBoundedJson`. Preserve depth, prototype, accessor, and cycle checks without changing global defaults. Check actual UTF-8 serialized body length before credential or network access. Text-only provider bodies remain capped at 1 MiB. Keep response bounds in `transport.ts` unchanged.

## Errors, cancellation, and data handling

- Invalid public shape, empty image array, too many references, URL-shaped paths, and inline data inputs: `INVALID_INPUT`.
- Valid image evidence on another backend: `UNSUPPORTED_INPUT`, no I/O or credential access.
- Missing/unreadable file, permission denial, unsupported format, basic container failure, byte overflow, or file mutation: sanitized `EVIDENCE_ERROR`.
- Image-resolution deadline: `TIMEOUT` with zero provider attempts.
- Encoded request overflow: `INVALID_INPUT` before credentials/network access.
- OpenAI HTTP failures and refusals retain the existing mappings and attempt accounting.
- Session interruption remains interruption, not an error envelope. Scoped cleanup must complete.

Keep image bytes, data URLs, and raw filesystem errors out of tool output, logs, progress metadata, error details, and storage. Public input history contains paths, and native `read` previews may retain images. Documentation must distinguish plugin storage from normal OpenCode history. Classify sends explicitly resolved images to OpenAI, which may incur charges. It does not cache images or collect conversation attachments automatically.

## Project layout and ownership

```text
specs/
└── classify-image-evidence-openai-decisions.md # new, proposed feature contract
classify/
├── classification-schemas.ts   # modify, public image evidence schema
├── types.ts                    # modify, inferred references and resolved images
├── limits.ts                   # modify, fixed image and encoded-body budgets
├── errors.ts                   # modify, unsupported input error code
├── classification.ts           # modify, preflight and mixed evidence composition
├── image-evidence.ts           # new, permission-checked bounded image resolver
├── image-format.ts             # new, pure bounded format/container checks
├── layers.ts                   # modify, provide image resolver service
├── tool-description.ts         # modify, input examples and privacy/limit guidance
├── providers/
│   ├── backend.ts              # modify, evidence requirements and default rejection
│   ├── openai-decisions.ts     # modify, capability and multimodal encoding
│   └── other adapter modules   # modify, preflight and direct-call rejection
├── protocols/
│   └── system-one.ts           # modify, capability-specific encoded body budget
├── validation/
│   └── json.ts                 # modify, optional explicit bounds with old defaults
├── tests/
│   ├── image-evidence.test.ts  # new, permissions, reads, budgets, cleanup
│   ├── image-format.test.ts    # new, format fixtures and bounded parsing
│   ├── openai-decisions.test.ts # modify, image wire contracts and retries
│   ├── classification.test.ts  # modify, orchestration and early rejection
│   ├── classification-schemas.test.ts # modify, image schema validation
│   ├── plugin.test.ts          # modify, registered-tool/native read integration
│   └── related existing tests  # modify, adapter/service fixtures and regressions
├── README.md                   # modify, image evidence example
└── docs/
    ├── EVIDENCE.md             # modify, formats, ordering, permissions, budgets
    ├── TOOL_REFERENCE.md       # modify, schema and error semantics
    ├── CONFIGURATION.md        # modify, OpenAI image capability and exclusions
    ├── DEVELOPMENT.md          # modify, new service and encoder bounds
    └── SMOKE_TESTING.md        # modify, opt-in image validation procedure
```

No changes to TUI, RPC, search input/output, plugin options, package dependencies, or persistent state. Shared typecheck still covers both server and TUI. Reuse existing bounded regular-file helpers without weakening text checks.

## Deliverables

| ID | Outcome | Effort | Owning paths | Dependencies | Acceptance |
| --- | --- | --- | --- | --- | --- |
| D1 | Public image schema, fixed limits, types, and capability contract | M | `classification-schemas.ts`, `types.ts`, `limits.ts`, `errors.ts`, `providers/backend.ts`, adapter modules, schema/classification tests | None | A1, A2 |
| D2 | Safe local image loading and bounded format checks | M | `image-evidence.ts`, `image-format.ts`, `tests/image-evidence.test.ts`, `tests/image-format.test.ts` | D1 | A3, A4 |
| D3 | Mixed evidence orchestration and OpenAI message encoding with separate body bounds | M | `classification.ts`, `layers.ts`, `providers/openai-decisions.ts`, `protocols/system-one.ts`, `validation/json.ts`, related tests | D1, D2 | A5, A6, A7 |
| D4 | Registered-tool verification, documentation, and live smoke procedure | M | `tests/plugin.test.ts`, `tool-description.ts`, README, docs | D3 | A8, A9 |

## Acceptance and validation

| ID | Boundary and expected behavior | Concrete check |
| --- | --- | --- |
| A1 | Image-only and mixed evidence pass schemas; empty/5-image arrays, excess fields, URLs, GIF/data inputs, null paths fail; ordinary JSON remains literal; preset named classifiers resolve images freshly. | From `classify/`, `bun test tests/classification-schemas.test.ts tests/classification.test.ts`. Include URL strings inside both supported and unsupported reference shapes. |
| A2 | Every non-OpenAI backend rejects image evidence before text/image reads, credentials, or HTTP. Text-only search preflight is unchanged. Direct non-image adapter calls reject images. | Recording dependencies in classification tests plus relevant adapter tests; run full `bun test` in `classify/`. |
| A3 | Valid PNG/JPEG/WebP bytes work regardless of extension. Empty, unsupported, malformed-header, and animated inputs fail. Parsing is bounded even for hostile segment/chunk lengths. | `bun test tests/image-format.test.ts` with committed small binary fixtures or byte-built fixtures. Test actual containers, not only signature bytes. |
| A4 | Files resolve from session directory, pass native permission checks, and stay descriptor-consistent; denial, symlink replacement, nonregular files, mutation, limit+1 bytes, aggregate overflow, and interruption fail without inference. Handles close and the 30-second deadline includes permission waits. | `bun test tests/image-evidence.test.ts`; injected access/file fixtures, bounded overflow files, fake clock, and cleanup assertions. |
| A5 | OpenAI receives one user message with text followed by ordered image parts and verified data URL bytes. Image-only state includes ordinal mapping. No local paths leak into the encoded image request. Mixed file/code/diff text is retained. | `bun test tests/openai-decisions.test.ts tests/classification.test.ts`; record exact HTTP JSON and decode data URLs to compare source bytes. |
| A6 | Requests above 1 MiB work only for validated OpenAI image calls and remain below 13 MiB. Public input, text-only bodies, non-image state, JSON depth/security checks, and response bounds remain unchanged. | Budget boundary and malicious-object regression cases in existing validation/provider/transport tests; full `bun test`. Check both configured JSON bounds and actual serialized bytes. |
| A7 | Provider retries reuse identical image bytes after source changes and perform no repeated reads. Failure of one image aborts the whole call. Errors/logs contain no bytes or raw filesystem messages; refusal handling and interruption propagation stay unchanged. | Recording file access and HTTP retry fixtures in image/classification/OpenAI tests; full `bun test`. |
| A8 | Registered `classify_decide` resolves images through native read with calling session context and selected backend. Existing search, grammar, TUI type contracts, and text-only tests still pass. | From `classify/`, `bun install`, `bun run typecheck`, `bun test`; from root, `bun run check`. No live API prerequisite. |
| A9 | Actual pinned OpenCode runtime supports native image read/permission flow; a local image and mixed evidence reach Decisions and return the existing typed answer shape. Docs state limits, local-only scope, and history implications. | Opt-in manual smoke procedure in `docs/SMOKE_TESTING.md`: disposable directory with real PNG/JPEG/WebP fixtures, configured OpenAI backend and server-side key; allow and deny native reads, then run image-only and mixed calls. Record runtime/model versions, wire outcome, and cleanup. No automatic billable runs. |

## Feature validation procedure

Validation runs in three stages. Automated checks are required before live calls. Live checks are opt-in, billable, and require a server-side OpenAI key. No live checks have been performed as part of this spec.

### 1. Deterministic tests without OpenAI

Implement the A1–A8 tests above using real small image fixtures, recording services, and injected HTTP responses. Verify byte-for-byte image transmission, not merely the presence of an `input_image` field. Decode each recorded data URL and compare its MIME and bytes with the permitted source file.

Use spies that fail the test if a rejected request touches credentials, evidence, or HTTP. Count file reads across a forced retry and assert that the second request body equals the first even if the fixture file changes. Verify that an invalid second image prevents any inference request rather than submitting a partial batch.

Exercise each limit at its boundary and one byte or reference beyond it. Use injected descriptors or bounded synthetic files for budget tests. Arbitrary padding is not a substitute for valid format fixtures. Cancellation tests must assert descriptor cleanup and propagated interruption, rather than only a returned failure.

Required commands from `classify/`:

```sh
bun install
bun run typecheck
bun test tests/classification-schemas.test.ts tests/classification.test.ts
bun test tests/image-format.test.ts tests/image-evidence.test.ts
bun test tests/openai-decisions.test.ts tests/plugin.test.ts
bun test
```

Then run `bun run check` from the repository root. New test-file commands become runnable during implementation. The full suite is required even when focused tests pass.

### 2. Registered tool on a real OpenCode server

Extend `classify/docs/SMOKE_TESTING.md` with an image fixture setup and case matrix. Use a disposable project under `/tmp/opencode/`, synthetic images, the local plugin, and a separate test session. Resolve references through the actual registered `classify_decide` tool, not a direct adapter call. Follow the existing guide's effective-plugin and permission checks.

Prepare known, visibly different fixtures with neutral filenames:

- `a.png`: a large solid red square on white.
- `b.png`: a large solid blue circle on white.
- JPEG and static WebP versions of those same images, visually inspected before testing.
- `context.txt`: a synthetic marker used only to prove mixed text/image evidence survives resolution.
- `denied.png` and a symlink to it, denied through the native read permission rules.

The shapes and colors are ground truth recorded separately from the tool input. Do not include the expected answer in filenames, text, or question descriptions. This prevents a passing result based only on leaked labels.

First use a recording backend through the registered plugin integration tests to prove permission denial causes zero provider sends. Then verify on the real host that allowed reads succeed and denied reads and aliases fail. Inspect normal native-read history for image previews and document the observed retention behavior. Never log or retain the OpenAI request body's base64 to validate a live call.

### 3. Live OpenAI Decisions smoke matrix

With explicit authorization for billable calls, select the configured `openai-decisions` backend and record the actual runtime, plugin revision, and returned model. Use independent questions in the same call where possible.

| Case | Action | Expected result |
| --- | --- | --- |
| V1 | Image-only call with `a.png`; ask choice questions for visible shape and dominant shape color. Repeat with `b.png`. | Existing typed result contract; square/red versus circle/blue. Different pixels must change the answers while question text stays identical. |
| V2 | Supply `[a.png, b.png]`, then `[b.png, a.png]`; ask the shape of image 1 and image 2. | Answers follow array order, not filenames or previous calls. |
| V3 | Repeat image-only questions with corresponding JPEG and static WebP files. | All three formats are accepted; visible shape/color answers agree across encodings. |
| V4 | Combine an image, explicit text, and `context.txt`; ask one visual question and one question about the synthetic text marker. | Both independent questions use their supplied evidence and return valid measurements. |
| V5 | Invoke a named classifier with preset image evidence; replace its fixture with the other known image and invoke again. | The second call reflects fresh file contents, with no image cache. |
| V6 | Deny native read for an image and its alias, then call Classify. | `EVIDENCE_ERROR`, zero provider attempts, no permission bypass. Confirm zero sends in the deterministic integration test rather than inferring it solely from live output. |
| V7 | Select a non-image backend and repeat a valid image call. | `UNSUPPORTED_INPUT`, zero attempts, no evidence/credential/network reads as proved by recording tests. |
| V8 | Submit an unsupported format, a URL reference, and an oversized image in separate calls. | Expected input/evidence errors before inference; no partial result. |
| V9 | Run an existing text-only Decisions example after the image cases. | Old request and result semantics still work. |

V1–V5 provide a basic visual sanity check, not an accuracy benchmark. Unexpected visual answers fail that smoke case and require investigation; do not rerun until a preferred answer appears or tune assertions to the observed output. Do not require exact probabilities. Check the existing distribution/range contract and the predeclared choice labels. Any later production accuracy claim needs a separate representative labeled dataset.

### Evidence and completion gate

Record each case as PASS, FAIL, or NOT RUN in the smoke-testing verification section, along with commands, timestamp, runtime/model versions, sanitized result fields, and relevant acceptance IDs. Record skipped prerequisites explicitly. Never publish credentials, request image bytes, or private screenshots.

The implementation is locally verified only when A1–A8 pass, typecheck and the full test suite pass, and root checks pass. Call the pilot end-to-end verified only after A9 and V1–V9 pass on the real host. If credentials or authorization are unavailable, report live validation as NOT RUN; do not claim completion of end-to-end verification. Clean up only the disposable test project's resources and restore any changed test-session backend selection.

## Alternatives and trade-offs

| Choice | Alternative | Reason |
| --- | --- | --- |
| Extend evidence state | New image-only tool/state type | One existing judgment interface handles mixed evidence. |
| Separate image resolver | Change text evidence return type | Keep file search and text evidence compatible. |
| Local-only pilot | Server-side URL downloads now | No new network permission or SSRF boundary. |
| Fixed low image budgets | Expose provider maximums/configurable budgets | Limit memory and request growth until there is usage evidence. |
| Native read authorization | Direct filesystem access only | Preserve existing OpenCode permissions and session context. |
| Capability-specific body budget | Raise global 1 MiB limit | Avoid weakening other inputs and provider responses. |

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Native image read materializes a preview or fails on pinned runtime | Verify with a real-host smoke check; document history retention. Never bypass permission checks. |
| Base64 and JSON copies increase peak memory | Read sequentially, cap raw bytes at 8 MiB, avoid retaining raw buffers after encoding, cap final request at 13 MiB, reuse the body for retries. |
| Bounded container checks miss corruption or reject an edge-case valid image | Keep checks explicit and covered by real fixtures; provider validates image decoding. No claim of complete decoding or pixel safety. |
| Beta Decisions contract changes | Isolate message encoding in the provider adapter and cover exact request shape with tests. Recheck official docs before implementation. |
| Shared preflight changes leave an adapter silently dropping images | Test every configured provider and defensive direct-call rejection, including non-System-One adapters. |

## Non-goals and follow-up

No URL fetching, inline caller base64, GIF/animation, resizing, OCR preprocessing, attachments collected from chat, image search, automatic failover, new classifier outputs, or other provider image support.

Future URL support must settle permission authorization before implementation, then enforce public HTTPS destinations, credential-free URLs, no redirects, bounded streaming, and DNS-rebinding-resistant connection checks. These are requirements for a later spec, not unowned pilot work.

No unresolved technical choices for the pilot. Automated tests verify contracts and access behavior, not classification accuracy. Pilot success means a permitted local image reaches Decisions through the registered tool while all existing text-only regressions pass. Implementation verification is recorded in `classify/docs/SMOKE_TESTING.md`.
