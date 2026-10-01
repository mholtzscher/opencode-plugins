import { MAX_BYTES, MAX_JSON_DEPTH } from "../limits.js";
import { ClassificationError, type Content } from "../types.js";

export function invalid(
  path = "",
  message = "Input does not satisfy the classification contract."
): never {
  throw new ClassificationError("INVALID_INPUT", message, false, { path });
}
export function record(value: unknown, path = ""): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    return invalid(path, "Expected a JSON object.");
  }
  return value as Record<string, unknown>;
}
export function fields(
  value: Record<string, unknown>,
  allowed: string[],
  path = ""
) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    invalid(path, "Object contains unsupported fields.");
  }
}
export function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Validate before cloning or serializing, so cycles, accessors and excessive depth
// cannot reach JSON.stringify. The byte budget also bounds wide traversals.
export function boundedJson(
  value: unknown,
  limits = { maxBytes: MAX_BYTES, maxDepth: MAX_JSON_DEPTH }
): void {
  const ancestors = new Set<object>();
  let budget = 0;
  const visitArray = (item: unknown[], depth: number): void => {
    if (Object.getOwnPropertyNames(item).length !== item.length + 1) {
      invalid();
    }
    budget += Math.max(0, item.length - 1);
    for (let i = 0; i < item.length; i += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
      if (!(descriptor?.enumerable && "value" in descriptor)) {
        throw new ClassificationError(
          "INVALID_INPUT",
          "Input must contain JSON values, not accessors."
        );
      }
      visit(descriptor.value, depth + 1);
    }
  };
  const visitObject = (item: object, depth: number): void => {
    if (ancestors.has(item) || Object.getOwnPropertySymbols(item).length > 0) {
      invalid();
    }
    ancestors.add(item);
    budget += 2;
    if (Array.isArray(item)) {
      visitArray(item, depth);
    } else {
      record(item);
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
  const visit = (item: unknown, depth: number): void => {
    if (depth > limits.maxDepth) {
      invalid();
    }
    if (item === null || typeof item === "boolean") {
      budget += String(item).length;
    } else if (typeof item === "string") {
      budget += Buffer.byteLength(JSON.stringify(item));
    } else if (typeof item === "number" && Number.isFinite(item)) {
      budget += String(item).length;
    } else if (typeof item === "object" && item !== null) {
      visitObject(item, depth);
    } else {
      invalid();
    }
    if (budget > limits.maxBytes) {
      invalid();
    }
  };
  visit(value, 0);
}
export function content(value: unknown, path = ""): Content {
  if (nonblank(value)) {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value as Content;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    Object.keys(record(value)).length > 0
  ) {
    return value as Content;
  }
  return invalid(
    path,
    "Expected a nonblank string, nonempty JSON object, or nonempty JSON array."
  );
}
export function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    invalid();
  }
}
