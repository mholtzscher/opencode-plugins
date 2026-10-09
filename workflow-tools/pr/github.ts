import { NodeServices } from "@effect/platform-node";
import { Context, Effect, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { GithubError } from "./errors.js";

export interface ExecuteOptions {
  readonly cwd: string;
  readonly timeout?: number;
  readonly acceptedCodes?: readonly number[];
}

export class Github extends Context.Service<
  Github,
  {
    readonly execute: (
      args: readonly string[],
      options: ExecuteOptions
    ) => Effect.Effect<{ stdout: string; stderr: string }, GithubError>;
  }
>()("workflow-tools/Github") {}

export const GithubLayer = Layer.effect(
  Github,
  Effect.gen(function* githubLayer() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const execute = Effect.fn("Github.execute")(
      function* execute(args: readonly string[], options: ExecuteOptions) {
        const operation = `gh ${args.join(" ")}`;
        const handle = yield* spawner.spawn(
          ChildProcess.make("gh", [...args], {
            cwd: options.cwd,
            env: { GH_PAGER: "cat", PAGER: "cat" },
            extendEnv: true,
            forceKillAfter: "5 seconds",
            stdin: "ignore",
          })
        );
        const collect = (stream: typeof handle.stdout) =>
          stream.pipe(
            Stream.decodeText(),
            Stream.runFoldEffect(
              () => ({ bytes: 0, text: "" }),
              (state, chunk) => {
                const bytes = state.bytes + Buffer.byteLength(chunk);
                return bytes > 12 * 1024 * 1024
                  ? Effect.fail(
                      new GithubError({
                        message: "gh output exceeded 12 MiB",
                        operation,
                      })
                    )
                  : Effect.succeed({ bytes, text: state.text + chunk });
              }
            ),
            Effect.map((result) => result.text)
          );
        const [stdout, stderr, code] = yield* Effect.all(
          [collect(handle.stdout), collect(handle.stderr), handle.exitCode],
          { concurrency: 3 }
        );
        if (!(options.acceptedCodes ?? [0]).includes(code)) {
          return yield* Effect.fail(
            new GithubError({
              message:
                stderr.trim() || `${operation} failed with exit code ${code}`,
              operation,
            })
          );
        }
        return { stderr, stdout };
      },
      (effect, args, options) =>
        effect.pipe(
          Effect.scoped,
          Effect.timeout(options.timeout ?? 60_000),
          Effect.mapError((cause) =>
            cause instanceof GithubError
              ? cause
              : new GithubError({
                  cause,
                  message: `${cause}`,
                  operation: `gh ${args.join(" ")}`,
                })
          )
        )
    );
    return Github.of({ execute });
  })
);

export const GithubLive = GithubLayer.pipe(Layer.provide(NodeServices.layer));
