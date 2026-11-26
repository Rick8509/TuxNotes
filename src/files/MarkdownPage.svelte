<script lang="ts">
  // A Markdown file as a formatted page you can edit, like a note. Changes go back into the
  // file's text block by block (markdownBlocks.ts): untouched parts stay exactly as written.
  import { onMount } from "svelte";
  import { Editor } from "@tiptap/core";
  import { contentExtensions } from "../lib/editor/content";
  import { prefs } from "../lib/stores/prefs.svelte";
  import { parseMarkdownPage, serializeMarkdownPage, type MarkdownPage } from "./markdownBlocks";

  interface Props {
    /** The file's Markdown when the page opened. */
    text: string;
    readOnly: boolean;
    /** The page was edited: the file's new Markdown. */
    onchange: (markdown: string) => void;
  }
  let { text, readOnly, onchange }: Props = $props();

  let element: HTMLDivElement;
  let editor: Editor | null = null;
  let page: MarkdownPage | null = $state(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function push() {
    timer = undefined;
    if (editor && page) onchange(serializeMarkdownPage(page, editor.getJSON().content ?? []));
  }

  /** Hand over edits still waiting (before saving or switching views). */
  export function flush() {
    if (timer) {
      clearTimeout(timer);
      push();
    }
  }

  onMount(() => {
    page = parseMarkdownPage(text);
    editor = new Editor({
      element,
      extensions: contentExtensions({ markdownFile: true }),
      content: page.doc,
      editable: !readOnly,
      editorProps: {
        attributes: {
          class: "prose",
          spellcheck: String(prefs.spellCheck),
          "aria-label": "Formatted Markdown",
        },
      },
      onUpdate: () => {
        clearTimeout(timer);
        timer = setTimeout(push, 150);
      },
    });
    if (!readOnly) editor.commands.focus("start");
    return () => {
      flush();
      editor?.destroy();
      editor = null;
    };
  });
</script>

<div class="md-scroll">
  <div class="md-page note-page">
    {#if page?.frontMatter}
      <details class="front-matter">
        <summary>Front matter <span>(kept as it is; edit it in the Markdown view)</span></summary>
        <pre>{page.frontMatter.trim()}</pre>
      </details>
    {/if}
    <div bind:this={element}></div>
  </div>
</div>

<style>
  .md-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .md-page {
    --editor-font-size: 15px;
    max-width: 780px;
    margin: 0 auto;
    padding: 28px 32px 40vh;
  }
  .front-matter {
    margin: 0 0 18px;
    padding: 8px 12px;
    border-radius: var(--radius-md);
    background: var(--bg-input);
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .front-matter summary {
    cursor: default;
    font-weight: 600;
  }
  .front-matter summary span {
    font-weight: 400;
  }
  .front-matter pre {
    margin: 8px 0 0;
    font-family: var(--font-mono);
    white-space: pre-wrap;
  }
</style>
