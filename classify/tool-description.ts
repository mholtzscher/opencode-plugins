import type { ClassifierDefinition } from "./config.js";
import {
  MAX_CHOICES,
  MAX_JSON_DEPTH,
  MAX_LABEL_LENGTH,
  MAX_QUESTIONS,
  MAX_SCORE_LEVELS,
  MIN_CHOICES,
  MIN_SCORE_LEVELS,
  NAME_PATTERN,
} from "./limits.js";

export const buildToolDescription = (
  classifiers: Record<string, ClassifierDefinition>
): string => {
  const entries = Object.entries(classifiers);
  return [
    "Evaluate content against independent typed questions using the user's configured decision backend.",
    "Put the content being judged in state and each judgment in question.instructions. Question IDs are response keys, not instructions.",
    "Supply self-contained evidence: the backend receives state, explicitly resolved images, and the selected questions, not conversation history. Plain paths and embedded URLs are inert data; only the explicit evidence wrapper reads files, queried code, diffs, or images. Submitted content may be sent to a remote backend and incur charges.",
    `State, instructions, and non-null criteria descriptions must be nonblank strings, nonempty JSON objects, or nonempty JSON arrays. Nested JSON may contain null, booleans, and finite numbers. Supply 1–${MAX_QUESTIONS} questions; IDs must match ${NAME_PATTERN.source}. Inputs and resolved non-image content are limited to 1 MiB and ${MAX_JSON_DEPTH} JSON levels. Text-only provider requests stay within 1 MiB; keep evidence focused.`,
    'Read server-local evidence with state: { type: "evidence", text?, files?: [path | { path, offset?, limit? }], code?: [{ path, query }], diffs?: [{ base, paths? }], images?: [{ path }] }. Code runs raw Tree-sitter queries and sends exact @evidence captures with source ranges; other capture names are query helpers. Use classify_grammar to discover node types/fields for the file extension. Capture comments and enclosing nodes explicitly. Multiple matches are accepted; duplicate ranges collapse. Queries are limited to 8192 characters, 128 unique captures, and five seconds each; invalid queries, unsupported directives, syntax errors, no captures, and exceeded limits fail without truncation. Paths are relative to the session directory; base is compared with the tracked working tree (including staged changes, excluding untracked files). Native read/shell permissions apply. File and code references accept text files only.',
    'File offset is a 1-based starting line, default 1; limit is the maximum number of lines. Both must be positive safe integers. For example, { path: "src/cache.ts", offset: 120, limit: 60 } selects lines 120 through 179. Omit both for the whole file; omit limit to read through EOF. EOF may return fewer lines; an offset beyond EOF fails. Slices include exact content, startLine, endLine, and partial metadata. Partial reads scan at most 64 MiB per selection and can select from files larger than 1 MiB; selected content shares the 1 MiB request budget. Budget failures never truncate evidence.',
    'OpenAI Decisions only: add images: [{ path: "screenshots/before.png" }, { path: "screenshots/after.png" }] to the evidence wrapper, alone or with text/files/code/diffs. Refer to image 1, image 2, and so on in instructions. Supply 1–4 local PNG, JPEG, or static WebP images, at most 4 MiB each and 8 MiB total; duplicates count. MIME comes from bytes, not extensions. No URLs, inline bytes, GIF, animation, resizing, or automatic chat attachments. Native read permissions apply; resolution has a 30-second total deadline including permission waits. The encoded image request is capped at 13 MiB. Other backends return UNSUPPORTED_INPUT before evidence access. Images are read once per call; retries reuse the same bytes. Images are sent to OpenAI and may incur charges. The plugin stores no image cache, but normal OpenCode history may retain paths and native read image previews. Failures never omit or truncate images.',
    'noul returns a number in [0, 1], the probability of yes, not a boolean. Its optional criteria defines "true", "false", or both.',
    `choice requires ${MIN_CHOICES}–${MAX_CHOICES} distinct nonblank labels (at most ${MAX_LABEL_LENGTH} characters each); descriptions may be null. It always selects one allowed label: include an "unknown" label with an insufficient-evidence criterion if needed; there is no automatic abstention. Backend limits may be tighter (Laya supports at most 100 choices).`,
    `score requires ${MIN_SCORE_LEVELS}–${MAX_SCORE_LEVELS} ordered rubric levels and returns a possibly fractional number on the zero-based scale 0…criteria.length - 1, not a percentage. Order levels from lowest to highest for the property being rated.`,
    'Choice criteria accept a label-to-description map or [{ label, description }]. Use the list form for special labels such as "__proto__" that Code Mode cannot preserve as object keys. Score legends preserve string, object, or array level descriptions.',
    "Supply state and questions for an ad hoc request, or classifier for a configured preset, never both questions and classifier. Named classifiers require caller-supplied state unless they define their own; when state is configured, supply only classifier and never override state. Configured evidence resolves freshly per invocation with the same session-relative paths and native permissions. For judgments depending on previous answers, make another call.",
    "Returns structured output: check ok before reading result.answers[id]. Success is { ok: true, result: { answers, provider, model, usage: { input_tokens, output_tokens }, attempts, durationMs, classifier?, requestID? } }; failure is { ok: false, error: { code, message, retryable, provider, attempts, durationMs, path?, status?, requestID?, retryAfterMs? } }, with no partial answers. attempts counts HTTP dispatches, including the initial request; zero means no dispatch. path is a JSON Pointer into invalid input. retryAfterMs is the provider's suggested wait, when available. retryable means a later retry may help, not that it is free; a timed-out request may already incur cost.",
    "Answer fields: noul → { type, noul }; choice → { type, choice, probabilities, confidence }; score → { type, score, scale: { min: 0, max: criteria.length - 1 }, legend, probabilities, confidence }. All listed answer fields and usage counts are required. Distributions use choice labels or zero-based score indices as keys. Native confidence is provider-specific, not probability of correctness or necessarily comparable across providers; no explanations or permission to execute an action are returned.",
    'Example input: {"state":"Production is down after a deploy.","questions":{"active":{"type":"noul","instructions":"Does this describe an active incident?"},"kind":{"type":"choice","instructions":"Categorize the report.","criteria":{"incident":"Active production failure","other":"Not an incident","unknown":"Insufficient evidence"}},"impact":{"type":"score","instructions":"Rate user impact.","criteria":["No user impact","Some users affected","Production unavailable"]}}}',
    "In Code Mode, discover the classify namespace and use the returned decide signature. Read output.result.answers only when output.ok is true. Use classify_search to find relevant files before selecting evidence.",
    ...(entries.length === 0
      ? []
      : [
          "Configured classifiers:",
          ...entries.map(
            ([name, value]) =>
              `${name}: ${value.description} (${Object.hasOwn(value, "state") ? "uses configured state; omit state" : "requires caller-supplied state"})`
          ),
        ]),
  ].join("\n");
};
