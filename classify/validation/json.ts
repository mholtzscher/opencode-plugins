import { Effect } from "effect";

import { ClassificationError } from "../errors.js";
import { MAX_BYTES, MAX_JSON_DEPTH } from "../limits.js";
import type { JsonValue } from "../types.js";

interface JsonLimits {
  maxBytes: number;
  maxDepth: number;
}
// Unverified until visitContainer checks its prototype and members.
type JsonContainer = JsonValue[] | { [key: string]: JsonValue };
const DEFAULT_LIMITS: JsonLimits = {
  maxBytes: MAX_BYTES,
  maxDepth: MAX_JSON_DEPTH,
};

// Validate before cloning or serializing, so cycles, accessors and excessive depth
// cannot reach JSON.stringify. The byte budget also bounds wide traversals.
export const isBoundedJsonValue = (
  candidate: unknown,
  limits: JsonLimits = DEFAULT_LIMITS
): candidate is JsonValue => {
  const ancestors = new Set<object>();
  let budget = 0;
  const visitMembers = (
    item: JsonContainer,
    keys: readonly string[],
    depth: number
  ): boolean => {
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!(descriptor?.enumerable && "value" in descriptor)) {
        return false;
      }
      // oxlint-disable-next-line eslint/no-use-before-define -- Mutual recursion between containers and values.
      if (!visit(descriptor.value, depth + 1)) {
        return false;
      }
    }
    return true;
  };
  const visitContainer = (item: JsonContainer, depth: number): boolean => {
    if (ancestors.has(item) || Object.getOwnPropertySymbols(item).length > 0) {
      return false;
    }
    ancestors.add(item);
    budget += 2;
    let valid: boolean;
    if (Array.isArray(item)) {
      budget += Math.max(0, item.length - 1);
      if (
        budget > limits.maxBytes ||
        Object.getOwnPropertyNames(item).length !== item.length + 1
      ) {
        return false;
      }
      valid = true;
      for (let index = 0; index < item.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (
          !(descriptor?.enumerable && "value" in descriptor) ||
          // oxlint-disable-next-line eslint/no-use-before-define -- Mutual recursion between containers and values.
          !visit(descriptor.value, depth + 1)
        ) {
          valid = false;
          break;
        }
      }
    } else {
      const prototype = Object.getPrototypeOf(item);
      const keys = Object.getOwnPropertyNames(item);
      budget += Math.max(0, keys.length - 1);
      for (const key of keys) {
        budget += Buffer.byteLength(JSON.stringify(key)) + 1;
      }
      valid =
        (prototype === Object.prototype || prototype === null) &&
        visitMembers(item, keys, depth);
    }
    ancestors.delete(item);
    return valid;
  };
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This traversal is the JSON parser for untrusted values.
  const visit = (item: unknown, depth: number): boolean => {
    if (depth > limits.maxDepth) {
      return false;
    }
    if (item === null || item === true || item === false) {
      budget += String(item).length;
    } else if (
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- JSON strings must be distinguished before their encoded byte size can be counted.
      typeof item === "string"
    ) {
      budget += Buffer.byteLength(JSON.stringify(item));
    } else if (
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- JSON numbers must be distinguished and checked finite before accepting the value.
      typeof item === "number" &&
      Number.isFinite(item)
    ) {
      budget += String(item).length;
    } else if (
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Traversal must distinguish JSON containers from functions and other non-JSON values.
      typeof item !== "object" ||
      // SAFETY: visitContainer verifies the array or plain-object prototype before reading members.
      !visitContainer(item as JsonContainer, depth)
    ) {
      return false;
    }
    return budget <= limits.maxBytes;
  };
  return visit(candidate, 0);
};

/** Fails with the generic input error when a value exceeds the JSON request bounds. */
export const requireBoundedJson = <A>(
  value: A
): Effect.Effect<void, ClassificationError> =>
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- Typed payloads still need the runtime size and depth bound.
  isBoundedJsonValue(value)
    ? Effect.void
    : Effect.fail(
        new ClassificationError(
          "INVALID_INPUT",
          "Input does not satisfy the classification contract.",
          false,
          { path: "" }
        )
      );
