import { Plugin } from "@opencode/plugin";
import { parseOptions } from "./config.js";
import { createEvidenceResolver } from "./evidence.js";
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
      "Put the content being judged in state and each judgment in question.instructions. Question IDs are response keys, not instructions.",
      "Supply self-contained evidence: the backend receives state and the selected questions, not conversation history. Plain paths and embedded URLs are inert data; only the explicit evidence wrapper reads files or diffs. Submitted content may be sent to a remote backend and incur charges.",
      "State, instructions, and non-null criteria descriptions must be nonblank strings, nonempty JSON objects, or nonempty JSON arrays. Nested JSON may contain null, booleans, and finite numbers. Supply 1–64 questions; IDs must match ^[A-Za-z][A-Za-z0-9_-]{0,63}$. Inputs are limited to 32 JSON levels and the expanded provider request to 1 MiB; keep evidence focused.",
      'To read server-local files or Git diffs directly, use state: { type: "evidence", text?, files?: [path], diffs?: [{ base, paths? }] }. Paths are relative to the session directory; base is compared with the tracked working tree (including staged changes, excluding untracked files). Native read/shell permissions apply. Text files only; no truncation.',
      'noul returns a number in [0, 1], the probability of yes, not a boolean. Its optional criteria defines "true", "false", or both.',
      'choice requires 2–255 distinct nonblank labels (at most 128 characters each); descriptions may be null. It always selects one allowed label: include an "unknown" label with an insufficient-evidence criterion if needed; there is no automatic abstention. Backend limits may be tighter (Laya supports at most 100 choices).',
      "score requires 2–10 ordered rubric levels and returns a possibly fractional number on the zero-based scale 0…criteria.length - 1, not a percentage. Order levels from lowest to highest for the property being rated.",
      'Choice criteria accept a label-to-description map or [{ label, description }]. Use the list form for special labels such as "__proto__" that Code Mode cannot preserve as object keys. Score legends preserve string, object, or array level descriptions.',
      "Supply questions for an ad hoc request, or classifier for a configured question map, never both. For judgments depending on previous answers, make another call.",
      "Code Mode returns a JSON string: parse it and check ok before reading result.answers[id]. Success is { ok: true, result: { answers, provider, model, usage, durationMs, classifier?, requestID? } }; failure is { ok: false, error: { code, message, retryable, provider, status? } }, with no partial answers. retryable means a later retry may help, not that it is free; a timed-out request may already incur cost.",
      "Answer fields: noul → { type, noul }; choice → { type, choice, probabilities, confidence }; score → { type, score, legend, probabilities, confidence }. Distributions use choice labels or zero-based score indices as keys. Native confidence is not probability of correctness; no explanations or permission to execute an action are returned.",
      'Example input: {"state":"Production is down after a deploy.","questions":{"active":{"type":"noul","instructions":"Does this describe an active incident?"},"kind":{"type":"choice","instructions":"Categorize the report.","criteria":{"incident":"Active production failure","other":"Not an incident","unknown":"Insufficient evidence"}},"impact":{"type":"score","instructions":"Rate user impact.","criteria":["No user impact","Some users affected","Production unavailable"]}}}',
      'Code Mode handling: const raw = await tools.classify(input); if (raw === null) throw new Error("No classification output"); const output = JSON.parse(raw); return output.ok ? output.result.answers : output.error;',
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
        description,
        execute: async (input, context) => ({
          content: JSON.stringify(
            await service.classify(
              input,
              context.signal,
              async (state, signal) => {
                const session = await ctx.session.get(
                  { sessionID: context.sessionID },
                  { signal }
                );
                const tools = await ctx.tool.list();
                return createEvidenceResolver(
                  session.location.directory,
                  tools,
                  context
                )(state, signal);
              }
            )
          ),
        }),
        input: buildToolInputSchema(options.classifiers ?? {}),
        name: "classify",
      });
    });
  },
});
