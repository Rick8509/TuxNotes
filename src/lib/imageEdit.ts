// Simple image edits for images in notes: rotate, flip and crop (Edit Image… and the
// quick Rotate items). The original attachment is never changed: the edited image is
// added as a new attachment and the note points at it (so Undo brings the old one back).

export type Rotation = 0 | 90 | 180 | 270;

/** Part of the (rotated and flipped) image, as fractions of its width and height. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageEdits {
  /** Clockwise. */
  rotation: Rotation;
  /** Mirrored left–right / top–bottom, as seen after rotating. */
  flipH: boolean;
  flipV: boolean;
  crop: CropRect | null;
}

export const NO_EDITS: ImageEdits = { rotation: 0, flipH: false, flipV: false, crop: null };

/** Smallest crop, as a fraction of the image. */
export const MIN_CROP = 0.03;

export const isUnchanged = (e: ImageEdits) => e.rotation === 0 && !e.flipH && !e.flipV && !e.crop;

/** Width and height after rotating. */
export function rotatedSize(width: number, height: number, rotation: Rotation): [number, number] {
  return rotation % 180 ? [height, width] : [width, height];
}

/** Pixel size of the result. */
export function outputSize(width: number, height: number, edits: ImageEdits): [number, number] {
  const [w, h] = rotatedSize(width, height, edits.rotation);
  if (!edits.crop) return [w, h];
  return [Math.max(1, Math.round(w * edits.crop.w)), Math.max(1, Math.round(h * edits.crop.h))];
}

/** Turn 90° right (1) or left (-1); the crop turns with the image. */
export function rotate(edits: ImageEdits, direction: 1 | -1): ImageEdits {
  const rotation = (((edits.rotation + direction * 90) % 360) + 360) % 360 as Rotation;
  let crop = edits.crop;
  if (crop) {
    crop =
      direction === 1
        ? { x: 1 - (crop.y + crop.h), y: crop.x, w: crop.h, h: crop.w }
        : { x: crop.y, y: 1 - (crop.x + crop.w), w: crop.h, h: crop.w };
  }
  // Turning a mirrored image swaps which way it's mirrored.
  return edits.flipH !== edits.flipV
    ? { rotation, flipH: edits.flipV, flipV: edits.flipH, crop }
    : { ...edits, rotation, crop };
}

/** Mirror left–right ("h") or top–bottom ("v"); the crop mirrors too. */
export function flip(edits: ImageEdits, axis: "h" | "v"): ImageEdits {
  const crop = edits.crop && (axis === "h" ? { ...edits.crop, x: 1 - (edits.crop.x + edits.crop.w) } : { ...edits.crop, y: 1 - (edits.crop.y + edits.crop.h) });
  return axis === "h" ? { ...edits, flipH: !edits.flipH, crop } : { ...edits, flipV: !edits.flipV, crop };
}

/**
 * The largest centred crop with this aspect ratio (width / height in pixels) for an image
 * of `imageW` × `imageH` pixels (after rotating).
 */
export function centeredCrop(aspect: number, imageW: number, imageH: number): CropRect {
  const imageAspect = imageW / imageH;
  const [w, h] = aspect > imageAspect ? [1, imageAspect / aspect] : [aspect / imageAspect, 1];
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** Keep a crop inside the image and not too small. */
export function clampCrop(c: CropRect): CropRect {
  const w = Math.min(1, Math.max(MIN_CROP, c.w));
  const h = Math.min(1, Math.max(MIN_CROP, c.h));
  return { x: Math.min(1 - w, Math.max(0, c.x)), y: Math.min(1 - h, Math.max(0, c.y)), w, h };
}

/** A crop covering (almost) everything is no crop. */
export function normalizeCrop(c: CropRect | null): CropRect | null {
  if (!c) return null;
  return c.x < 0.002 && c.y < 0.002 && c.w > 0.996 && c.h > 0.996 ? null : c;
}

/** Image type from its first bytes. */
export function sniffMime(bytes: Uint8Array): string {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x42, 0x4d)) return "image/bmp";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "image/avif";
  return "application/octet-stream";
}

/** What the edited image is saved as: PNG, JPEG and WebP stay; others become PNG. */
export function outputMime(inputMime: string): "image/png" | "image/jpeg" | "image/webp" {
  return inputMime === "image/jpeg" || inputMime === "image/webp" ? inputMime : "image/png";
}

/** "photo.jpg" → "photo.jpg"; "anim.gif" saved as PNG → "anim.png". */
export function outputName(filename: string, mime: string): string {
  const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
  const base = filename.replace(/\.[^./]+$/, "") || "image";
  const current = /\.([^./]+)$/.exec(filename)?.[1]?.toLowerCase();
  const sameType = current && (current === ext || (ext === "jpg" && current === "jpeg"));
  return sameType ? filename : `${base}.${ext}`;
}

/** Draw the image rotated and flipped (no crop) onto a canvas of the rotated size. */
export function drawTransformed(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
  edits: ImageEdits,
  scale = 1,
) {
  const [rw, rh] = rotatedSize(width, height, edits.rotation);
  ctx.save();
  ctx.translate((rw * scale) / 2, (rh * scale) / 2);
  ctx.scale(edits.flipH ? -1 : 1, edits.flipV ? -1 : 1);
  ctx.rotate((edits.rotation * Math.PI) / 180);
  ctx.drawImage(image, (-width * scale) / 2, (-height * scale) / 2, width * scale, height * scale);
  ctx.restore();
}

/** The edited image as a file's bytes. */
export async function renderEdited(image: CanvasImageSource, width: number, height: number, edits: ImageEdits, mime: string): Promise<Blob> {
  const [rw, rh] = rotatedSize(width, height, edits.rotation);
  const full = document.createElement("canvas");
  full.width = rw;
  full.height = rh;
  const ctx = full.getContext("2d");
  if (!ctx) throw new Error("Couldn't edit the image (no drawing surface).");
  // JPEG has no transparency: keep transparent parts white, not black.
  if (mime === "image/jpeg") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rw, rh);
  }
  drawTransformed(ctx, image, width, height, edits);
  let result = full;
  if (edits.crop) {
    const [cw, ch] = outputSize(width, height, edits);
    result = document.createElement("canvas");
    result.width = cw;
    result.height = ch;
    result.getContext("2d")!.drawImage(full, Math.round(edits.crop.x * rw), Math.round(edits.crop.y * rh), cw, ch, 0, 0, cw, ch);
  }
  return new Promise((resolve, reject) =>
    result.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't save the edited image."))), mime, 0.92),
  );
}
