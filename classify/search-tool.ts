import type { Tool } from "@opencode/schema/tool";
import { Effect } from "effect";

import type { ClassifyOptions } from "./config.js";
import { searchInputSchema, SearchOutputSchema } from "./search-schemas.js";
import { FileSearch } from "./search.js";

export const createSearchTool = (options: ClassifyOptions) =>
  Effect.gen(function* assembleSearchTool() {
    const search = yield* FileSearch;
    return {
      description:
        "Find files relevant to a natural-language query without returning their source text. Supply explicit server-local file/directory paths; Git is not required. Optional terms are case-insensitive literal OR filters on the same bounded prefix evaluated by the backend, not whole-file searches. Each candidate gets a separate relevance judgment. Results include absolute paths, actual source ranges, relevance probabilities, and coverage. Inclusion does not imply high relevance. Prefixes can miss relevant code later in a file. Check coverage.complete, limitsReached, failures, and budgets before interpreting results. Hidden descendants and configured generated directories are excluded by default; .gitignore is not interpreted and descendant symlinks are skipped. Native read permissions apply to directories and files. maxFiles and limit may lower configured ceilings; limit only bounds returned results. Discovery, evidence bytes, concurrency, and time have independent budgets. The session backend is captured once; file/provider failures return partial results, the deadline returns completed results, and session cancellation interrupts the search. Evidence may be sent to a remote backend. Usage and attempts count completed responses and can omit in-flight requests and failed-attempt tokens. Use classify_decide with returned references for follow-up judgments.",
      execute: (input, context) =>
        search
          .search(input, context)
          .pipe(Effect.map((output) => ({ output }))),
      input: searchInputSchema(options.search),
      name: "search",
      options: { codemode: true, namespace: "classify" },
      output: SearchOutputSchema,
    } satisfies Tool.Info;
  });
