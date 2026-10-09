export const truncate = (text: string, maxChars: number): string =>
  text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} characters]`;

export const escapeDelimiters = (text: string, tag: string): string =>
  text
    .replaceAll(`<${tag}>`, `\\u003c${tag}\\u003e`)
    .replaceAll(`</${tag}>`, `\\u003c/${tag}\\u003e`);
