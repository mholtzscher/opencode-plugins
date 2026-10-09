import { Effect, Schema } from "effect";

import type { Github } from "./github.js";
import { decodeJson, ReviewThreadsPage } from "./schemas.js";

const REVIEW_THREADS_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $endCursor) {
        nodes {
          id
          isResolved
          path
          line
          originalLine
          comments(first: 100) {
            nodes {
              author { login }
              body
              url
              databaseId
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
`.trim();

export const readUnresolvedReviewThreads = Effect.fn(
  "ReviewThreads.readUnresolved"
)(function* readUnresolvedReviewThreads(
  github: Github["Service"],
  owner: string,
  name: string,
  number: number,
  cwd: string
) {
  const result = yield* github.execute(
    [
      "api",
      "graphql",
      "--paginate",
      "--slurp",
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `number=${number}`,
      "-f",
      `query=${REVIEW_THREADS_QUERY}`,
    ],
    { cwd }
  );
  const pages = yield* decodeJson(
    Schema.Array(ReviewThreadsPage),
    result.stdout,
    "review threads"
  );
  return pages
    .flatMap((page) => page.data.repository.pullRequest.reviewThreads.nodes)
    .filter((thread) => !thread.isResolved);
});
