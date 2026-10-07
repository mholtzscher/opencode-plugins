import { expect, test } from "bun:test";

import { imageMime } from "../image-format.js";
import { MAX_IMAGE_BYTES } from "../limits.js";
import {
  extendedWebp,
  jpegBytes,
  losslessWebpBytes,
  pngAtSize,
  pngBytes,
  pngChunk,
  webpBytes,
} from "./image-fixtures.js";

test("recognizes complete static PNG, baseline JPEG, lossy, lossless, and extended WebP containers", () => {
  for (const [bytes, mime] of [
    [pngBytes, "image/png"],
    [jpegBytes, "image/jpeg"],
    [webpBytes, "image/webp"],
    [losslessWebpBytes, "image/webp"],
    [extendedWebp(), "image/webp"],
    [pngAtSize(MAX_IMAGE_BYTES), "image/png"],
  ] as const) {
    expect(imageMime(bytes)).toBe(mime);
    for (const end of [0, 1, 8, 12, 20, bytes.length - 1]) {
      expect(imageMime(bytes.subarray(0, end))).toBeUndefined();
    }
  }
});

test("rejects unsupported, empty, signature-only, and animated containers", () => {
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from("GIF89a"),
    Buffer.from("<svg></svg>"),
    Buffer.from("%PDF-1.7"),
    Buffer.from("plain text"),
    pngBytes.subarray(0, 8),
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    Buffer.concat([
      pngBytes.subarray(0, 33),
      pngChunk("acTL", Buffer.alloc(8)),
      pngBytes.subarray(33),
    ]),
    Buffer.concat([
      pngBytes.subarray(0, 33),
      pngChunk("fcTL", Buffer.alloc(26)),
      pngBytes.subarray(33),
    ]),
    extendedWebp(2),
  ]) {
    expect(imageMime(bytes)).toBeUndefined();
  }
});

test("rejects malformed dimensions, headers, lengths, and RIFF sizes without reading out of bounds", () => {
  const cases: Buffer[] = [];
  for (const [source, offset, value] of [
    [pngBytes, 8, 0xff_ff_ff_ff],
    [pngBytes, 16, 0],
    [webpBytes, 4, 0xff_ff_ff_ff],
    [webpBytes, 16, 0xff_ff_ff_ff],
  ] as const) {
    const bytes = Buffer.from(source);
    bytes.writeUInt32BE(value, offset);
    cases.push(bytes);
  }
  const frameOffset = jpegBytes.indexOf(Buffer.from([0xff, 0xc0]));
  for (const offset of [frameOffset + 2, frameOffset + 5, frameOffset + 9]) {
    const bytes = Buffer.from(jpegBytes);
    bytes[offset] = 0;
    bytes[offset + 1] = 0;
    cases.push(bytes);
  }
  const hostileJpeg = Buffer.from(jpegBytes);
  hostileJpeg.writeUInt16BE(65_535, 4);
  cases.push(hostileJpeg);
  const badPng = Buffer.from(pngBytes);
  badPng[26] = 1;
  cases.push(badPng);
  const badWebp = Buffer.from(webpBytes);
  badWebp[23] = 0;
  cases.push(badWebp);
  const animatedChunk = Buffer.from(webpBytes);
  animatedChunk.write("ANMF", 12);
  cases.push(animatedChunk);
  const nonAsciiPng = Buffer.from(pngBytes);
  nonAsciiPng[12] += 128;
  cases.push(nonAsciiPng);
  const nonAsciiRiff = Buffer.from(webpBytes);
  nonAsciiRiff[0] += 128;
  cases.push(nonAsciiRiff);
  for (const bytes of cases) {
    expect(imageMime(bytes)).toBeUndefined();
  }
  for (let length = 0; length < 100; length += 1) {
    expect(imageMime(Buffer.alloc(length, 0xff))).toBeUndefined();
  }
});
