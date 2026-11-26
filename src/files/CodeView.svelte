<script lang="ts" module>
  /** Where the cursor is, for the status bar. */
  export interface CursorInfo {
    line: number;
    column: number;
    /** Characters selected (0 for none). */
    selected: number;
    lines: number;
  }
</script>

<script lang="ts">
  // The text of the open file (CodeMirror). Each tab keeps its own state: cursor,
  // selection, undo history, folds and scroll position survive switching tabs. The
  // Files window saves through getText / markSaved and reloads through replaceText.
  import { untrack } from "svelte";
  import { Compartment, EditorState, Text, type Extension, type TransactionSpec } from "@codemirror/state";
  import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
  import {
    EditorView,
    drawSelection,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
  } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
  import {
    bracketMatching,
    codeFolding,
    foldGutter,
    foldKeymap,
    indentOnInput,
    indentUnit,
    syntaxHighlighting,
    type LanguageDescription,
  } from "@codemirror/language";
  import { codeExtras, codeHighlight, codeTheme } from "./codeTheme";
  import { detectIndentation, detectLanguage, findLanguage, PLAIN_TEXT, type Indentation } from "./languages";

  interface Props {
    /** The tab shown. */
    id: string;
    name: string;
    text: string;
    /** No permission to save it: viewing only. */
    readOnly: boolean;
    /** Every open tab, so closed ones can be forgotten. */
    openIds: string[];
    wrap: boolean;
    oncursor: (info: CursorInfo) => void;
    /** The tab's language ("Plain Text" when none) and indentation, once known. */
    onlanguage: (tabId: string, language: string, indentation: Indentation) => void;
    /** The tab's text differs from what's on disk (or stopped differing). */
    ondirty: (tabId: string, dirty: boolean) => void;
  }
  let { id, name, text, readOnly, openIds, wrap, oncursor, onlanguage, ondirty }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  let shownId: string | null = null;
  const saved = new Map<string, { state: EditorState; scroll: number }>();
  // Shared by every tab's state, so they can be changed later.
  const languageConf = new Compartment();
  const wrapConf = new Compartment();
  const readOnlyConf = new Compartment();
  /** The text as last loaded or saved, per tab: anything else is unsaved. */
  const savedText = new Map<string, Text>();
  const dirty = new Set<string>();

  function setDirty(tabId: string, doc: Text) {
    const base = savedText.get(tabId);
    const now = !!base && !doc.eq(base);
    if (now === dirty.has(tabId)) return;
    if (now) dirty.add(tabId);
    else dirty.delete(tabId);
    ondirty(tabId, now);
  }

  const editable = (ro: boolean): Extension => [EditorState.readOnly.of(ro), EditorView.editable.of(true)];

  function report(state: EditorState) {
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.head);
    oncursor({ line: line.number, column: sel.head - line.from + 1, selected: Math.abs(sel.to - sel.from), lines: state.doc.lines });
  }

  function extensions(indentation: Indentation, ro: boolean): Extension[] {
    return [
      lineNumbers(),
      foldGutter({ openText: "⌄", closedText: "›" }),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      codeFolding(),
      closeBrackets(),
      indentOnInput(),
      drawSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      bracketMatching(),
      search({ top: true }),
      syntaxHighlighting(codeHighlight),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
      indentUnit.of(indentation.tabs ? "\t" : " ".repeat(indentation.size)),
      EditorState.tabSize.of(indentation.size),
      readOnlyConf.of(editable(ro)),
      languageConf.of([]),
      wrapConf.of(wrap ? EditorView.lineWrapping : []),
      // Only the shown tab's state gets view updates. Use its current id (Save As
      // changes a tab's id), not the one it was created with.
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged) report(u.state);
        if (u.docChanged && shownId) setDirty(shownId, u.state.doc);
      }),
      codeTheme,
      codeExtras,
    ];
  }

  /** Load a language's colours and apply them to a tab (shown or not). */
  async function applyLanguage(tabId: string, desc: LanguageDescription | null) {
    const support = desc ? await desc.load().catch(() => null) : null;
    const effects = languageConf.reconfigure(support ?? []);
    if (tabId === shownId && view) view.dispatch({ effects });
    else {
      const s = saved.get(tabId);
      if (s) saved.set(tabId, { ...s, state: s.state.update({ effects }).state });
    }
  }

  function show(tabId: string, fileName: string, doc: string) {
    view ??= new EditorView({ parent: host });
    if (shownId === tabId) return;
    if (shownId) saved.set(shownId, { state: view.state, scroll: view.scrollDOM.scrollTop });
    const before = saved.get(tabId);
    if (before) {
      view.setState(before.state);
      // Word wrap may have changed while another tab was shown.
      view.dispatch({ effects: wrapConf.reconfigure(wrap ? EditorView.lineWrapping : []) });
      requestAnimationFrame(() => view && (view.scrollDOM.scrollTop = before.scroll));
    } else {
      const indentation = detectIndentation(doc);
      view.setState(EditorState.create({ doc, extensions: extensions(indentation, readOnly) }));
      savedText.set(tabId, view.state.doc);
      view.scrollDOM.scrollTop = 0;
      const desc = detectLanguage(fileName, doc);
      onlanguage(tabId, desc?.name ?? PLAIN_TEXT, indentation);
      shownId = tabId;
      void applyLanguage(tabId, desc);
    }
    shownId = tabId;
    report(view.state);
    view.focus();
  }

  /** A tab's state, shown or not. */
  function stateOf(tabId: string): EditorState | null {
    return tabId === shownId && view ? view.state : (saved.get(tabId)?.state ?? null);
  }

  /** Change a tab's state, shown or not. */
  function updateTab(tabId: string, spec: TransactionSpec) {
    if (tabId === shownId && view) view.dispatch(spec);
    else {
      const s = saved.get(tabId);
      if (s) saved.set(tabId, { ...s, state: s.state.update(spec).state });
    }
  }

  /** The text to save. */
  export function getText(tabId: string): string | null {
    return stateOf(tabId)?.doc.toString() ?? null;
  }

  /** `text` was saved: changes made since (while saving) stay unsaved. */
  export function markSaved(tabId: string, text: string) {
    const state = stateOf(tabId);
    if (!state) return;
    savedText.set(tabId, Text.of(text.split("\n")));
    setDirty(tabId, state.doc);
  }

  /** The file changed on disk: show the new text, keeping the cursor near where it was. */
  export function replaceText(tabId: string, text: string) {
    const state = stateOf(tabId);
    if (!state) return;
    const line = state.doc.lineAt(state.selection.main.head).number;
    const doc = Text.of(text.split(/\r\n?|\n/));
    const at = doc.line(Math.min(line, doc.lines)).from;
    updateTab(tabId, { changes: { from: 0, to: state.doc.length, insert: doc }, selection: { anchor: at } });
    savedText.set(tabId, doc);
    setDirty(tabId, doc);
  }

  /** Save As gave the tab a new file (and id). */
  export function renameTab(oldId: string, newId: string) {
    if (shownId === oldId) shownId = newId;
    for (const map of [saved, savedText] as Map<string, unknown>[]) {
      if (map.has(oldId)) {
        map.set(newId, map.get(oldId));
        map.delete(oldId);
      }
    }
    if (dirty.delete(oldId)) dirty.add(newId);
  }

  /** Allow or stop editing (e.g. after Save As to a folder you can write to). */
  export function setReadOnly(tabId: string, ro: boolean) {
    updateTab(tabId, { effects: readOnlyConf.reconfigure(editable(ro)) });
  }

  /** The language picker: colour the shown file as `language`. */
  export function setLanguage(language: string) {
    if (!shownId) return;
    void applyLanguage(shownId, findLanguage(language));
  }

  $effect(() => {
    const tabId = id;
    const fileName = name;
    const doc = text;
    untrack(() => show(tabId, fileName, doc));
  });

  $effect(() => {
    const on = wrap;
    untrack(() => view?.dispatch({ effects: wrapConf.reconfigure(on ? EditorView.lineWrapping : []) }));
  });

  // Forget tabs that were closed.
  $effect(() => {
    const open = new Set(openIds);
    for (const tabId of [...saved.keys(), ...savedText.keys()]) {
      if (!open.has(tabId)) {
        saved.delete(tabId);
        savedText.delete(tabId);
        dirty.delete(tabId);
      }
    }
  });

  $effect(() => () => {
    view?.destroy();
    view = null;
  });
</script>

<div class="code" bind:this={host}></div>

<style>
  .code {
    height: 100%;
    min-height: 0;
  }
  .code :global(.cm-editor) {
    height: 100%;
  }
</style>
