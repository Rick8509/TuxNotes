<script lang="ts">
  // The Files window: text and code files opened from "Open With", the Open dialog,
  // drops or the command line, one tab each. They stay files on disk (not notes).
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen } from "@tauri-apps/api/event";
  import { ChevronDown, CircleAlert, FileCode, FileText, FolderOpen, Lock, TriangleAlert, WrapText, X } from "@lucide/svelte";
  import { api, errorText, isTauri } from "../lib/api";
  import { CHANGED_ON_DISK, UNMAPPABLE } from "../lib/types";
  import FilesDialog, { type DialogButton, type DialogRequest } from "./FilesDialog.svelte";
  import type { FileTab } from "./files.svelte";
  import { identity } from "../lib/stores/identity.svelte";
  import { ui } from "../lib/stores/ui.svelte";
  import WindowControls from "../lib/components/WindowControls.svelte";
  import CodeView, { type CursorInfo } from "./CodeView.svelte";
  import LanguagePicker from "./LanguagePicker.svelte";
  import { files } from "./files.svelte";
  import { filesPrefs } from "./filesPrefs.svelte";

  const active = $derived(files.active);

  const isReady = (t: FileTab | null | undefined): t is FileTab => !!t && t.state === "ready" && !!t.file;
  /** The tab the code view shows: the active one, or (while the active one is loading or
   *  can't be shown) the one shown before, so the code view never goes away. */
  let lastShown: string | null = null;
  const viewTab = $derived.by(() => {
    const pick = isReady(active) ? active : (files.tabs.find((t) => t.id === lastShown && isReady(t)) ?? files.tabs.find(isReady) ?? null);
    lastShown = pick?.id ?? null;
    return pick;
  });
  let cursor = $state<CursorInfo | null>(null);
  let pickerOpen = $state(false);
  let codeView = $state<ReturnType<typeof CodeView>>();
  let dialog = $state<DialogRequest | null>(null);
  /** A message above the text (a failed save, …). */
  let notice = $state<string | null>(null);

  /** Ask a question; resolves with the chosen button's value ("cancel" for Escape). */
  function ask(title: string, message: string, buttons: DialogButton[]): Promise<string> {
    return new Promise((resolve) => {
      dialog = {
        title,
        message,
        buttons,
        resolve: (value) => {
          dialog = null;
          resolve(value);
        },
      };
    });
  }
  const CANCEL: DialogButton = { label: "Cancel", value: "cancel" };

  // ------------------------------------------------------------------ saving

  /** Save a tab. Returns false if it wasn't saved (cancelled or failed). */
  async function save(tab: FileTab, opts: { force?: boolean; encoding?: string } = {}): Promise<boolean> {
    const text = codeView?.getText(tab.id);
    if (!tab.file || text == null) return false;
    if (tab.file.readOnly) return saveAs(tab);
    const encoding = opts.encoding ?? tab.file.encoding;
    const expected = tab.conflict === "deleted" ? null : tab.file.modified;
    try {
      const saved = await api.saveTextFile(tab.id, text, encoding, tab.file.lineEnding, expected, opts.force ?? false);
      files.synced(tab.id, saved);
      codeView?.markSaved(tab.id, text);
      notice = null;
      return true;
    } catch (e) {
      const message = errorText(e);
      if (message === CHANGED_ON_DISK) {
        const choice = await ask(
          `“${tab.name}” was changed by another program`,
          "It changed on disk after you opened it. Saving replaces those changes with yours.",
          [{ label: "Save Anyway", value: "save", kind: "destructive" }, CANCEL],
        );
        return choice === "save" && save(tab, { ...opts, force: true });
      }
      if (message === UNMAPPABLE) {
        const choice = await ask(
          `Save “${tab.name}” as UTF-8?`,
          `It's stored as ${encoding}, which can't hold some of the characters you typed. UTF-8 can store any text and is what most programs expect today.`,
          [{ label: "Save as UTF-8", value: "utf8", kind: "primary" }, CANCEL],
        );
        return choice === "utf8" && save(tab, { ...opts, encoding: "UTF-8" });
      }
      notice = message;
      return false;
    }
  }

  /** Save under a new name; the tab then shows that file. */
  async function saveAs(tab: FileTab): Promise<boolean> {
    const text = codeView?.getText(tab.id);
    if (!tab.file || text == null) return false;
    try {
      const saved = await api.saveTextFileAs(tab.id, text, tab.file.encoding, tab.file.lineEnding);
      if (!saved) return false;
      codeView?.renameTab(tab.id, saved.id);
      files.renamed(tab.id, saved);
      codeView?.markSaved(saved.id, text);
      codeView?.setReadOnly(saved.id, saved.readOnly);
      notice = null;
      return true;
    } catch (e) {
      const message = errorText(e);
      if (message === UNMAPPABLE) {
        notice = `Couldn't save: ${tab.file.encoding} can't hold some of the characters you typed. Use Save (Ctrl+S) to save as UTF-8.`;
      } else notice = message;
      return false;
    }
  }

  /** Close a tab, asking first if it has unsaved changes. */
  async function closeTab(id: string) {
    const tab = files.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.dirty) {
      files.activeId = id;
      const choice = await ask(`Save changes to “${tab.name}”?`, "Your changes are lost if you don't save them.", [
        { label: "Don't Save", value: "discard" },
        CANCEL,
        { label: "Save", value: "save", kind: "primary" },
      ]);
      if (choice === "cancel" || (choice === "save" && !(await save(tab)))) return;
    }
    files.close(id);
  }

  // --------------------------------------------------- changes made elsewhere

  /** Another program changed or deleted an open file: reload it, or ask if it was edited. */
  async function checkDisk() {
    for (const tab of [...files.tabs]) {
      if (tab.state !== "ready" || !tab.file) continue;
      let status;
      try {
        status = await api.fileStatus(tab.id);
      } catch {
        continue;
      }
      const current = files.tabs.find((t) => t.id === tab.id);
      if (!current?.file) continue;
      if (!status.exists) {
        if (current.conflict !== "deleted") files.setConflict(tab.id, "deleted");
      } else if (status.modified !== current.file.modified || status.size !== current.file.size) {
        if (current.dirty) {
          if (!current.conflict) files.setConflict(tab.id, "changed");
        } else await reload(current);
      } else if (current.conflict === "deleted") {
        files.setConflict(tab.id, undefined);
      }
    }
  }

  async function reload(tab: FileTab) {
    try {
      const file = await api.readTextFile(tab.id);
      codeView?.replaceText(tab.id, file.text);
      files.synced(tab.id, file);
    } catch (e) {
      notice = errorText(e);
    }
  }

  async function keepMine(tab: FileTab) {
    try {
      files.keepMine(tab.id, await api.fileStatus(tab.id));
    } catch (e) {
      notice = errorText(e);
    }
  }

  function pickLanguage(language: string) {
    pickerOpen = false;
    if (!active) return;
    files.setInfo(active.id, { language });
    codeView?.setLanguage(language);
  }

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
    // Alt+Z: word wrap on/off (as in VS Code).
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyZ") {
      e.preventDefault();
      filesPrefs.setWrap(!filesPrefs.wrap);
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "o" && !e.shiftKey) {
      e.preventDefault();
      void openDialog();
    } else if (key === "s") {
      e.preventDefault();
      if (active) void (e.shiftKey ? saveAs(active) : save(active));
    } else if (key === "w" && !e.shiftKey) {
      e.preventDefault();
      if (files.activeId) void closeTab(files.activeId);
    } else if (e.key === "Tab" || e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      files.step(e.key === "PageUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1);
    }
  }

  // Window title: the open file's name.
  $effect(() => {
    const title = active ? `${active.dirty ? "● " : ""}${active.name} — ${identity.name}` : identity.name;
    document.title = title;
    if (isTauri) void getCurrentWindow().setTitle(title);
  });

  onMount(() => {
    identity.load();
    void files.pull();
    const cleanups: (() => void)[] = [];
    // Notice files changed by other programs (on focus, and every few seconds when visible).
    const check = () => {
      if (document.visibilityState === "visible" && !dialog) void checkDisk();
    };
    const timer = setInterval(check, 3000);
    window.addEventListener("focus", check);
    cleanups.push(() => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    });
    if (isTauri) {
      listen("files-pending", () => void files.pull()).then((fn) => cleanups.push(fn));
      // Closing the window with unsaved changes: ask first.
      getCurrentWindow()
        .onCloseRequested(async (event) => {
          const unsaved = files.dirtyTabs;
          if (!unsaved.length) return;
          event.preventDefault();
          const what = unsaved.length === 1 ? `“${unsaved[0].name}”` : `${unsaved.length} files`;
          const choice = await ask(`Save changes to ${what} before closing?`, "Your changes are lost if you don't save them.", [
            { label: "Don't Save", value: "discard" },
            CANCEL,
            { label: unsaved.length === 1 ? "Save" : "Save All", value: "save", kind: "primary" },
          ]);
          if (choice === "cancel") return;
          if (choice === "save") {
            for (const tab of unsaved) if (!(await save(tab))) return;
          }
          await getCurrentWindow().destroy();
        })
        .then((fn) => cleanups.push(fn));
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
          onauxclick={(e) => e.button === 1 && closeTab(tab.id)}
          onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (files.activeId = tab.id)}
        >
          {#if isPlainText(tab.name)}<FileText size={14} />{:else}<FileCode size={14} />{/if}
          <span class="name">{tab.name}</span>
          <button
            class="close"
            class:dirty={tab.dirty}
            title={tab.dirty ? "Unsaved changes. Close (Ctrl+W)" : "Close (Ctrl+W)"}
            aria-label="Close {tab.name}{tab.dirty ? ' (unsaved changes)' : ''}"
            onclick={(e) => {
              e.stopPropagation();
              void closeTab(tab.id);
            }}
          >
            <span class="dot" aria-hidden="true"></span>
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
    <!-- The code view stays alive (hidden) while a tab that's loading or can't be shown is
         active: it holds every tab's text, including unsaved changes. -->
    {#if viewTab?.file}
      <div class="code-area" class:hidden={viewTab.id !== active?.id}>
        {#if notice}
          <div class="banner error" role="alert">
            <CircleAlert size={15} />
            <span>{notice}</span>
            <button class="close-banner" aria-label="Dismiss" onclick={() => (notice = null)}><X size={14} /></button>
          </div>
        {/if}
        {#if viewTab.conflict === "changed"}
          <div class="banner" role="alert">
            <TriangleAlert size={15} />
            <span>Another program changed “{viewTab.name}” while you were editing it.</span>
            <button class="banner-btn" onclick={() => viewTab && reload(viewTab)}>Reload (lose my changes)</button>
            <button class="banner-btn" onclick={() => viewTab && keepMine(viewTab)}>Keep Mine</button>
          </div>
        {:else if viewTab.conflict === "deleted"}
          <div class="banner" role="alert">
            <TriangleAlert size={15} />
            <span>“{viewTab.name}” was deleted or moved. Save (Ctrl+S) to create it again.</span>
          </div>
        {/if}
        <CodeView
          bind:this={codeView}
          id={viewTab.id}
          name={viewTab.name}
          text={viewTab.file.text}
          readOnly={viewTab.file.readOnly}
          ondirty={(tabId, dirty) => files.setDirty(tabId, dirty)}
          openIds={files.tabs.map((t) => t.id)}
          wrap={filesPrefs.wrap}
          oncursor={(info) => (cursor = info)}
          onlanguage={(tabId, language, indentation) => files.setInfo(tabId, { language, indentation })}
        />
      </div>
    {/if}
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
    {/if}
  </main>

  {#if active?.file}
    <footer class="status">
      <!-- Long paths are cut at the start; <bdi> keeps the slashes where they belong. -->
      <span class="path" title={active.file.path}><bdi dir="ltr">{active.file.path}</bdi></span>
      {#if active.file.readOnly}
        <span class="badge" title="You don't have permission to change this file. Save As (Ctrl+Shift+S) keeps a copy you can edit.">
          <Lock size={11} /> Read-only
        </span>
      {/if}
      {#if cursor}
        <span class="cursor">Ln {cursor.line}, Col {cursor.column}{cursor.selected ? ` (${cursor.selected} selected)` : ""}</span>
      {/if}
      {#if active.indentation}
        <span title="How this file is indented">{active.indentation.tabs ? "Tabs" : `Spaces: ${active.indentation.size}`}</span>
      {/if}
      <button class="status-btn" title="Choose the language for colours" onclick={() => (pickerOpen = !pickerOpen)}>
        {active.language ?? "Plain Text"} <ChevronDown size={11} />
      </button>
      <button
        class="status-btn"
        class:on={filesPrefs.wrap}
        title="Word wrap (Alt+Z)"
        aria-pressed={filesPrefs.wrap}
        onclick={() => filesPrefs.setWrap(!filesPrefs.wrap)}
      >
        <WrapText size={13} /> Wrap
      </button>
      <span>{active.file.encoding}</span>
      <span>{active.file.lineEnding}</span>
    </footer>
    {#if pickerOpen}
      <LanguagePicker current={active.language ?? "Plain Text"} onpick={pickLanguage} onclose={() => (pickerOpen = false)} />
    {/if}
  {/if}

  {#if dialog}
    <FilesDialog request={dialog} />
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
  /* Unsaved changes: a dot instead of the ×, which comes back on hover. */
  .close .dot {
    display: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-secondary);
  }
  .close.dirty {
    opacity: 1;
  }
  .close.dirty:not(:hover) .dot {
    display: block;
  }
  .close.dirty:not(:hover) :global(svg) {
    display: none;
  }
  .spacer {
    flex: 1;
    align-self: stretch;
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .code-area {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .code-area > :global(.code) {
    flex: 1;
  }
  .code-area.hidden {
    display: none;
  }
  .banner {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    font-size: 13px;
    background: color-mix(in srgb, var(--accent) 16%, var(--bg-editor));
    border-bottom: 1px solid var(--separator);
  }
  .banner.error {
    background: color-mix(in srgb, var(--danger) 12%, var(--bg-editor));
  }
  .banner span {
    flex: 1;
  }
  .banner-btn {
    padding: 3px 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-input);
    font-weight: 500;
    white-space: nowrap;
  }
  .banner-btn:hover {
    background: var(--bg-active);
  }
  .close-banner {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 5px;
    color: var(--text-secondary);
  }
  .close-banner:hover {
    background: var(--bg-hover);
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
  .cursor {
    font-variant-numeric: tabular-nums;
  }
  .status-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 6px;
    border-radius: 5px;
    color: inherit;
    font-size: inherit;
  }
  .status-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .status-btn.on {
    color: var(--accent-strong);
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
