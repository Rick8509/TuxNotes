<script lang="ts">
  // Edit Image…: rotate, flip and crop an image in a note. Nothing changes until Done;
  // then the edited image is added as a new attachment (Undo brings the original back).
  import { onMount, tick } from "svelte";
  import { Crop, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCwSquare, RotateCcwSquare } from "@lucide/svelte";
  import { api, errorText } from "../api";
  import {
    centeredCrop,
    clampCrop,
    drawTransformed,
    flip,
    isUnchanged,
    NO_EDITS,
    normalizeCrop,
    outputMime,
    outputSize,
    renderEdited,
    rotate,
    rotatedSize,
    sniffMime,
    type CropRect,
    type ImageEdits,
  } from "../imageEdit";

  interface Props {
    attachmentId: string;
    name: string;
    /** The edited image, ready to be added to the note. */
    onsave: (blob: Blob, mime: string) => Promise<void>;
    onclose: () => void;
  }
  let { attachmentId, name, onsave, onclose }: Props = $props();

  let image = $state<HTMLImageElement | null>(null);
  let mime = $state("image/png");
  let error = $state<string | null>(null);
  let edits = $state<ImageEdits>(NO_EDITS);
  let cropping = $state(false);
  /** Width / height locked while cropping (null: free). */
  let aspect = $state<number | null>(null);
  let saving = $state(false);
  let canvas = $state<HTMLCanvasElement>();
  let stage = $state<HTMLDivElement>();
  let stageW = $state(760);
  let stageH = $state(480);
  let dialogEl = $state<HTMLDivElement>();
  let objectUrl = "";

  const natural = $derived(image ? [image.naturalWidth, image.naturalHeight] : [1, 1]);
  const rotated = $derived(rotatedSize(natural[0], natural[1], edits.rotation));
  /** Preview size: the rotated image fitted into the stage. */
  const scale = $derived(Math.min(1, stageW / rotated[0], stageH / rotated[1]));
  const viewW = $derived(Math.max(1, Math.round(rotated[0] * scale)));
  const viewH = $derived(Math.max(1, Math.round(rotated[1] * scale)));
  const result = $derived(outputSize(natural[0], natural[1], { ...edits, crop: normalizeCrop(edits.crop) }));
  const changed = $derived(!isUnchanged({ ...edits, crop: normalizeCrop(edits.crop) }));
  const ASPECTS: { label: string; value: number | null }[] = [
    { label: "Free", value: null },
    { label: "Square", value: 1 },
    { label: "4:3", value: 4 / 3 },
    { label: "16:9", value: 16 / 9 },
    { label: "3:2", value: 3 / 2 },
  ];

  onMount(() => {
    dialogEl?.focus();
    void load();
    const measure = () => {
      if (!stage) return;
      stageW = Math.max(200, stage.clientWidth - 32);
      stageH = Math.max(160, stage.clientHeight - 32);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (stage) ro.observe(stage);
    return () => {
      ro.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  });

  async function load() {
    try {
      const bytes = new Uint8Array(await api.attachmentImage(attachmentId));
      mime = sniffMime(bytes);
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      image = img;
    } catch (e) {
      error = `Couldn't open the image: ${errorText(e)}`;
    }
  }

  // Draw the preview (rotated and flipped; the crop is shown on top).
  $effect(() => {
    const img = image;
    const c = canvas;
    if (!img || !c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(viewW * dpr);
    c.height = Math.round(viewH * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    drawTransformed(ctx, img, natural[0], natural[1], edits, scale * dpr);
  });

  function startCrop() {
    cropping = true;
    if (!edits.crop) edits = { ...edits, crop: aspect ? centeredCrop(aspect, rotated[0], rotated[1]) : { x: 0, y: 0, w: 1, h: 1 } };
  }

  function chooseAspect(value: number | null) {
    aspect = value;
    edits = { ...edits, crop: value ? centeredCrop(value, rotated[0], rotated[1]) : (edits.crop ?? { x: 0, y: 0, w: 1, h: 1 }) };
  }

  type Grip = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

  /** Drag the crop frame or one of its handles. */
  function drag(e: PointerEvent, grip: Grip) {
    if (!edits.crop || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const start: CropRect = { ...edits.crop };
    const [sx, sy] = [e.clientX, e.clientY];
    const pixelAspect = rotated[0] / rotated[1];
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / viewW;
      const dy = (ev.clientY - sy) / viewH;
      let { x, y, w, h } = start;
      if (grip === "move") {
        x += dx;
        y += dy;
      } else {
        if (grip.includes("w")) {
          x = start.x + dx;
          w = start.w - dx;
        }
        if (grip.includes("e")) w = start.w + dx;
        if (grip.includes("n")) {
          y = start.y + dy;
          h = start.h - dy;
        }
        if (grip.includes("s")) h = start.h + dy;
        // Keep the shape: the height follows the width.
        if (aspect) {
          h = (w * pixelAspect) / aspect;
          if (grip.includes("n")) y = start.y + start.h - h;
        }
        // Don't let it flip over or leave the image.
        w = Math.max(0.03, Math.min(w, grip.includes("w") ? start.x + start.w : 1 - x));
        h = Math.max(0.03, Math.min(h, grip.includes("n") ? start.y + start.h : 1 - y));
        if (grip.includes("w")) x = start.x + start.w - w;
        if (grip.includes("n")) y = start.y + start.h - h;
      }
      edits = { ...edits, crop: clampCrop({ x, y, w, h }) };
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  async function done() {
    if (!image || saving) return;
    if (!changed) return onclose();
    saving = true;
    await tick();
    try {
      const out = outputMime(mime);
      const blob = await renderEdited(image, natural[0], natural[1], { ...edits, crop: normalizeCrop(edits.crop) }, out);
      await onsave(blob, out);
    } catch (e) {
      error = errorText(e);
      saving = false;
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (cropping) cropping = false;
      else onclose();
    } else if (e.key === "Enter" && !(e.target as HTMLElement).closest("button")) {
      e.preventDefault();
      void done();
    }
  }

  const GRIPS: Grip[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" {onkeydown}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Edit Image" tabindex="-1" bind:this={dialogEl}>
    <header>
      <h2>Edit Image</h2>
      <span class="name" title={name}>{name}</span>
    </header>

    <div class="stage" bind:this={stage}>
      {#if error}
        <p class="error" role="alert">{error}</p>
      {:else if !image}
        <p class="muted">Opening the image…</p>
      {:else}
        <div class="view" style:width="{viewW}px" style:height="{viewH}px">
          <canvas bind:this={canvas} style:width="{viewW}px" style:height="{viewH}px" aria-label="Preview"></canvas>
          {#if edits.crop}
            {@const c = edits.crop}
            <div
              class="crop"
              class:active={cropping}
              style:left="{c.x * 100}%"
              style:top="{c.y * 100}%"
              style:width="{c.w * 100}%"
              style:height="{c.h * 100}%"
              onpointerdown={(e) => cropping && drag(e, "move")}
            >
              {#if cropping}
                <span class="third v1"></span><span class="third v2"></span><span class="third h1"></span><span class="third h2"></span>
                {#each GRIPS as g (g)}
                  {#if !aspect || g.length === 2}
                    <span class="grip {g}" onpointerdown={(e) => drag(e, g)}></span>
                  {/if}
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="tools" role="toolbar" aria-label="Edit">
      <button class="tool" title="Rotate left" aria-label="Rotate left" disabled={!image} onclick={() => (edits = rotate(edits, -1))}><RotateCcwSquare size={18} /></button>
      <button class="tool" title="Rotate right" aria-label="Rotate right" disabled={!image} onclick={() => (edits = rotate(edits, 1))}><RotateCwSquare size={18} /></button>
      <button class="tool" title="Flip left to right" aria-label="Flip horizontally" aria-pressed={edits.flipH} disabled={!image} onclick={() => (edits = flip(edits, "h"))}><FlipHorizontal2 size={18} /></button>
      <button class="tool" title="Flip top to bottom" aria-label="Flip vertically" aria-pressed={edits.flipV} disabled={!image} onclick={() => (edits = flip(edits, "v"))}><FlipVertical2 size={18} /></button>
      <span class="sep"></span>
      <button class="tool wide" class:on={cropping} aria-pressed={cropping} disabled={!image} onclick={() => (cropping ? (cropping = false) : startCrop())}>
        <Crop size={17} /> Crop
      </button>
      {#if cropping}
        <div class="aspects" role="radiogroup" aria-label="Crop shape">
          {#each ASPECTS as a (a.label)}
            <button role="radio" aria-checked={aspect === a.value} class:on={aspect === a.value} onclick={() => chooseAspect(a.value)}>{a.label}</button>
          {/each}
        </div>
      {/if}
      <span class="spacer"></span>
      <button class="tool wide" title="Undo all changes" disabled={!changed} onclick={() => ((edits = NO_EDITS), (cropping = false), (aspect = null))}>
        <RotateCcw size={15} /> Reset
      </button>
    </div>

    <footer>
      <span class="muted">
        {#if image}{result[0]} × {result[1]} pixels{/if}
        {#if mime === "image/gif" && changed} · Animated GIFs become still images.{/if}
      </span>
      <button class="btn" onclick={onclose}>Cancel</button>
      <button class="btn primary" disabled={!image || saving} onclick={done}>{saving ? "Saving…" : "Done"}</button>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.35);
  }
  .dialog {
    width: min(900px, calc(100% - 40px));
    height: min(680px, calc(100% - 40px));
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-lg);
    background: var(--bg-list);
    box-shadow: var(--shadow-pop);
    outline: none;
    overflow: hidden;
    animation: pop 0.14s ease-out;
  }
  @keyframes pop {
    from {
      opacity: 0;
      scale: 0.97;
    }
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 14px 18px 10px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  .name {
    color: var(--text-secondary);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stage {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    margin: 0 14px;
    border-radius: var(--radius-md);
    /* A checkerboard shows transparent parts. */
    background:
      repeating-conic-gradient(var(--bg-input) 0% 25%, transparent 0% 50%) 0 0 / 18px 18px,
      var(--bg-editor);
  }
  .view {
    position: relative;
    overflow: hidden;
    box-shadow: 0 1px 8px rgba(0, 0, 0, 0.25);
  }
  canvas {
    display: block;
  }
  .crop {
    position: absolute;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
    outline: 1px solid rgba(255, 255, 255, 0.7);
  }
  .crop.active {
    cursor: move;
    touch-action: none;
  }
  .third {
    position: absolute;
    background: rgba(255, 255, 255, 0.35);
    pointer-events: none;
  }
  .third.v1,
  .third.v2 {
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .third.v1 {
    left: 33.33%;
  }
  .third.v2 {
    left: 66.66%;
  }
  .third.h1,
  .third.h2 {
    left: 0;
    right: 0;
    height: 1px;
  }
  .third.h1 {
    top: 33.33%;
  }
  .third.h2 {
    top: 66.66%;
  }
  /* Corner brackets and edge bars, drawn inside the frame so they're never cut off. */
  .grip {
    position: absolute;
    width: 22px;
    height: 22px;
    touch-action: none;
    border: 0 solid #fff;
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.6));
  }
  .grip.nw { left: -1px; top: -1px; border-width: 4px 0 0 4px; cursor: nwse-resize; }
  .grip.ne { right: -1px; top: -1px; border-width: 4px 4px 0 0; cursor: nesw-resize; }
  .grip.se { right: -1px; bottom: -1px; border-width: 0 4px 4px 0; cursor: nwse-resize; }
  .grip.sw { left: -1px; bottom: -1px; border-width: 0 0 4px 4px; cursor: nesw-resize; }
  .grip.n,
  .grip.s { left: 50%; width: 28px; height: 14px; margin-left: -14px; cursor: ns-resize; }
  .grip.n { top: -1px; border-top-width: 4px; }
  .grip.s { bottom: -1px; border-bottom-width: 4px; }
  .grip.e,
  .grip.w { top: 50%; width: 14px; height: 28px; margin-top: -14px; cursor: ew-resize; }
  .grip.e { right: -1px; border-right-width: 4px; }
  .grip.w { left: -1px; border-left-width: 4px; }

  .tools {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 14px;
    flex-wrap: wrap;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 32px;
    min-width: 34px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    color: var(--text);
  }
  .tool:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .tool.on,
  .tool[aria-pressed="true"] {
    background: var(--bg-active);
    color: var(--accent-strong);
  }
  .tool:disabled {
    opacity: 0.4;
  }
  .sep {
    width: 1px;
    height: 20px;
    margin: 0 6px;
    background: var(--separator-strong);
  }
  .spacer {
    flex: 1;
  }
  .aspects {
    display: flex;
    gap: 2px;
    margin-left: 6px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--bg-input);
  }
  .aspects button {
    padding: 4px 9px;
    border-radius: 5px;
    font-size: 12px;
  }
  .aspects button.on {
    background: var(--bg-list);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px 14px;
    border-top: 1px solid var(--separator);
  }
  footer .muted {
    flex: 1;
    font-size: 12px;
  }
  .muted {
    color: var(--text-secondary);
  }
  .error {
    color: var(--danger);
    padding: 0 20px;
    text-align: center;
  }
  .btn {
    padding: 6px 16px;
    border-radius: var(--radius-sm);
    background: var(--bg-input);
    font-weight: 500;
  }
  .btn:hover:not(:disabled) {
    background: var(--bg-active);
  }
  .btn.primary {
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--accent-strong);
  }
  .btn:disabled {
    opacity: 0.5;
  }
</style>
