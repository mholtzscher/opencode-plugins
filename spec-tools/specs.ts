import { readdir } from "node:fs/promises";
import path from "node:path";

const unquote = (value: string): string =>
  (value.startsWith('"') && value.endsWith('"')) ||
  (value.startsWith("'") && value.endsWith("'"))
    ? value.slice(1, -1)
    : value;

/** Accept filenames, specs/ paths, and OpenCode @ references to direct spec files. */
export const resolveSpecPath = async (
  cwd: string,
  input: string
): Promise<string> => {
  const value = unquote(input.trim());
  const reference = unquote(value.startsWith("@") ? value.slice(1) : value);
  const name = reference.startsWith("specs/") ? reference.slice(6) : reference;
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error(
      "Choose a direct file under specs/, for example @specs/auth.md"
    );
  }
  const entries = await readdir(path.join(cwd, "specs"), {
    withFileTypes: true,
  });
  if (!entries.some((entry) => entry.name === name && entry.isFile())) {
    throw new Error(`Specification not found: specs/${name}`);
  }
  return `specs/${name}`;
};
