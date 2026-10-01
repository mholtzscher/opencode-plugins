import { MAX_BYTES, MAX_JSON_DEPTH } from "../limits.js";
import { ClassificationError } from "../types.js";
import type { Content, JsonValue } from "../types.js";

const DEFAULT_LIMITS = { maxBytes: MAX_BYTES, maxDepth: MAX_JSON_DEPTH };
type JsonContainer = JsonValue[] | { [key: string]: JsonValue };
type JsonVisitor = (item: unknown, depth: number) => item is JsonValue;

export const invalid = (
  path = "",
  message = "Input does not satisfy the classification contract."
): never => {
  throw new ClassificationError("INVALID_INPUT", message, false, { path });
};

export const record = (
  value: JsonValue | undefined,
  path = ""
): Record<string, JsonValue> => {
  if (
    value === null ||
    value === undefined ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    return invalid(path, "Expected a JSON object.");
  }
  // SAFETY: The prototype check rejects primitives, arrays, and non-JSON instances; boundedJson verifies every property value before callers inspect the record.
  return value as Record<string, JsonValue>;
};

export const fields = (
  value: Record<string, JsonValue>,
  allowed: readonly string[],
  path = ""
): void => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    invalid(path, "Object contains unsupported fields.");
  }
};

export const nonblank = (value: JsonValue | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

// Validate before cloning or serializing, so cycles, accessors and excessive depth
// cannot reach JSON.stringify. The byte budget also bounds wide traversals.
export const boundedJson = (
  value: unknown,
  limits: { maxBytes: number; maxDepth: number } = DEFAULT_LIMITS
): value is JsonValue => {
  const ancestors = new Set<object>();
  let budget = 0;
  const visitContainer = (
    item: JsonContainer,
    depth: number,
    visit: JsonVisitor
  ): void => {
    if (ancestors.has(item) || Object.getOwnPropertySymbols(item).length > 0) {
      invalid();
    }
    ancestors.add(item);
    budget += 2;
    if (Array.isArray(item)) {
      if (Object.getOwnPropertyNames(item).length !== item.length + 1) {
        invalid();
      }
      budget += Math.max(0, item.length - 1);
      for (let i = 0; i < item.length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        if (!(descriptor?.enumerable && "value" in descriptor)) {
          return invalid("", "Input must contain JSON values, not accessors.");
        }
        visit(descriptor.value, depth + 1);
      }
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        invalid();
      }
      budget += Math.max(0, Object.keys(item).length - 1);
      for (const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(item)
      )) {
        if (!(descriptor.enumerable && "value" in descriptor)) {
          invalid();
        }
        budget += Buffer.byteLength(JSON.stringify(key)) + 1;
        visit(descriptor.value, depth + 1);
      }
    }
    ancestors.delete(item);
  };
  const visit = (item: unknown, depth: number): item is JsonValue => {
    if (depth > limits.maxDepth) {
      invalid();
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
      typeof item === "object" &&
      item !== null
    ) {
      // SAFETY: The container branch checked the runtime object representation; visitContainer validates its array or plain-object prototype and all members.
      visitContainer(item as JsonContainer, depth, visit);
    } else {
      return invalid();
    }
    if (budget > limits.maxBytes) {
      invalid();
    }
    return true;
  };
  return visit(value, 0);
};

export const isBoundedJsonValue = (
  candidate: unknown,
  limits: { maxBytes: number; maxDepth: number } = DEFAULT_LIMITS
): candidate is JsonValue => {
  try {
    return boundedJson(candidate, limits);
  } catch {
    return false;
  }
};

export const content = (value: JsonValue | undefined, path = ""): Content => {
  if (nonblank(value)) {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value;
  }
  if (
    value !== null &&
    value !== undefined &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    const objectValue = record(value, path);
    if (Object.keys(objectValue).length > 0) {
      return objectValue;
    }
  }
  return invalid(
    path,
    "Expected a nonblank string, nonempty JSON object, or nonempty JSON array."
  );
};

export const exactKeys = (
  value: Record<string, JsonValue>,
  keys: string[]
): void => {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    invalid();
  }
};
