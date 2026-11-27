import { describe, expect, it } from "vitest";
import {
  centeredCrop,
  clampCrop,
  flip,
  isUnchanged,
  NO_EDITS,
  normalizeCrop,
  outputMime,
  outputName,
  outputSize,
  rotate,
  sniffMime,
  type ImageEdits,
} from "./imageEdit";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("image edits", () => {
  it("rotates by quarter turns both ways", () => {
    let e: ImageEdits = NO_EDITS;
    e = rotate(e, 1);
    expect(e.rotation).toBe(90);
    e = rotate(rotate(rotate(e, 1), 1), 1);
    expect(e.rotation).toBe(0);
    expect(rotate(NO_EDITS, -1).rotation).toBe(270);
    expect(isUnchanged(rotate(rotate(NO_EDITS, 1), -1))).toBe(true);
  });

  it("swaps width and height when turned a quarter", () => {
    expect(outputSize(400, 300, NO_EDITS)).toEqual([400, 300]);
    expect(outputSize(400, 300, rotate(NO_EDITS, 1))).toEqual([300, 400]);
    expect(outputSize(400, 300, rotate(rotate(NO_EDITS, 1), 1))).toEqual([400, 300]);
  });

  it("crops to a fraction of the (turned) image", () => {
    const e = { ...NO_EDITS, crop: { x: 0.25, y: 0.5, w: 0.5, h: 0.5 } };
    expect(outputSize(400, 300, e)).toEqual([200, 150]);
    // The crop turns with the image: four quarter turns bring it back.
    let r: ImageEdits = e;
    for (let i = 0; i < 4; i++) r = rotate(r, 1);
    expect(r.crop).toEqual(e.crop);
    // Right then left is a no-op too.
    expect(rotate(rotate(e, 1), -1).crop).toEqual(e.crop);
    // Turned right, the top-left area moves to the top-right.
    const topLeft = { ...NO_EDITS, crop: { x: 0, y: 0, w: 0.5, h: 0.25 } };
    const turned = rotate(topLeft, 1).crop!;
    expect([turned.x, turned.y, turned.w, turned.h]).toEqual([0.75, 0, 0.25, 0.5]);
  });

  it("flips, and flipping twice undoes it", () => {
    const e = { ...NO_EDITS, crop: { x: 0, y: 0, w: 0.25, h: 0.5 } };
    const h = flip(e, "h");
    expect(h.flipH).toBe(true);
    expect(close(h.crop!.x, 0.75)).toBe(true);
    expect(flip(h, "h")).toEqual(e);
    expect(flip(flip(NO_EDITS, "v"), "v")).toEqual(NO_EDITS);
    // A mirrored image turned a quarter is mirrored the other way.
    const turned = rotate(flip(NO_EDITS, "h"), 1);
    expect([turned.flipH, turned.flipV]).toEqual([false, true]);
  });

  it("makes the largest centred crop for an aspect ratio", () => {
    expect(centeredCrop(1, 400, 200)).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    expect(centeredCrop(1, 200, 400)).toEqual({ x: 0, y: 0.25, w: 1, h: 0.5 });
    const c = centeredCrop(16 / 9, 400, 300);
    expect(close((c.w * 400) / (c.h * 300), 16 / 9)).toBe(true);
  });

  it("keeps crops inside the image and treats a full crop as none", () => {
    expect(clampCrop({ x: -0.2, y: 0.9, w: 0.5, h: 0.5 })).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 });
    expect(clampCrop({ x: 0, y: 0, w: 0, h: 2 }).w).toBeGreaterThan(0);
    expect(normalizeCrop({ x: 0, y: 0, w: 1, h: 1 })).toBeNull();
    expect(normalizeCrop({ x: 0.1, y: 0, w: 0.9, h: 1 })).not.toBeNull();
  });

  it("knows image types and what they're saved as", () => {
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe("image/png");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
    expect(sniffMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(outputMime("image/jpeg")).toBe("image/jpeg");
    expect(outputMime("image/gif")).toBe("image/png");
    expect(outputMime("image/avif")).toBe("image/png");
    expect(outputName("photo.jpg", "image/jpeg")).toBe("photo.jpg");
    expect(outputName("photo.JPEG", "image/jpeg")).toBe("photo.JPEG");
    expect(outputName("anim.gif", "image/png")).toBe("anim.png");
    expect(outputName("screenshot", "image/png")).toBe("screenshot.png");
  });
});
