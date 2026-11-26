// Editor nodes for attachments. Notes store only the attachment id; the file itself is
// loaded through attachmentUrl() (the `attachment://` protocol in the app).

import { Node, mergeAttributes } from "@tiptap/core";
import { attachmentUrl } from "../attachmentUrls";
import { formatBytes } from "../format";
import type { Attachment } from "../types";
import { IMAGE_MIMES } from "../types";

/** Sizes images snap to while resizing (percent of the note's width). */
export const IMAGE_SIZES = [25, 50, 75, 100];
/** Smallest image width while resizing, in pixels. */
const MIN_IMAGE_PX = 48;

/** "50" → 50; anything outside 5–100 → null (natural size). */
export function parseImageWidth(value: unknown): number | null {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 5 && n <= 100 ? n : null;
}

/**
 * An image shown inline: at its natural size (full width at most), or at `width` percent
 * of the note's width when resized (drag the corner handle, or right-click → a size).
 */
export const ImageNode = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-attachment-id"),
        renderHTML: (attrs) => ({ "data-attachment-id": attrs.attachmentId, src: attachmentUrl(attrs.attachmentId) }),
      },
      alt: {
        default: null,
        parseHTML: (el) => el.getAttribute("alt"),
        renderHTML: (attrs) => (attrs.alt ? { alt: attrs.alt } : {}),
      },
      width: {
        default: null,
        parseHTML: (el) => parseImageWidth(el.getAttribute("data-width")),
        renderHTML: (attrs) => (attrs.width ? { "data-width": String(attrs.width), style: `width: ${attrs.width}%` } : {}),
      },
    };
  },

  // In the editor: the image in a frame with a resize handle (bottom-right corner).
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement("div");
      dom.className = "note-image-frame";
      const img = document.createElement("img");
      img.className = "note-image";
      img.draggable = false;
      const handle = document.createElement("span");
      handle.className = "note-image-handle";
      handle.title = "Drag to resize";
      const badge = document.createElement("span");
      badge.className = "note-image-badge";
      dom.append(img, handle, badge);

      const show = (n: typeof node) => {
        const id = n.attrs.attachmentId as string | null;
        const url = attachmentUrl(id);
        if (img.getAttribute("src") !== url) img.src = url;
        img.alt = (n.attrs.alt as string | null) ?? "";
        dom.dataset.attachmentId = id ?? "";
        const width = parseImageWidth(n.attrs.width);
        dom.style.width = width ? `${width}%` : "";
        dom.classList.toggle("sized", width !== null);
      };
      show(node);

      handle.addEventListener("pointerdown", (down) => {
        if (!editor.isEditable || down.button !== 0) return;
        down.preventDefault();
        down.stopPropagation();
        handle.setPointerCapture(down.pointerId);
        const container = dom.parentElement?.clientWidth || dom.getBoundingClientRect().width;
        const left = dom.getBoundingClientRect().left;
        let width: number | null = null;
        const move = (e: PointerEvent) => {
          const px = Math.max(MIN_IMAGE_PX, e.clientX - left);
          let pct = Math.min(100, (px / container) * 100);
          const snap = IMAGE_SIZES.find((s) => Math.abs(s - pct) < 2.5);
          pct = Math.max(5, Math.round(snap ?? pct));
          width = pct;
          dom.style.width = `${pct}%`;
          dom.classList.add("sized", "resizing");
          badge.textContent = pct === 100 ? "Full width" : `${pct}%`;
        };
        const done = () => {
          handle.removeEventListener("pointermove", move);
          dom.classList.remove("resizing");
          const pos = getPos();
          if (width === null || typeof pos !== "number") return show(current);
          const attrs = { ...current.attrs, width };
          editor
            .chain()
            .command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, attrs);
              return true;
            })
            .setNodeSelection(pos)
            .focus()
            .run();
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", done, { once: true });
        handle.addEventListener("pointercancel", done, { once: true });
      });

      return {
        dom,
        update: (n) => {
          if (n.type !== current.type) return false;
          current = n;
          show(n);
          return true;
        },
        // The handle is ours: ProseMirror shouldn't select or drag on it.
        stopEvent: (e) => e.target === handle,
        ignoreMutation: () => true,
      };
    };
  },

  // Only our own images (e.g. copied between notes). Images pasted from web pages point
  // at remote addresses and are left out, for privacy and so notes work offline.
  parseHTML() {
    return [{ tag: "img[data-attachment-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes({ class: "note-image", draggable: "true" }, HTMLAttributes)];
  },

  // Markdown: exported as ![alt](attachment:<id>) (the exporter rewrites that to a file path).
  // Imported images keep their source in `src` until the importer turns them into attachments.
  markdownTokenName: "image",
  parseMarkdown: (token) => ({ type: "image", attrs: { src: token.href ?? "", alt: token.text || null } }),
  renderMarkdown: (node) => `![${escapeMd((node.attrs?.alt as string) ?? "")}](attachment:${node.attrs?.attachmentId})`,
});

/** Escape characters that would end Markdown link text early. */
function escapeMd(s: string): string {
  return s.replace(/([\\[\]])/g, "\\$1");
}

/** Short label for the file icon, e.g. "PDF". */
export function fileBadge(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1) : "";
  return ext && ext.length <= 4 ? ext.toUpperCase() : "FILE";
}

/** Any other file: a compact chip with type, name and size. Double-click opens it. */
export const FileNode = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    const data = (name: string, parse: (v: string | null) => unknown = (v) => v) => ({
      parseHTML: (el: HTMLElement) => parse(el.getAttribute(`data-${name}`)),
      renderHTML: (attrs: Record<string, unknown>) => ({ [`data-${name}`]: String(attrs[camel(name)] ?? "") }),
    });
    return {
      attachmentId: { default: null, ...data("attachment-id") },
      filename: { default: "file", ...data("filename") },
      size: { default: 0, ...data("size", (v) => Number(v) || 0) },
      mime: { default: "", ...data("mime") },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-attachment-id][data-filename]" }];
  },

  // Markdown: a link to the file (the exporter rewrites attachment:<id> to a file path).
  renderMarkdown: (node) => `[📎 ${escapeMd((node.attrs?.filename as string) ?? "file")}](attachment:${node.attrs?.attachmentId})`,

  renderHTML({ node, HTMLAttributes }) {
    const { filename, size } = node.attrs as { filename: string; size: number };
    return [
      "div",
      mergeAttributes({ class: "note-file", title: `${filename} — double-click to open` }, HTMLAttributes),
      ["span", { class: "note-file-icon" }, fileBadge(filename)],
      ["span", { class: "note-file-text" }, ["span", { class: "note-file-name" }, filename], ["span", { class: "note-file-size" }, formatBytes(size)]],
    ];
  },
});

function camel(name: string): string {
  return name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}

/** The editor node to insert for a newly added attachment. */
export function nodeForAttachment(a: Attachment) {
  return IMAGE_MIMES.includes(a.mime)
    ? { type: "image", attrs: { attachmentId: a.id, alt: a.filename } }
    : { type: "attachment", attrs: { attachmentId: a.id, filename: a.filename, size: a.size, mime: a.mime } };
}
