// The note content model: every node and mark a note can contain. Shared by the
// editor and the Markdown converter so both always agree.

import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { FileNode, ImageNode } from "./attachmentNodes";
import { CodeBlock } from "./codeBlock";

/**
 * The note document. `firstLine` records how a note's first line looks, chosen by
 * "New notes start with" when the note was created: "heading" or "body". No value means
 * a title (the default, and every note from before this setting was per note).
 */
const NoteDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "block+",
  addAttributes() {
    return { firstLine: { default: null, rendered: false } };
  },
  renderMarkdown: (node, h) => (node.content ? h.renderChildren(node.content, "\n\n") : ""),
});

/**
 * Images in Markdown files (the Files window's formatted view): kept exactly as written,
 * shown as a small chip (the Files window only reads files that were opened, so it doesn't
 * load the picture).
 */
export const MarkdownImage = Node.create({
  name: "image",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { src: { default: "" }, alt: { default: "" }, title: { default: null } };
  },
  parseHTML() {
    return [{ tag: "span[data-md-image]", getAttrs: (el) => ({ src: el.getAttribute("data-src") ?? "", alt: el.getAttribute("data-alt") ?? "" }) }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const { src, alt } = node.attrs as { src: string; alt: string };
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "md-image", "data-md-image": "", "data-src": src, "data-alt": alt, title: src }),
      `🖼 ${alt || src.split("/").pop() || "image"}`,
    ];
  },
  markdownTokenName: "image",
  parseMarkdown: (token) => ({ type: "image", attrs: { src: token.href ?? "", alt: token.text ?? "", title: token.title ?? null } }),
  renderMarkdown: (node) => {
    const { src, alt, title } = node.attrs as { src: string; alt: string; title: string | null };
    return `![${alt.replace(/([\\[\]])/g, "\\$1")}](${src}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})`;
  },
});

/**
 * The content of notes. With `markdownFile`, the variant for Markdown files in the Files
 * window: six heading levels, images as MarkdownImage, no attachments, and no empty line
 * kept at the end (it would change the file).
 */
export function contentExtensions(options: { markdownFile?: boolean } = {}) {
  const md = !!options.markdownFile;
  return [
    NoteDocument,
    StarterKit.configure({
      document: false,
      heading: { levels: md ? [1, 2, 3, 4, 5, 6] : [1, 2, 3] },
      ...(md ? { trailingNode: false } : {}),
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        // No red underlines in web addresses or code.
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow", spellcheck: "false" },
      },
      code: { HTMLAttributes: { spellcheck: "false" } },
      // Replaced by CodeBlock (syntax colours, language picker, Copy).
      codeBlock: false,
    }),
    CodeBlock,
    TaskList,
    TaskItem.configure({ nested: true }),
    // Tab / Shift+Tab move between cells; Tab in the last cell adds a row.
    TableKit.configure({ table: { resizable: true, cellMinWidth: 60 } }),
    ...(md ? [MarkdownImage] : [ImageNode, FileNode]),
  ];
}
