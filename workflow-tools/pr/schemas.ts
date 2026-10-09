/* oxlint-disable eslint/no-redeclare typescript/no-empty-interface typescript/no-empty-object-type -- Effect schemas intentionally share their name with the inferred domain interface. */
import { Effect, Schema } from "effect";

import { GithubDecodeError } from "./errors.js";

export const PrMetadata = Schema.Struct({
  baseRefName: Schema.String,
  headRefName: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
});
export interface PrMetadata extends Schema.Schema.Type<typeof PrMetadata> {}

const GhUser = Schema.Struct({ login: Schema.optionalKey(Schema.String) });

export const PrCheckIdentity = Schema.Struct({
  headRefOid: Schema.NonEmptyString,
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  url: Schema.NonEmptyString,
});
export interface PrCheckIdentity extends Schema.Schema.Type<
  typeof PrCheckIdentity
> {}

export const RepoView = Schema.Struct({ nameWithOwner: Schema.String });

export const ReviewThread = Schema.Struct({
  comments: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        author: Schema.optionalKey(Schema.NullOr(GhUser)),
        body: Schema.String,
        databaseId: Schema.NullOr(Schema.Number),
        url: Schema.String,
      })
    ),
  }),
  id: Schema.String,
  isResolved: Schema.Boolean,
  line: Schema.NullOr(Schema.Number),
  originalLine: Schema.NullOr(Schema.Number),
  path: Schema.String,
});
export interface ReviewThread extends Schema.Schema.Type<typeof ReviewThread> {}

export const ReviewThreadsPage = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({
      pullRequest: Schema.Struct({
        reviewThreads: Schema.Struct({ nodes: Schema.Array(ReviewThread) }),
      }),
    }),
  }),
});

export const PullRequestCheck = Schema.Struct({
  bucket: Schema.String,
  completedAt: Schema.String,
  description: Schema.String,
  event: Schema.String,
  link: Schema.String,
  name: Schema.String,
  startedAt: Schema.String,
  state: Schema.String,
  workflow: Schema.String,
});
export interface PullRequestCheck extends Schema.Schema.Type<
  typeof PullRequestCheck
> {}

export const decodeJson = <A, I>(
  schema: Schema.Codec<A, I>,
  text: string,
  description: string
): Effect.Effect<A, GithubDecodeError> =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text).pipe(
    Effect.mapError(
      (cause) =>
        new GithubDecodeError({
          cause,
          description,
          message: `gh returned invalid JSON for ${description}`,
        })
    )
  );
