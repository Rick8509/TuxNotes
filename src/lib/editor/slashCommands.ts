// Slash commands: type "/" in a note to insert a block or other content from a menu.
// This file has the commands, the matching used to filter them, and the TipTap extension
// that notices "/" (via @tiptap/suggestion). The menu itself is SlashMenu.svelte.

import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey, type EditorState } from "@tiptap/pm/state";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import {
  CalendarClock,
  CalendarDays,
  Clock,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  SeparatorHorizontal,
  SquareCode,
  Table,
  TextQuote,
} from "@lucide/svelte";
import type { Component } from "svelte";
import { insertTable, isInTable } from "../tableMenu";

/** Things a command needs from the editor screen (pickers and forms live there). */
export interface SlashContext {
  /** Pick images or files and insert them. */
  attach: () => void;
  /** Open the link form (same as Ctrl+K). */
  link: () => void;
}

export interface SlashCommand {
  id: string;
  title: string;
  description: string;
  group: "Text" | "Lists" | "Insert" | "Date and time";
  icon: Component;
  /** Other words people may type to find it. */
  keywords: string[];
  /** The faster way to get the same result, shown on the right (shortcut or Markdown). */
  hint?: string;
  /** Hidden when it can't be used where the cursor is. */
  available?: (editor: Editor) => boolean;
  run: (editor: Editor, ctx: SlashContext) => void;
}

const chain = (editor: Editor) => editor.chain().focus();
const insertText = (editor: Editor, text: string) => chain(editor).insertContent(text).run();

const dateText = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, opts).format(new Date());

export const SLASH_COMMANDS: SlashCommand[] = [
  // ------------------------------------------------------------------ Text
  {
    id: "body",
    title: "Body",
    description: "Plain text",
    group: "Text",
    icon: Pilcrow,
    keywords: ["text", "paragraph", "normal", "plain", "p"],
    hint: "Ctrl+Shift+B",
    run: (e) => chain(e).setParagraph().run(),
  },
  {
    id: "title",
    title: "Title",
    description: "The biggest heading",
    group: "Text",
    icon: Heading1,
    keywords: ["h1", "heading 1", "big", "large"],
    hint: "#",
    run: (e) => chain(e).setHeading({ level: 1 }).run(),
  },
  {
    id: "heading",
    title: "Heading",
    description: "A section heading",
    group: "Text",
    icon: Heading2,
    keywords: ["h2", "heading 2", "section"],
    hint: "##",
    run: (e) => chain(e).setHeading({ level: 2 }).run(),
  },
  {
    id: "subheading",
    title: "Subheading",
    description: "A smaller heading",
    group: "Text",
    icon: Heading3,
    keywords: ["h3", "heading 3", "small heading"],
    hint: "###",
    run: (e) => chain(e).setHeading({ level: 3 }).run(),
  },
  {
    id: "code",
    title: "Code Block",
    description: "Code in colour, or text that should line up",
    group: "Text",
    icon: SquareCode,
    keywords: ["code", "monospaced", "pre", "snippet", "mono", "terminal", "programming"],
    hint: "```",
    run: (e) => chain(e).setCodeBlock().run(),
  },
  {
    id: "quote",
    title: "Quote",
    description: "Set text apart as a quotation",
    group: "Text",
    icon: TextQuote,
    keywords: ["blockquote", "citation", "cite"],
    hint: ">",
    run: (e) => chain(e).setBlockquote().run(),
  },
  // ----------------------------------------------------------------- Lists
  {
    id: "checklist",
    title: "Checklist",
    description: "Items you can tick off",
    group: "Lists",
    icon: ListChecks,
    keywords: ["todo", "to-do", "to do", "task", "tasks", "checkbox", "tick", "check list"],
    hint: "[ ]",
    run: (e) => chain(e).toggleTaskList().run(),
  },
  {
    id: "bullets",
    title: "Bulleted List",
    description: "A simple list",
    group: "Lists",
    icon: List,
    keywords: ["bullet", "bullets", "unordered", "ul", "points"],
    hint: "-",
    run: (e) => chain(e).toggleBulletList().run(),
  },
  {
    id: "numbers",
    title: "Numbered List",
    description: "A list with numbers",
    group: "Lists",
    icon: ListOrdered,
    keywords: ["numbered", "ordered", "ol", "steps", "1."],
    hint: "1.",
    run: (e) => chain(e).toggleOrderedList().run(),
  },
  // ---------------------------------------------------------------- Insert
  {
    id: "table",
    title: "Table",
    description: "Rows and columns",
    group: "Insert",
    icon: Table,
    keywords: ["grid", "rows", "columns", "spreadsheet", "cells"],
    available: (e) => !isInTable(e),
    run: (e) => insertTable(e),
  },
  {
    id: "attach",
    title: "Image or File",
    description: "Add a picture, PDF or any file",
    group: "Insert",
    icon: ImagePlus,
    keywords: ["image", "picture", "photo", "screenshot", "file", "attachment", "attach", "upload", "pdf", "img"],
    run: (_e, ctx) => ctx.attach(),
  },
  {
    id: "link",
    title: "Link",
    description: "A web page or email address",
    group: "Insert",
    icon: Link,
    keywords: ["url", "web", "website", "href", "email", "address"],
    hint: "Ctrl+K",
    run: (_e, ctx) => ctx.link(),
  },
  {
    id: "divider",
    title: "Divider",
    description: "A line between sections",
    group: "Insert",
    icon: SeparatorHorizontal,
    keywords: ["line", "separator", "rule", "hr", "horizontal", "break"],
    hint: "---",
    available: (e) => !isInTable(e),
    run: (e) => chain(e).setHorizontalRule().run(),
  },
  // --------------------------------------------------------- Date and time
  {
    id: "date",
    title: "Today's Date",
    description: "Insert today's date",
    group: "Date and time",
    icon: CalendarDays,
    keywords: ["date", "today", "day", "now"],
    run: (e) => insertText(e, dateText({ dateStyle: "long" })),
  },
  {
    id: "time",
    title: "Current Time",
    description: "Insert the time right now",
    group: "Date and time",
    icon: Clock,
    keywords: ["time", "now", "clock", "hour"],
    run: (e) => insertText(e, dateText({ timeStyle: "short" })),
  },
  {
    id: "datetime",
    title: "Date and Time",
    description: "Insert today's date and the time",
    group: "Date and time",
    icon: CalendarClock,
    keywords: ["timestamp", "now", "date", "time", "stamp"],
    run: (e) => insertText(e, dateText({ dateStyle: "long", timeStyle: "short" })),
  },
];

// ------------------------------------------------------------------ matching

/** Lowercase without accents, so "café" matches "cafe". */
const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();

/** Letters of `q` appear in order in `text`; more points for runs and word starts. */
function subsequence(text: string, q: string): number {
  let ti = 0;
  let points = 0;
  let run = 0;
  for (const ch of q) {
    const found = text.indexOf(ch, ti);
    if (found === -1) return 0;
    const wordStart = found === 0 || text[found - 1] === " " || text[found - 1] === "-";
    run = found === ti ? run + 1 : 0;
    points += 1 + run * 2 + (wordStart ? 3 : 0);
    ti = found + 1;
  }
  return points;
}

/** How well `query` matches a command: 0 for no match, higher is better. */
export function matchScore(cmd: SlashCommand, query: string): number {
  const q = norm(query);
  if (!q) return 1;
  const title = norm(cmd.title);
  const words = title.split(/[\s-]+/);
  const keywords = cmd.keywords.map(norm);
  if (title === q) return 1000;
  if (title.startsWith(q)) return 900;
  if (words.some((w) => w.startsWith(q))) return 800;
  if (keywords.includes(q)) return 750;
  if (keywords.some((k) => k.startsWith(q))) return 700;
  if (title.includes(q)) return 600;
  if (keywords.some((k) => k.includes(q))) return 500;
  // Abbreviations like "chk" or "nlist": letters in order, at least two of them.
  if (q.length >= 2) {
    const best = Math.max(subsequence(title, q), ...keywords.map((k) => subsequence(k, q) * 0.8));
    if (best >= q.length * 2) return 100 + best;
  }
  return 0;
}

/** The commands matching `query`, best first (in menu order when the query is empty). */
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  if (!norm(query)) return commands;
  return commands
    .map((cmd, order) => ({ cmd, order, score: matchScore(cmd, query) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((m) => m.cmd);
}

// ----------------------------------------------------------------- extension

/** Where the menu should be shown, filled by the editor screen. */
export interface SlashMenuView {
  show: (props: SuggestionProps<SlashCommand, SlashCommand>) => void;
  hide: () => void;
  keydown: (props: SuggestionKeyDownProps) => boolean;
}

/** No menu inside code: "/" is often part of a path or a comment there. */
function inCode(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos);
  return !!$pos.parent.type.spec.code || $pos.marks().some((m) => m.type.name === "code");
}

export const slashPluginKey = new PluginKey("slashCommands");

/** Type "/" at the start of a line or after a space to open the menu. */
export function SlashCommands(options: { view: () => SlashMenuView | null; context: () => SlashContext }) {
  return Extension.create({
    name: "slashCommands",
    // Before list and table keymaps, so Enter/Tab pick from the menu while it's open.
    priority: 1000,
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommand, SlashCommand>({
          editor: this.editor,
          pluginKey: slashPluginKey,
          char: "/",
          allowSpaces: false,
          startOfLine: false,
          // Not in the middle of a word or a web address ("a/b", "https://…").
          allowedPrefixes: [" ", "\u00a0", "\t"],
          // The typed "/query" gets a subtle background while the menu is open.
          decorationClass: "slash-query",
          allow: ({ editor, state, range }) => editor.isEditable && !inCode(state, range.from),
          items: ({ editor, query }) => filterCommands(SLASH_COMMANDS.filter((c) => c.available?.(editor) ?? true), query),
          command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashCommand }) => {
            // Remove the typed "/query", then run the command where it was.
            editor.chain().focus().deleteRange(range).run();
            props.run(editor, options.context());
          },
          render: () => ({
            onStart: (props) => options.view()?.show(props),
            onUpdate: (props) => options.view()?.show(props),
            onExit: () => options.view()?.hide(),
            onKeyDown: (props) => options.view()?.keydown(props) ?? false,
          }),
        }),
      ];
    },
  });
}
