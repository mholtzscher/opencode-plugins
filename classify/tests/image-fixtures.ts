import { crc32, deflateSync } from "node:zlib";

export const pngChunk = (kind: string, payload: Buffer): Buffer => {
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length);
  chunk.write(kind, 4, "ascii");
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
};

// One red RGBA pixel with valid compressed data and chunk CRCs.
export const pngBytes = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
  pngChunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
  pngChunk("IEND", Buffer.alloc(0)),
]);
export const webpBytes = Buffer.from(
  "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
  "base64"
);
export const losslessWebpBytes = Buffer.from(
  "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==",
  "base64"
);

const jpegSegment = (marker: number, payload: Buffer): Buffer => {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
};
// A complete one-pixel grayscale baseline JPEG. DC difference and AC EOB each use one zero bit.
export const jpegBytes = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  jpegSegment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
  jpegSegment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
  jpegSegment(
    0xc4,
    Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(15), Buffer.from([0])])
  ),
  jpegSegment(
    0xc4,
    Buffer.concat([Buffer.from([0x10, 1]), Buffer.alloc(15), Buffer.from([0])])
  ),
  jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
  Buffer.from([0x3f, 0xff, 0xd9]),
]);

/** Grow a real PNG to an exact size with a valid ancillary chunk, not trailing padding. */
export const pngAtSize = (size: number): Buffer =>
  Buffer.concat([
    pngBytes.subarray(0, -12),
    pngChunk("paDd", Buffer.alloc(size - pngBytes.length - 12)),
    pngBytes.subarray(-12),
  ]);

export const extendedWebp = (flags = 0): Buffer => {
  const header = Buffer.alloc(18);
  header.write("VP8X");
  header.writeUInt32LE(10, 4);
  header[8] = flags;
  const bytes = Buffer.concat([
    webpBytes.subarray(0, 12),
    header,
    webpBytes.subarray(12),
  ]);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  return bytes;
};
