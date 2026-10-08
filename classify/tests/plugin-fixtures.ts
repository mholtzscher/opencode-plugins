import type {
  CommandDefinition,
  CommandEditor,
} from "@opencode/plugin/effect/command";
import type { RpcHandlers } from "@opencode/plugin/effect/rpc";
import type { ToolEditor } from "@opencode/plugin/effect/tool";
import type { Tool } from "@opencode/schema/tool";
import type { Schema } from "effect";
import { Effect, Exit, Scope } from "effect";

import plugin from "../index.js";
import type { ClassifyBackends, SelectionSchema } from "../rpc.js";
import type { JsonValue } from "../types.js";

type PluginContext = Parameters<typeof plugin.effect>[0];

interface PluginRuntime {
  directory: string;
  sessionDirectory?: string;
  sessionRequests?: Tool.Context["sessionID"][];
  tools: Tool.Info[];
  disposed?: () => void;
  commands?: CommandDefinition[];
  handlers?: (handlers: RpcHandlers<typeof ClassifyBackends>) => void;
  messages?: string[];
  events?: unknown[];
  emit?: (
    selection: typeof SelectionSchema.Type
  ) => Effect.Effect<void, unknown>;
  stored?: Map<string, Schema.Json>;
  namespaces?: Tool.Namespace[];
}

/** Each test file owns its registrations and explicitly installs dispose as its cleanup hook. */
export const createPluginFixture = () => {
  const scopes: Scope.Closeable[] = [];
  const dispose = () =>
    Effect.runPromise(
      Effect.forEach(scopes.splice(0), (scope) => Scope.close(scope, Exit.void))
    );
  const register = async (
    options: JsonValue,
    runtime?: PluginRuntime
  ): Promise<Tool.Info[]> => {
    const tools: Tool.Info[] = [];
    const stored = runtime?.stored ?? new Map<string, Schema.Json>();
    // SAFETY: The test editor implements the add and namespace methods used by plugin.effect.
    const editor = {
      add(tool: Tool.Info) {
        tools.push(tool);
      },
      namespace(value: Tool.Namespace) {
        runtime?.namespaces?.push(value);
      },
    } as ToolEditor;
    const contextFixture = {
      command: {
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Host command registration uses an editor callback.
        transform: (callback: (editor: CommandEditor) => void) =>
          Effect.sync(() => {
            // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Invoke the host registration contract.
            callback({
              add: (command) => {
                runtime?.commands?.push(command);
              },
            });
          }),
      },
      location: { directory: runtime?.directory },
      options,
      rpc: {
        register: (
          _definition: typeof ClassifyBackends,
          handlers: RpcHandlers<typeof ClassifyBackends>
        ) =>
          Effect.sync(() => {
            runtime?.handlers?.(handlers);
            return {
              events: {
                emit: (_name: string, value: typeof SelectionSchema.Type) =>
                  runtime?.emit?.(value) ??
                  Effect.sync(() => {
                    runtime?.events?.push(value);
                  }),
              },
            };
          }),
      },
      session: {
        get: (input: { sessionID: Tool.Context["sessionID"] }) =>
          Effect.sync(() => {
            runtime?.sessionRequests?.push(input.sessionID);
            return {
              location: {
                directory: runtime?.sessionDirectory ?? runtime?.directory,
              },
            };
          }),
        synthetic: ({ text }: { text: string }) =>
          Effect.sync(() => {
            runtime?.messages?.push(text);
          }),
      },
      storage: {
        get: (key: string) => Effect.sync(() => stored.get(key)),
        remove: (key: string) =>
          Effect.sync(() => {
            stored.delete(key);
          }),
        set: (key: string, value: Schema.Json) =>
          Effect.sync(() => {
            stored.set(key, value);
          }),
      },
      tool: {
        list: () =>
          Effect.succeed(
            (runtime?.tools ?? []).map((tool) => ({ ...tool, id: tool.name }))
          ),
        // OpenCode's transform contract is callback-based and this plugin registers synchronously inside it.
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Preserve the host transform callback semantics in the fixture.
        transform: (callback: (editor: ToolEditor) => void) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              // oxlint-disable-next-line promise/prefer-await-to-callbacks -- The API requires invoking this registration callback.
              callback(editor);
              return {
                dispose: Effect.sync(() => {
                  runtime?.disposed?.();
                  tools.splice(0);
                }),
              };
            }),
            (registration) => registration.dispose
          ),
      },
    };
    // SAFETY: The fixture implements the options, session.get, and tool.list/transform members exercised by setup and the registered executor; unused host APIs are outside this test's contract.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The partial host fixture requires a TypeScript bridge at this test-only boundary.
    const context = contextFixture as unknown as PluginContext;
    const scope = await Effect.runPromise(Scope.make());
    scopes.push(scope);
    await Effect.runPromise(plugin.effect(context).pipe(Scope.provide(scope)));
    return tools;
  };
  return { dispose, register, scopes };
};
