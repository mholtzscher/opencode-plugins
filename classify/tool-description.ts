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
    "Evaluate content against caller-defined questions and criteria using the configured decision backend. Returns yes/no probabilities, categorical choices, or rubric scores.",
    "Submit text or structured data directly, or reference files, code, diffs, and supported images without copying their contents into chat.",
    `Input: put content in state and each judgment in question.instructions. Batch 1–${MAX_QUESTIONS} questions over shared state; dependent judgments need separate calls. Question IDs are response keys matching ${NAME_PATTERN.source}, not instructions.`,
    "Supply self-contained evidence: the backend receives state and questions, not conversation history. Plain paths and embedded URLs are inert; explicit evidence references resolve on each call. Content may be sent to a remote backend and incur charges.",
    'Question types: noul returns the probability of yes, not a boolean, in [0, 1]; optional criteria defines "true", "false", or both.',
    `choice selects one of ${MIN_CHOICES}–${MAX_CHOICES} distinct nonblank labels (max ${MAX_LABEL_LENGTH} characters; Laya max 100 choices). Criteria maps labels to descriptions or null, or uses [{ label, description }]; use the list for "__proto__". Include an "unknown" label for insufficient evidence if needed: no automatic abstention.`,
    `score uses ${MIN_SCORE_LEVELS}–${MAX_SCORE_LEVELS} ordered rubric levels, lowest to highest. Returns a possibly fractional number on the zero-based scale 0…criteria.length - 1, not a percentage.`,
    'Evidence: set state.type to "evidence" and supply text, files, code, diffs, and/or images. Paths are server-local, relative to the session directory. Native read/shell permissions apply. Files and code require UTF-8 text; file offset is 1-based (default 1), limit counts lines (default through EOF). Code uses raw Tree-sitter queries and sends only @evidence captures; capture comments and enclosing context explicitly. Diffs compare base with staged and unstaged tracked changes; untracked files are excluded.',
    "Images: OpenAI Decisions only; use images: [{ path }], alone or with other evidence. Supply 1–4 local PNG, JPEG, or static WebP images, max 4 MiB each / 8 MiB total. Refer to image 1, image 2, etc. in array order. No URLs, inline bytes, or automatic chat attachments.",
    `Limits: state, instructions, and non-null criteria descriptions must be nonblank strings or nonempty JSON objects/arrays. Inputs and resolved non-image content are limited to 1 MiB and ${MAX_JSON_DEPTH} JSON levels; text-only requests also cap at 1 MiB. Evidence over budget fails without truncation.`,
    "Returns structured output: check ok before reading result.answers[id]; otherwise read error, with no partial answers. retryable means a later retry may help but may incur charges. Confidence is provider-specific, not probability of correctness or necessarily comparable across providers. Results contain measurements, not explanations or authorization to act.",
    'Example input: {"state":{"claim":"All items passed.","observations":["A passed.","B failed."]},"questions":{"consistent":{"type":"noul","instructions":"Is the claim consistent with every observation?"}}}',
    ...(entries.length === 0
      ? []
      : [
          "Use state + questions for ad hoc judgments, or classifier for a configured preset; never supply questions with classifier. Include state only for presets requiring caller input; configured state cannot be overridden.",
          "Configured classifiers:",
          ...entries.map(
            ([name, value]) =>
              `${name}: ${value.description} (${Object.hasOwn(value, "state") ? "uses configured state; omit state" : "requires caller-supplied state"})`
          ),
        ]),
  ].join("\n");
};
