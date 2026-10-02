import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import type { Plugin } from "@opencode/plugin/effect";
import { Layer } from "effect";

import type { BackendOptions, ClassifyOptions } from "./config.js";
import { CredentialsLive } from "./credentials.js";
import { EvidenceAccessLive } from "./evidence.js";
import { HttpClientLive } from "./http-client.js";
import { openCodeAccessLayer } from "./opencode-access.js";
import { providerLayer } from "./providers/registry.js";
import { classificationLayer } from "./service.js";

export const processLayer = NodeChildProcessSpawner.layer.pipe(
  Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))
);

export const backendLayer = (
  options: ClassifyOptions,
  backend: BackendOptions
) =>
  providerLayer(options, backend).pipe(
    Layer.provide(Layer.merge(CredentialsLive, HttpClientLive))
  );

export const classifyLayer = (
  options: ClassifyOptions,
  backend: BackendOptions,
  context: Plugin.Context
) =>
  classificationLayer(options).pipe(
    Layer.provide(
      Layer.merge(
        backendLayer(options, backend),
        EvidenceAccessLive.pipe(
          Layer.provide(Layer.merge(openCodeAccessLayer(context), processLayer))
        )
      )
    )
  );
