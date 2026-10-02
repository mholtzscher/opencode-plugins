import { Effect, Schema, SchemaIssue, SchemaParser } from "effect";

import { MAX_BYTES, MAX_JSON_DEPTH } from "../limits.js";
import { isBoundedJsonValue } from "./json.js";

export const CONTENT_MESSAGE =
  "Expected a nonblank string, nonempty JSON object, or nonempty JSON array.";
const DEFAULT_JSON_LIMITS = { maxBytes: MAX_BYTES, maxDepth: MAX_JSON_DEPTH };

interface SanitizedInputIssue {
  message: string;
  path: string;
}

// Never use SchemaError.message: built-in messages can include submitted values.
const issueDetails = (
  issue: SchemaIssue.Issue,
  prefix = ""
): SanitizedInputIssue => {
  switch (issue._tag) {
    case "Pointer": {
      return issueDetails(
        issue.issue,
        prefix +
          issue.path
            .map(
              (key) =>
                `/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`
            )
            .join("")
      );
    }
    case "Filter": {
      return {
        ...issueDetails(issue.issue, prefix),
        message:
          issue.filter.annotations?.message ??
          "Input does not satisfy the classification contract.",
      };
    }
    case "Encoding": {
      return issueDetails(issue.issue, prefix);
    }
    case "Composite": {
      return issueDetails(issue.issues[0], prefix);
    }
    case "AnyOf": {
      if (issue.issues.length === 0 && prefix.includes("/questions/")) {
        return {
          message: 'Question type must be "noul", "choice", or "score".',
          path: `${prefix}/type`,
        };
      }
      const details = issue.issues.map((child) => issueDetails(child, prefix));
      return (
        details.toSorted(
          (a, b) => b.path.split("/").length - a.path.split("/").length
        )[0] ?? { message: CONTENT_MESSAGE, path: prefix }
      );
    }
    case "UnexpectedKey": {
      return {
        message: "Object contains unsupported fields.",
        path: prefix.replace(/\/[^/]*$/u, ""),
      };
    }
    case "InvalidValue": {
      return {
        message: issue.annotations?.message ?? CONTENT_MESSAGE,
        path: prefix,
      };
    }
    default: {
      if (issue._tag === "MissingKey") {
        return { message: "Missing required field.", path: prefix };
      }
      return {
        message: prefix.endsWith("/type")
          ? 'Question type must be "noul", "choice", or "score".'
          : CONTENT_MESSAGE,
        path: prefix,
      };
    }
  }
};

/** A safe JSON Pointer and message for a schema issue. */
export const schemaIssueDetails = (
  issue: SchemaIssue.Issue
): SanitizedInputIssue => {
  const details = issueDetails(issue, "");
  if (details.path === "/classifier") {
    return {
      message:
        "No configured classifier accepts this request. Presets with configured state reject state; other classifiers require it.",
      path: details.path,
    };
  }
  // Choice-map descriptions identify the criteria as a whole.
  return /\/criteria\/[^/]+$/u.test(details.path)
    ? { ...details, path: details.path.replace(/\/[^/]+$/u, "") }
    : details;
};

const invalidBounds = () =>
  new SchemaIssue.InvalidValue({
    message: "Input must contain bounded JSON values, not accessors.",
  });
const sanitizeIssue = (issue: SchemaIssue.Issue): SchemaIssue.Issue => {
  const details = schemaIssueDetails(issue);
  const leaf = new SchemaIssue.InvalidValue({ message: details.message });
  if (details.path === "") {
    return leaf;
  }
  const segments = details.path
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  return new SchemaIssue.Pointer(segments, leaf);
};

// Declaration parameters flip for encoding. This puts the guard before the
// concrete parser in both directions, rather than reversing a decoding chain.
// Keep canonical JSON parsing on the declaration. A representation-only check
// publishes the concrete contract without putting structural parsing before the guard.
export const boundedCodec = <S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  limits = DEFAULT_JSON_LIMITS
) =>
  Schema.declareConstructor<S["Type"], S["Encoded"]>()(
    [schema],
    ([inner]) =>
      (value, _ast, options) =>
        Effect.suspend(() => {
          if (!isBoundedJsonValue(value, limits)) {
            return Effect.fail(invalidBounds());
          }
          return SchemaParser.decodeUnknownEffect(inner)(value, {
            ...options,
            reportInput: false,
          }).pipe(
            Effect.mapError(sanitizeIssue),
            Effect.flatMap((result) =>
              isBoundedJsonValue(result, limits)
                ? Effect.succeed(result)
                : Effect.fail(invalidBounds())
            )
          );
        }),
    {
      // oxlint-disable-next-line unicorn/no-useless-undefined -- Undefined tells Effect the declaration is already a canonical JSON codec.
      toCodecJson: () => undefined,
    }
  ).check(
    Schema.makeFilter(() => true, {
      representation: {
        id: "classify/BoundedJsonContract",
        payload: null,
        schemas: [Schema.toCodecJson(Schema.toEncoded(schema)).ast],
      },
      toJsonSchema: ({ schemas }) => schemas[0],
    })
  );
