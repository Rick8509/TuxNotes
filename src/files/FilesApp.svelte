<script lang="ts">
  // The Files window: text and code files opened from "Open With", the Open dialog,
  // drops or the command line, one tab each. They stay files on disk (not notes).
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen } from "@tauri-apps/api/event";
  import { CircleAlert, FileCode, FileText, FolderOpen, Lock, X } from "@lucide/svelte";
  import { api, isTauri } from "../lib/api";
  import { identity } from "../lib/stores/identity.svelte";
  import { ui } from "../lib/stores/ui.svelte";
  import WindowControls from "../lib/components/WindowControls.svelte";
  import CodeView from "./CodeView.svelte";
  import { files } from "./files.svelte";

  const active = $derived(files.active);

  /** Plain text files get a text icon, everything else a code icon. */
  const isPlainText = (name: string) => /\.(txt|text|md|markdown|log|rst|csv)$/i.test(name) || !name.includes(".");

  async function openDialog() {
    try {
      const count = await api.openFileDialog();
      // The app announces new files ("files-pending"); the browser preview doesn't.
      if (count && !isTauri) await files.pull();
    } catch (e) {
      console.warn("couldn't open files:", e);
    }
  }

  function onkeydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "o" && !e.shiftKey) {
      e.preventDefault();
      void openDialog();
    } else if (key === "w" && !e.shiftKey) {
      e.preventDefault();
      if (files.activeId) files.close(files.activeId);
    } else if (e.key === "Tab" || e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      files.step(e.key === "PageUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1);
    }
  }

  // Window title: the open file's name.
  $effect(() => {
    const title = active ? `${active.name} — ${identity.name}` : identity.name;
    document.title = title;
    if (isTauri) void getCurrentWindow().setTitle(title);
  });

  onMount(() => {
    identity.load();
    void files.pull();
    const cleanups: (() => void)[] = [];
    if (isTauri) {
      listen("files-pending", () => void files.pull()).then((fn) => cleanups.push(fn));
      // Square corners when maximized or full screen (like the notes window).
      const win = getCurrentWindow();
      const sync = async () => {
        ui.maximized = await win.isMaximized();
        ui.fullscreen = await win.isFullscreen();
      };
      void sync();
      win.onResized(() => void sync()).then((fn) => cleanups.push(fn));
    }
    return () => cleanups.forEach((fn) => fn());
  });
</script>

<svelte:window {onkeydown} />

<div class="frame" class:edge-to-edge={ui.edgeToEdge}>
  <header class="titlebar" data-tauri-drag-region>
    <div class="tabs" role="tablist" aria-label="Open files">
      {#each files.tabs as tab (tab.id)}
        <div
          class="tab"
          class:active={tab.id === files.activeId}
          role="tab"
          tabindex={tab.id === files.activeId ? 0 : -1}
          aria-selected={tab.id === files.activeId}
          title={tab.path}
          onclick={() => (files.activeId = tab.id)}
          onauxclick={(e) => e.button === 1 && files.close(tab.id)}
          onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (files.activeId = tab.id)}
        >
          {#if isPlainText(tab.name)}<FileText size={14} />{:else}<FileCode size={14} />{/if}
          <span class="name">{tab.name}</span>
          <button
            class="close"
            title="Close (Ctrl+W)"
            aria-label="Close {tab.name}"
            onclick={(e) => {
              e.stopPropagation();
              files.close(tab.id);
            }}
          >
            <X size={13} />
          </button>
        </div>
      {/each}
    </div>
    <button class="icon-btn" title="Open File (Ctrl+O)" aria-label="Open File" onclick={openDialog}>
      <FolderOpen size={17} />
    </button>
    <div class="spacer" data-tauri-drag-region></div>
    <WindowControls />
  </header>

  <main class="body">
    {#if !active}
      <div class="empty">
        <FileCode size={44} strokeWidth={1.4} />
        <h2>Open a text or code file</h2>
        <p>Text, Markdown, logs and code in any language. They stay files on your computer; nothing is added to your notes.</p>
        <button class="btn primary" onclick={openDialog}>Open File…</button>
        <p class="hint">Or drop files here, or choose <b>Open With → {identity.name}</b> in your file manager.</p>
      </div>
    {:else if active.state === "error"}
      <div class="empty">
        <CircleAlert size={40} strokeWidth={1.5} />
        <h2>Can't show “{active.name}”</h2>
        <p>{active.error}</p>
        <div class="actions">
          <button class="btn" onclick={() => files.load(active.id)}>Try Again</button>
          <button class="btn" onclick={() => files.close(active.id)}>Close Tab</button>
        </div>
      </div>
    {:else if active.state === "loading" || !active.file}
      <div class="empty"><p class="hint">Opening “{active.name}”…</p></div>
    {:else}
      <CodeView id={active.id} text={active.file.text} openIds={files.tabs.map((t) => t.id)} />
    {/if}
  </main>

  {#if active?.file}
    <footer class="status">
      <!-- Long paths are cut at the start; <bdi> keeps the slashes where they belong. -->
      <span class="path" title={active.file.path}><bdi dir="ltr">{active.file.path}</bdi></span>
      {#if active.file.readOnly}
        <span class="badge" title="You don't have permission to change this file."><Lock size={11} /> Read-only</span>
      {/if}
      <span>{active.file.encoding}</span>
      <span>{active.file.lineEnding}</span>
    </footer>
  {/if}
</div>

<style>
  .frame {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    contain: paint;
    border-radius: var(--window-radius);
    background: var(--bg-editor);
  }
  .frame::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    border: 1px solid var(--window-border);
    pointer-events: none;
    z-index: 1000;
  }
  .frame.edge-to-edge {
    border-radius: 0;
  }
  .frame.edge-to-edge::after {
    display: none;
  }

  /* Title bar with the tabs. */
  .titlebar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 44px;
    padding: 0 6px 0 8px;
    background: var(--bg-sidebar);
    border-bottom: 1px solid var(--separator);
  }
  .tabs {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    align-self: stretch;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tab {
    flex: none;
    display: flex;
    align-items: center;
    gap: 7px;
    max-width: 220px;
    height: 34px;
    padding: 0 6px 0 12px;
    border-radius: 9px 9px 0 0;
    color: var(--text-secondary);
    cursor: default;
    user-select: none;
  }
  .tab:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .tab.active {
    background: var(--bg-editor);
    color: var(--text);
    box-shadow: 0 -1px 0 var(--separator), 1px 0 0 var(--separator), -1px 0 0 var(--separator);
  }
  .tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
  .close {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    color: var(--text-tertiary);
    opacity: 0;
  }
  .tab:hover .close,
  .tab.active .close {
    opacity: 1;
  }
  .close:hover {
    background: var(--bg-active);
    color: var(--text);
  }
  .spacer {
    flex: 1;
    align-self: stretch;
  }

  .body {
    flex: 1;
    min-height: 0;
  }
  .empty {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px;
    text-align: center;
    color: var(--text-secondary);
  }
  .empty h2 {
    margin: 6px 0 0;
    font-size: 17px;
    color: var(--text);
  }
  .empty p {
    margin: 0;
    max-width: 460px;
  }
  .empty .btn {
    margin-top: 8px;
  }
  .btn {
    padding: 7px 16px;
    border-radius: var(--radius-sm);
    background: var(--bg-input);
    font-weight: 500;
  }
  .btn:hover {
    background: var(--bg-active);
  }
  .btn.primary {
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .btn.primary:hover {
    background: var(--accent-strong);
  }
  .hint {
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }

  .status {
    flex: none;
    display: flex;
    align-items: center;
    gap: 14px;
    height: 26px;
    padding: 0 14px;
    font-size: 11.5px;
    color: var(--text-secondary);
    background: var(--bg-sidebar);
    border-top: 1px solid var(--separator);
  }
  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--bg-input);
  }
</style>
