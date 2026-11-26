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
  // selection, undo history, folds and scroll position survive switching tabs.
  import { untrack } from "svelte";
  import { Compartment, EditorState, type Extension } from "@codemirror/state";
  import {
    EditorView,
    drawSelection,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
  } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
  import {
    bracketMatching,
    codeFolding,
    foldGutter,
    foldKeymap,
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
    /** Every open tab, so closed ones can be forgotten. */
    openIds: string[];
    wrap: boolean;
    oncursor: (info: CursorInfo) => void;
    /** The tab's language ("Plain Text" when none) and indentation, once known. */
    onlanguage: (tabId: string, language: string, indentation: Indentation) => void;
  }
  let { id, name, text, openIds, wrap, oncursor, onlanguage }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  let shownId: string | null = null;
  const saved = new Map<string, { state: EditorState; scroll: number }>();
  // Shared by every tab's state, so they can be changed later.
  const languageConf = new Compartment();
  const wrapConf = new Compartment();

  function report(state: EditorState) {
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.head);
    oncursor({ line: line.number, column: sel.head - line.from + 1, selected: Math.abs(sel.to - sel.from), lines: state.doc.lines });
  }

  function extensions(indentation: Indentation): Extension[] {
    return [
      lineNumbers(),
      foldGutter({ openText: "⌄", closedText: "›" }),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      codeFolding(),
      drawSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      bracketMatching(),
      search({ top: true }),
      syntaxHighlighting(codeHighlight),
      keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap]),
      indentUnit.of(indentation.tabs ? "\t" : " ".repeat(indentation.size)),
      EditorState.tabSize.of(indentation.size),
      EditorState.readOnly.of(true),
      languageConf.of([]),
      wrapConf.of(wrap ? EditorView.lineWrapping : []),
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged) report(u.state);
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
      view.setState(EditorState.create({ doc, extensions: extensions(indentation) }));
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
    for (const tabId of [...saved.keys()]) if (!open.has(tabId)) saved.delete(tabId);
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
