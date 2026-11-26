<script lang="ts">
  // The text of the open file (CodeMirror). Each tab keeps its own state: cursor,
  // selection, undo history and scroll position survive switching tabs.
  import { untrack } from "svelte";
  import { EditorState, type Extension } from "@codemirror/state";
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
  import { codeTheme } from "./codeTheme";

  interface Props {
    /** The tab shown. */
    id: string;
    text: string;
    /** Every open tab, so closed ones can be forgotten. */
    openIds: string[];
  }
  let { id, text, openIds }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  let shownId: string | null = null;
  const saved = new Map<string, { state: EditorState; scroll: number }>();

  function extensions(): Extension[] {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap]),
      EditorState.readOnly.of(true),
      codeTheme,
    ];
  }

  function show(tabId: string, doc: string) {
    view ??= new EditorView({ parent: host });
    if (shownId === tabId) return;
    if (shownId) saved.set(shownId, { state: view.state, scroll: view.scrollDOM.scrollTop });
    const before = saved.get(tabId);
    view.setState(before?.state ?? EditorState.create({ doc, extensions: extensions() }));
    view.scrollDOM.scrollTop = before?.scroll ?? 0;
    shownId = tabId;
    view.focus();
  }

  $effect(() => {
    const tabId = id;
    const doc = text;
    untrack(() => show(tabId, doc));
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
