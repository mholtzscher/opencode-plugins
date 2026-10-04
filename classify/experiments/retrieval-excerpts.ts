import type { SearchFile } from "../search-schemas.js";

// Frozen for this comparison; helper token usage is diagnostic on local Ollama.
export const excerptPolicy = {
  candidateStrideLines: 200,
  candidateWindowLines: 240,
  maxCandidateBytes: 16 * 1024,
  minRelevance: 0.5,
  strideLines: 40,
  version: 2,
  windowLines: 80,
};

/** Cover every selected line, with overlap so nearby evidence can cross a boundary. */
export const evidenceWindows = (
  file: SearchFile,
  size: { strideLines: number; windowLines: number } = excerptPolicy
): SearchFile[] => {
  const lines = file.content.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  if (lines.length <= size.windowLines) {
    return [file];
  }
  const windows: SearchFile[] = [];
  for (let offset = 0; offset < lines.length; offset += size.strideLines) {
    const end = Math.min(offset + size.windowLines, lines.length);
    windows.push({
      content: lines.slice(offset, end).join(""),
      endLine: file.startLine + end - 1,
      partial: true,
      path: file.path,
      startLine: file.startLine + offset,
    });
    if (end === lines.length) {
      break;
    }
  }
  return windows;
};

/** Keep large-file discovery exhaustive without sending an oversized full file to Ollama. */
export const candidateWindows = (file: SearchFile): SearchFile[] => {
  if (Buffer.byteLength(file.content) <= excerptPolicy.maxCandidateBytes) {
    return [file];
  }
  let windows = evidenceWindows(file, {
    strideLines: excerptPolicy.candidateStrideLines,
    windowLines: excerptPolicy.candidateWindowLines,
  });
  if (
    windows.some(
      (window) =>
        Buffer.byteLength(window.content) > excerptPolicy.maxCandidateBytes
    )
  ) {
    windows = evidenceWindows(file);
  }
  if (
    windows.some(
      (window) =>
        Buffer.byteLength(window.content) > excerptPolicy.maxCandidateBytes
    )
  ) {
    throw new Error(
      `Candidate window exceeds the experimental input ceiling: ${file.path}`
    );
  }
  return windows;
};

/** One reference per selected file, preserving all accepted regions and the intervening lines. */
export const encloseEvidence = (
  file: SearchFile,
  accepted: readonly SearchFile[]
): SearchFile => {
  if (accepted.length === 0) {
    // A failed narrowing judgment must not discard a file accepted by the full-file pass.
    return file;
  }
  const startLine = Math.min(...accepted.map((window) => window.startLine));
  const endLine = Math.max(...accepted.map((window) => window.endLine));
  const lines = file.content.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  return {
    content: lines
      .slice(startLine - file.startLine, endLine - file.startLine + 1)
      .join(""),
    endLine,
    partial:
      file.partial || startLine > file.startLine || endLine < file.endLine,
    path: file.path,
    startLine,
  };
};
