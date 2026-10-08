import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import type { Tool } from "@opencode/schema/tool";
import { Context, Effect, Layer } from "effect";

import { readRegularFile } from "./bounded-file.js";
import { ClassificationError } from "./errors.js";
import { imageMime } from "./image-format.js";
import {
  IMAGE_RESOLUTION_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_TOTAL_IMAGE_BYTES,
} from "./limits.js";
import { OpenCodeAccess } from "./opencode-access.js";
import type { EvidenceImage, ResolvedImage } from "./types.js";

const unreadable = () =>
  new ClassificationError(
    "EVIDENCE_ERROR",
    "Image evidence could not be read. Check permissions, file sizes, and supported static PNG, JPEG, or WebP containers."
  );
const changed = () =>
  new ClassificationError(
    "EVIDENCE_ERROR",
    "Image evidence changed while being read or authorized."
  );
const io = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ catch: unreadable, try: operation });

export class ImageEvidence extends Context.Service<
  ImageEvidence,
  {
    resolve: (
      images: readonly EvidenceImage[],
      context: Tool.Context
    ) => Effect.Effect<readonly ResolvedImage[], ClassificationError>;
  }
>()("classify/ImageEvidence") {}

export const ImageEvidenceLive = Layer.effect(
  ImageEvidence,
  Effect.gen(function* buildImageEvidence() {
    const access = yield* OpenCodeAccess;
    const readImage = Effect.fn("ImageEvidence.readImage")(function* readImage(
      directory: string,
      image: EvidenceImage,
      budget: number,
      context: Tool.Context
    ) {
      const requested = path.resolve(directory, image.path);
      const canonical = yield* io(() => realpath(requested));
      const handle = yield* Effect.acquireRelease(
        io(() =>
          open(
            canonical,
            constants.O_RDONLY + constants.O_NOFOLLOW + constants.O_NONBLOCK
          )
        ),
        (opened) => io(() => opened.close()).pipe(Effect.orDie)
      );
      const identity = yield* io(() => handle.stat()).pipe(
        Effect.uninterruptible
      );
      if (!identity.isFile() || identity.size > budget) {
        return yield* unreadable();
      }
      const verify = Effect.fn("ImageEvidence.verifyIdentity")(
        function* verify() {
          const resolved = yield* io(() => realpath(requested));
          const current = yield* io(() => lstat(canonical));
          const descriptor = yield* io(() => handle.stat()).pipe(
            Effect.uninterruptible
          );
          if (
            resolved !== canonical ||
            !current.isFile() ||
            current.dev !== identity.dev ||
            current.ino !== identity.ino ||
            descriptor.size !== identity.size ||
            descriptor.mtimeMs !== identity.mtimeMs ||
            descriptor.ctimeMs !== identity.ctimeMs
          ) {
            return yield* changed();
          }
        }
      );
      yield* verify();
      yield* access
        .readFile(canonical, context)
        .pipe(Effect.mapError(unreadable));
      yield* verify();
      // Descriptor operations finish before scoped release, including the helper's initial stat.
      const bytes = yield* readRegularFile(handle, budget, unreadable).pipe(
        Effect.uninterruptible
      );
      yield* verify();
      const mime = imageMime(bytes);
      if (!mime) {
        return yield* unreadable();
      }
      return {
        byteLength: bytes.length,
        dataURL: `data:${mime};base64,${bytes.toString("base64")}`,
        mime,
      };
    }, Effect.scoped);
    const resolve = Effect.fn("ImageEvidence.resolve")(
      function* resolve(
        images: readonly EvidenceImage[],
        context: Tool.Context
      ) {
        if (images.length === 0 || images.length > MAX_IMAGES) {
          return yield* unreadable();
        }
        const directory = yield* access
          .directory(context)
          .pipe(Effect.mapError(unreadable));
        const result: ResolvedImage[] = [];
        let remaining = MAX_TOTAL_IMAGE_BYTES;
        for (const image of images) {
          const resolved = yield* readImage(
            directory,
            image,
            Math.min(MAX_IMAGE_BYTES, remaining),
            context
          );
          remaining -= resolved.byteLength;
          result.push(resolved);
        }
        return result;
      },
      Effect.timeoutOrElse({
        duration: IMAGE_RESOLUTION_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(
            new ClassificationError(
              "TIMEOUT",
              "Image evidence resolution exceeded its deadline."
            )
          ),
      })
    );
    return ImageEvidence.of({ resolve });
  })
);
