import type { ResolvedImage } from "./types.js";

// oxlint-disable eslint/no-bitwise -- Image container flags and dimensions are packed bit fields.

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const PNG_DEPTHS = new Map([
  [0, [1, 2, 4, 8, 16]],
  [2, [8, 16]],
  [3, [1, 2, 4, 8]],
  [4, [8, 16]],
  [6, [8, 16]],
]);

const pngHeader = (bytes: Buffer, offset: number, length: number): boolean =>
  length === 13 &&
  bytes.readUInt32BE(offset + 8) > 0 &&
  bytes.readUInt32BE(offset + 12) > 0 &&
  PNG_DEPTHS.get(bytes[offset + 17])?.includes(bytes[offset + 16]) === true &&
  bytes[offset + 18] === 0 &&
  bytes[offset + 19] === 0 &&
  bytes[offset + 20] <= 1;

// Container checks only. CRCs, compressed pixels, and full decoder validity belong to the provider.
const png = (bytes: Buffer): boolean => {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return false;
  }
  let offset = 8;
  let header = false;
  let data = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) {
      return false;
    }
    const kind = bytes.toString("latin1", offset + 4, offset + 8);
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/u.test(kind)) {
      return false;
    }
    if (!header) {
      if (kind !== "IHDR" || !pngHeader(bytes, offset, length)) {
        return false;
      }
      header = true;
    } else if (
      kind === "IHDR" ||
      kind === "acTL" ||
      kind === "fcTL" ||
      kind === "fdAT"
    ) {
      return false;
    }
    if (kind === "IDAT" && length > 0) {
      data = true;
    }
    if (kind === "IEND") {
      return length === 0 && data && offset + 12 === bytes.length;
    }
    offset += length + 12;
  }
  return false;
};

const jpegFrame = (bytes: Buffer, offset: number, length: number): boolean => {
  if (length < 8) {
    return false;
  }
  const components = bytes[offset + 7];
  return (
    components > 0 &&
    length === 8 + 3 * components &&
    [8, 12, 16].includes(bytes[offset + 2]) &&
    bytes.readUInt16BE(offset + 3) > 0 &&
    bytes.readUInt16BE(offset + 5) > 0
  );
};
const jpegScan = (bytes: Buffer, offset: number, length: number): boolean => {
  const components = bytes[offset + 2];
  return (
    length >= 6 &&
    components > 0 &&
    length === 6 + 2 * components &&
    offset + length < bytes.length - 1 &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9
  );
};

const jpeg = (bytes: Buffer): boolean => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return false;
  }
  let offset = 2;
  let frame = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return false;
    }
    while (bytes[offset] === 0xff) {
      offset += 1;
    }
    const marker = bytes[offset];
    offset += 1;
    if (
      offset + 2 > bytes.length ||
      marker === 0 ||
      marker === 0xd8 ||
      marker === 0xd9
    ) {
      return false;
    }
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || length > bytes.length - offset) {
      return false;
    }
    if (FRAME_MARKERS.has(marker)) {
      if (frame || !jpegFrame(bytes, offset, length)) {
        return false;
      }
      frame = true;
    }
    if (marker === 0xda) {
      return frame && jpegScan(bytes, offset, length);
    }
    offset += length;
  }
  return false;
};

const webpExtendedHeader = (
  bytes: Buffer,
  start: number,
  length: number
): boolean =>
  length === 10 &&
  (bytes[start] & 0xc3) === 0 &&
  bytes[start + 1] === 0 &&
  bytes[start + 2] === 0 &&
  bytes[start + 3] === 0;
const webpLossyHeader = (
  bytes: Buffer,
  start: number,
  length: number
): boolean =>
  length >= 10 &&
  (bytes[start] & 1) === 0 &&
  bytes.toString("hex", start + 3, start + 6) === "9d012a" &&
  (bytes.readUInt16LE(start + 6) & 0x3f_ff) > 0 &&
  (bytes.readUInt16LE(start + 8) & 0x3f_ff) > 0;
const webpLosslessHeader = (
  bytes: Buffer,
  start: number,
  length: number
): boolean =>
  length >= 5 && bytes[start] === 0x2f && (bytes[start + 4] & 0xe0) === 0;

const webp = (bytes: Buffer): boolean => {
  if (
    bytes.length < 20 ||
    bytes.toString("latin1", 0, 4) !== "RIFF" ||
    bytes.toString("latin1", 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) !== bytes.length - 8
  ) {
    return false;
  }
  let offset = 12;
  let image = false;
  let extended = false;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString("latin1", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length + (length % 2);
    if (end > bytes.length || kind === "ANIM" || kind === "ANMF") {
      return false;
    }
    if (kind === "VP8X") {
      if (
        extended ||
        offset !== 12 ||
        !webpExtendedHeader(bytes, start, length)
      ) {
        return false;
      }
      extended = true;
    } else if (kind === "VP8 ") {
      if (image || !webpLossyHeader(bytes, start, length)) {
        return false;
      }
      image = true;
    } else if (kind === "VP8L") {
      if (image || !webpLosslessHeader(bytes, start, length)) {
        return false;
      }
      image = true;
    }
    offset = end;
  }
  return image && offset === bytes.length;
};

/** Detect supported static image containers without decoding or allocating pixels. */
export const imageMime = (bytes: Buffer): ResolvedImage["mime"] | undefined => {
  if (png(bytes)) {
    return "image/png";
  }
  if (jpeg(bytes)) {
    return "image/jpeg";
  }
  if (webp(bytes)) {
    return "image/webp";
  }
  return undefined;
};
