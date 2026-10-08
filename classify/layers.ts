import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import type { Plugin } from "@opencode/plugin/effect";
import { Layer } from "effect";

import { classificationLayer } from "./classification.js";
import type { BackendOptions, ClassifyOptions } from "./config.js";
import { CredentialsLive } from "./credentials.js";
import { EvidenceAccessLive } from "./evidence.js";
import { HttpClientLive } from "./http-client.js";
import { ImageEvidenceLive } from "./image-evidence.js";
import { openCodeAccessLayer } from "./opencode-access.js";
import { providerLayer } from "./providers/registry.js";
import { SearchFilesLive } from "./search-discovery.js";
import { fileSearchLayer } from "./search.js";

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
) => {
  const access = openCodeAccessLayer(context);
  const decision = backendLayer(options, backend);
  const evidence = EvidenceAccessLive.pipe(
    Layer.provide(Layer.merge(access, processLayer))
  );
  const discovery = SearchFilesLive.pipe(Layer.provide(access));
  const images = ImageEvidenceLive.pipe(Layer.provide(access));
  const dependencies = Layer.mergeAll(decision, evidence, images);
  const classification = classificationLayer(options).pipe(
    Layer.provide(dependencies)
  );
  const searchDependencies = Layer.mergeAll(
    classification,
    decision,
    evidence,
    discovery
  );
  const search = fileSearchLayer(options.search).pipe(
    Layer.provide(searchDependencies)
  );
  return Layer.merge(classification, search);
};
