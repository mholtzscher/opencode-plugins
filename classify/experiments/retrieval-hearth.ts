import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { RetrievalCase } from "./retrieval-corpus.js";
import { sourceTokens } from "./retrieval.js";

export const hearthRevision = "3af0bb48bd18b2ceb1de1d97f7470b80133b7961";

// Reviewed before running either strategy. No expected paths/ranges enter retrieval.
export const hearthCases: RetrievalCase[] = [
  {
    expected: [
      {
        endLine: 423,
        path: "internal/modules/devices/nats/device_fact_relay.go",
        startLine: 401,
      },
    ],
    id: "fact-ack-before-delete",
    query:
      "Where does the device fact outbox publisher verify the broker acknowledgement before deleting a pending fact?",
    rationale:
      "Publish, missing/wrong-stream acknowledgement checks, and deletion occur in that order.",
    terms: ["outbox", "acknowledgement"],
  },
  {
    expected: [
      {
        endLine: 358,
        path: "internal/modules/devices/nats/device_fact_relay.go",
        startLine: 346,
      },
      {
        endLine: 450,
        path: "internal/modules/devices/nats/device_fact_relay.go",
        startLine: 443,
      },
    ],
    id: "poison-outbox-prefix",
    query:
      "How does a poisoned outbox row allow older valid device facts to publish first, then stop the relay and fail readiness?",
    rationale:
      "The relay publishes the decoded prefix before returning poison, and recordFault clears active readiness.",
    terms: ["poison", "outbox"],
  },
  {
    expected: [
      {
        endLine: 355,
        path: "internal/modules/agent/service.go",
        startLine: 336,
      },
      {
        endLine: 567,
        path: "internal/modules/agent/service.go",
        startLine: 560,
      },
    ],
    id: "conversation-serialization",
    query:
      "How are simultaneous agent turns for the same conversation serialized, including cancellation while waiting for a turn?",
    rationale:
      "A per-conversation channel gates admission and the turn acquires it before loading history; evidence is beyond line 200 in a large file.",
    terms: ["conversation", "serialized"],
  },
  {
    expected: [
      {
        endLine: 254,
        path: "internal/modules/automations/conditions_evaluation.go",
        startLine: 239,
      },
      {
        endLine: 272,
        path: "internal/modules/automations/conditions_evaluation.go",
        startLine: 257,
      },
      {
        endLine: 286,
        path: "internal/modules/automations/conditions_evaluation.go",
        startLine: 276,
      },
    ],
    id: "unknown-condition-logic",
    query:
      "Where do automation conditions combine true, false, and unknown for all, any, and not without treating unknown as permission?",
    rationale:
      "Separate three-valued truth tables implement conjunction, disjunction, and negation.",
    terms: ["unknown", "condition"],
  },
  {
    expected: [
      {
        endLine: 55,
        path: "internal/adapters/zigbee2mqtt/topics.go",
        startLine: 38,
      },
      {
        endLine: 220,
        path: "internal/adapters/zigbee2mqtt/discovery.go",
        startLine: 210,
      },
    ],
    id: "mqtt-device-topic-validation",
    query:
      "How does Zigbee2MQTT distinguish device availability topics from state topics and reject invalid device names containing MQTT separators or wildcards?",
    rationale:
      "Routing and validation are in distinct files; wrappers alone do not expose the predicate.",
    terms: ["availability", "wildcards", "friendly"],
  },
  {
    expected: [
      {
        endLine: 108,
        path: "internal/adapters/ecowitt/conversion.go",
        startLine: 105,
      },
      {
        endLine: 134,
        path: "internal/adapters/ecowitt/conversion.go",
        startLine: 125,
      },
      {
        endLine: 176,
        path: "internal/adapters/ecowitt/conversion.go",
        startLine: 161,
      },
    ],
    id: "exact-weather-temperature",
    query:
      "Where are Ecowitt Fahrenheit readings converted to integer milli-Celsius with exact arithmetic and halves rounded away from zero?",
    rationale:
      "Rational conversion, rounding, and the envelope-checked call site are all needed.",
    terms: ["Fahrenheit", "rounded"],
  },
  {
    expected: [
      { endLine: 33, path: "internal/platform/db/db.go", startLine: 20 },
    ],
    id: "sqlite-connection-policy",
    query:
      "Where does opening the core SQLite database enable foreign keys, a busy timeout, WAL, and a single connection?",
    rationale:
      "The DSN enables all three pragmas and the pool is limited to one open connection.",
    terms: ["foreign_keys", "busy_timeout", "WAL"],
  },
  {
    expected: [],
    id: "absent-postgres-notifications",
    query:
      "Where does Hearth subscribe to PostgreSQL LISTEN/NOTIFY channels for database change notifications?",
    rationale:
      "The pinned Go corpus has no PostgreSQL or LISTEN/NOTIFY implementation.",
    terms: ["PostgreSQL", "LISTEN/NOTIFY"],
  },
];

const testDirectories = new Set([
  "testdata",
  "adaptertest",
  "dbtest",
  "natstest",
  "mosquittotest",
  "cmdtest",
]);
export const hearthSourcePath = (name: string) =>
  name.endsWith(".go") &&
  !name.endsWith("_test.go") &&
  !name.split("/").some((part) => testDirectories.has(part));

/** Export the exact committed corpus, including generated Go, without changing the checkout. */
export const prepareHearthCorpus = async (
  repository: string,
  directory: string
) => {
  const exec = promisify(execFile);
  const { stdout } = await exec(
    "git",
    ["ls-tree", "-r", "--name-only", hearthRevision],
    { cwd: repository }
  );
  const files = stdout.trim().split("\n").filter(hearthSourcePath).toSorted();
  if (files.length !== 411) {
    throw new Error(
      "Unexpected Hearth corpus inventory; review the pinned revision and scope"
    );
  }
  await mkdir(directory);
  const archive = path.join(path.dirname(directory), "hearth-corpus.tar");
  await exec(
    "git",
    [
      "archive",
      "--format=tar",
      `--output=${archive}`,
      hearthRevision,
      "--",
      ...files,
    ],
    { cwd: repository }
  );
  await exec("tar", ["-xf", archive, "-C", directory]);
  await rm(archive);
  const sources: Record<string, string> = {};
  const size = { bytes: 0, files: files.length, lines: 0, tokens: 0 };
  for (const name of files) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Hash and count one exported source at a time.
    const content = await readFile(path.join(directory, name));
    sources[name] = createHash("sha256").update(content).digest("hex");
    size.bytes += content.length;
    const text = content.toString("utf-8");
    size.lines += (text.match(/[^\n]*\n|[^\n]+$/gu) ?? []).length;
    size.tokens += sourceTokens(text);
  }
  return { revision: hearthRevision, size, sources };
};
