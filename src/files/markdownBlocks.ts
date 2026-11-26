// Markdown files shown as a formatted page (Files window) without rewriting them.
//
// Opening: the file is split into its top-level blocks (marked's lexer: each token's
// `raw` is the exact original text, and all of them together are the whole file); each
// block becomes editor nodes. Saving: the edited page is lined up with the original
// blocks; a block whose nodes are all still there, unchanged and in order, is written back
// as its original text, byte for byte. Only new or edited blocks are written fresh. So
// opening and saving changes nothing, and fixing a typo changes only that paragraph.

import { getSchema, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Schema } from "@tiptap/pm/model";
import { marked } from "marked";
import { contentExtensions } from "../lib/editor/content";

/** A top-level piece of the file: its original text and the nodes it became (none for
 *  blank lines, link definitions and anything the page can't show). */
export interface Segment {
  raw: string;
  nodes: JSONContent[];
}

export interface MarkdownPage {
  /** YAML front matter ("---" … "---" at the very top), kept as it is and not shown. */
  frontMatter: string;
  segments: Segment[];
  /** The nodes for the editor. */
  doc: JSONContent;
}

let manager: MarkdownManager | null = null;
let schema: Schema | null = null;
const md = () => (manager ??= new MarkdownManager({ extensions: contentExtensions({ markdownFile: true }) }));
const getSchemaCached = () => (schema ??= getSchema(contentExtensions({ markdownFile: true })));

/** Nodes in the form the editor reports them (attribute defaults filled in, text joined),
 *  so unchanged blocks compare equal. */
function normalize(node: JSONContent): JSONContent | null {
  try {
    return getSchemaCached().nodeFromJSON(node).toJSON() as JSONContent;
  } catch {
    return null;
  }
}

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/;

export function parseMarkdownPage(text: string): MarkdownPage {
  const frontMatter = FRONT_MATTER.exec(text)?.[0] ?? "";
  const body = text.slice(frontMatter.length);
  const segments: Segment[] = [];
  for (const token of marked.lexer(body)) {
    if (!token.raw) continue;
    let nodes: JSONContent[] = [];
    if (token.type !== "space" && token.type !== "def") {
      const parsed = md().parse(token.raw) as JSONContent;
      nodes = (parsed.content ?? [])
        // A block's trailing blank line comes back as an empty paragraph: not content.
        .filter((n) => !(n.type === "paragraph" && !n.content?.length))
        .map(normalize)
        .filter((n): n is JSONContent => n !== null);
    }
    segments.push({ raw: token.raw, nodes });
  }
  const content = segments.flatMap((s) => s.nodes);
  return { frontMatter, segments, doc: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] } };
}

/** One block as Markdown, ending in a newline. */
function blockMarkdown(node: JSONContent): string {
  const text = md().serialize({ type: "doc", content: [node] } as never).replace(/\n{3,}/g, "\n\n").trim();
  return text ? `${text}\n` : "";
}

/** Matched pairs (original index → edited index): equal runs at both ends, then the
 *  longest common subsequence of what's left (small, as edits are usually local). */
function matchNodes(a: string[], b: string[]): Map<number, number> {
  const match = new Map<number, number>();
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    match.set(start, start);
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    match.set(endA, endB);
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) return match;
  if (n * m > 4_000_000) return match; // a huge rewrite: write the changed middle fresh
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[start + i] === b[start + j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[start + i] === b[start + j]) {
      match.set(start + i, start + j);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  return match;
}

/** The file's text for the edited page: original text for untouched blocks. */
export function serializeMarkdownPage(page: MarkdownPage, edited: JSONContent[]): string {
  const original: { seg: number; key: string }[] = [];
  page.segments.forEach((s, seg) => s.nodes.forEach((n) => original.push({ seg, key: JSON.stringify(n) })));
  const editedKeys = edited.map((n) => JSON.stringify(normalize(n) ?? n));
  const match = matchNodes(
    original.map((o) => o.key),
    editedKeys,
  );

  // A segment is intact when all its nodes are matched, one after another.
  const firstIndex: number[] = [];
  original.forEach((o, i) => firstIndex[o.seg] ??= i);
  const intact = page.segments.map((s, seg) => {
    if (!s.nodes.length) return false;
    const first = firstIndex[seg];
    const at = match.get(first);
    if (at === undefined) return false;
    return s.nodes.every((_, k) => match.get(first + k) === at + k);
  });
  // Edited index → the intact segment starting there.
  const startsSegment = new Map<number, number>();
  intact.forEach((ok, seg) => ok && startsSegment.set(match.get(firstIndex[seg])!, seg));

  let out = page.frontMatter;
  let lastSeg = -1;
  let afterNew = false;
  const written = new Set<number>();
  const separate = () => {
    if (!out || out.length === page.frontMatter.length) return;
    if (!out.endsWith("\n")) out += "\n";
    if (!out.endsWith("\n\n")) out += "\n";
  };
  /** Blank lines, link definitions etc. between the last written segment and `upTo`.
   *  Blank lines belong to the block before them: they go when that block was deleted. */
  const keepBetween = (upTo: number) => {
    for (let seg = lastSeg + 1; seg < upTo; seg++) {
      const s = page.segments[seg];
      if (s.nodes.length) continue;
      if (s.raw.trim() === "" && seg > 0 && !written.has(seg - 1)) continue;
      out += s.raw;
      written.add(seg);
    }
  };

  for (let j = 0; j < edited.length; ) {
    const seg = startsSegment.get(j);
    if (seg !== undefined && seg > lastSeg) {
      keepBetween(seg);
      if (afterNew) separate();
      out += page.segments[seg].raw;
      written.add(seg);
      lastSeg = seg;
      afterNew = false;
      j += page.segments[seg].nodes.length;
      // Its own blank lines (and link definitions) come right after it.
      while (lastSeg + 1 < page.segments.length && !page.segments[lastSeg + 1].nodes.length) {
        lastSeg++;
        out += page.segments[lastSeg].raw;
        written.add(lastSeg);
      }
    } else {
      const text = blockMarkdown(edited[j]);
      if (text) {
        separate();
        out += text;
        afterNew = true;
      }
      j++;
    }
  }
  keepBetween(page.segments.length);
  // The original last block is gone: don't leave its blank lines at the end.
  let lastBlock = page.segments.length - 1;
  while (lastBlock >= 0 && !page.segments[lastBlock].nodes.length) lastBlock--;
  if (lastBlock >= 0 && !written.has(lastBlock)) out = out.replace(/\n+$/, "\n");
  if (afterNew && !out.endsWith("\n")) out += "\n";
  return out;
}
