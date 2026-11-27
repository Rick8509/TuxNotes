<script lang="ts">
  // Ctrl+Shift+P: one search box for every action, folder and note. Type a few letters
  // ("export pdf", "dark", a note's title), pick with ↑/↓ and Enter. Moving a note to
  // a folder is a second step in the same box.
  import { onMount, tick } from "svelte";
  import { FileText, Folder as FolderIcon, LockKeyhole } from "@lucide/svelte";
  import type { Component } from "svelte";
  import { api } from "../api";
  import { paletteCommands, type PaletteCommand, type PaletteContext } from "../commands";
  import { filterCommands, matchScore } from "../editor/slashCommands";
  import { folderPath, visibleRows } from "../folders";
  import { formatListDate } from "../format";
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import type { Folder, NoteSummary } from "../types";

  interface Item {
    key: string;
    title: string;
    sub?: string;
    hint?: string;
    icon: Component;
    locked?: boolean;
    run: () => unknown;
  }
  interface Section {
    title: string;
    items: Item[];
    score: number;
  }

  const MAX_ACTIONS = 8;
  const MAX_FOLDERS = 5;
  const MAX_NOTES = 8;
  const RECENT_NOTES = 5;

  let input = $state<HTMLInputElement>();
  let list = $state<HTMLDivElement>();
  let query = $state("");
  let index = $state(0);
  /** "move": the second step of "Move Note to Folder…". */
  let mode = $state<"main" | "move">("main");
  let allNotes = $state<NoteSummary[]>([]);
  let found = $state<NoteSummary[]>([]);
  let backupPlace = $state<PaletteContext["backupPlace"]>(null);
  /** Focus goes back here when the palette closes without doing anything. */
  const returnFocus = document.activeElement as HTMLElement | null;

  const context: PaletteContext = {
    get backupPlace() {
      return backupPlace;
    },
    pickFolder: () => {
      mode = "move";
      query = "";
      index = 0;
      void tick().then(() => input?.focus());
    },
  };
  // Worked out when the palette opens: titles like "Pin Note" / "Unpin Note" follow the note.
  const commands = paletteCommands(context);

  onMount(() => {
    input?.focus();
    void app.flush();
    void api
      .listNotes({ kind: "all" })
      .then((notes) => (allNotes = notes.sort((a, b) => b.updatedAt - a.updatedAt)))
      .catch(() => {});
    void api
      .backupStatus()
      .then((s) => (backupPlace = s.backupFolder ? "folder" : s.signedIn ? "drive" : null))
      .catch(() => {});
  });

  // Words inside notes: the same search as the search box (titles are matched here too).
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const q = query.trim();
    clearTimeout(searchTimer);
    if (mode !== "main" || q.length < 2) {
      found = [];
      return;
    }
    searchTimer = setTimeout(() => {
      api
        .searchNotes(q)
        .then((results) => {
          if (query.trim() === q) found = results;
        })
        .catch(() => {});
    }, 120);
  });

  /** Close and put the focus back (once the app behind is usable again). */
  async function close() {
    app.paletteOpen = false;
    await tick();
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  /** Close, then do it (focus is back where it was, for actions that use it). */
  function runItem(item: Item) {
    if (mode === "main" && item.key === "cmd:move") {
      void item.run();
      return;
    }
    void close()
      .then(() => item.run())
      .catch((e) => app.showError(e));
  }

  const noteTitle = (n: NoteSummary) => n.title || "New Note";
  const folderName = (id: string) => app.folders.find((f) => f.id === id)?.name ?? "";

  async function openNote(n: NoteSummary) {
    // Shown in its folder, so the list around it makes sense.
    if (app.selectedId !== n.id || app.searchResults) {
      await app.setFilter({ kind: "folder", folderId: n.folderId });
      await app.selectNote(n.id);
    }
    if (ui.listVisible === false) ui.toggleFocus();
    app.focusEditorTick++;
  }

  const commandItem = (c: PaletteCommand): Item => ({ key: `cmd:${c.id}`, title: c.title, hint: c.hint, icon: c.icon, run: c.run });
  const noteItem = (n: NoteSummary): Item => ({
    key: `note:${n.id}`,
    title: noteTitle(n),
    sub: [folderName(n.folderId), formatListDate(n.updatedAt)].filter(Boolean).join(" · "),
    icon: FileText,
    locked: n.isLocked,
    run: () => openNote(n),
  });
  const folderItem = (f: Folder, run: () => unknown): Item => {
    const path = folderPath(app.folders, f.id);
    return { key: `folder:${f.id}`, title: f.name, sub: path !== f.name ? path : undefined, icon: FolderIcon, run };
  };

  /** Folders in the order of the sidebar, each with its full path for matching. */
  const folderRows = $derived(visibleRows(app.folders).map((r) => r.folder));
  const matchFolder = (f: Folder) => ({ title: f.name, keywords: [folderPath(app.folders, f.id)] });

  const sections = $derived.by((): Section[] => {
    const q = query.trim();
    if (mode === "move") {
      const current = app.current;
      const folders = folderRows.filter((f) => f.id !== current?.folderId);
      const matching = q ? folders.filter((f) => matchScore(matchFolder(f), q) > 0) : folders;
      return [
        {
          title: "Move to",
          score: 1,
          items: matching.map((f) => folderItem(f, () => current && app.moveNote(current.id, f.id))),
        },
      ];
    }
    if (!q) {
      const recent = allNotes.filter((n) => n.id !== app.selectedId).slice(0, RECENT_NOTES);
      return [
        { title: "Recent Notes", score: 2, items: recent.map(noteItem) },
        { title: "Actions", score: 1, items: commands.map(commandItem) },
      ].filter((s) => s.items.length);
    }
    const actions = filterCommands(commands, q).slice(0, MAX_ACTIONS);
    const folders = folderRows
      .map((f) => ({ f, score: matchScore(matchFolder(f), q) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_FOLDERS);
    // Titles first (best match first), then notes whose text has the words.
    const titled = allNotes
      .map((n) => ({ n, score: matchScore({ title: noteTitle(n), keywords: [] }, q) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score);
    const seen = new Set(titled.map((m) => m.n.id));
    const notes = [...titled.map((m) => m.n), ...found.filter((n) => !seen.has(n.id))].slice(0, MAX_NOTES);
    const goTo = (f: Folder) => () => app.setFilter({ kind: "folder", folderId: f.id });
    return [
      { title: "Actions", score: actions.length ? matchScore(actions[0], q) : 0, items: actions.map(commandItem) },
      { title: "Folders", score: folders[0]?.score ?? 0, items: folders.map((m) => folderItem(m.f, goTo(m.f))) },
      { title: "Notes", score: titled[0]?.score ?? (notes.length ? 50 : 0), items: notes.map(noteItem) },
    ]
      .filter((s) => s.items.length)
      .sort((a, b) => b.score - a.score);
  });

  const items = $derived(sections.flatMap((s) => s.items));

  // A new search starts at the top.
  $effect(() => {
    void query;
    void mode;
    index = 0;
  });

  // Keep the highlighted row in view.
  $effect(() => {
    const key = items[index]?.key;
    if (key) list?.querySelector(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });
  });

  function onkeydown(e: KeyboardEvent) {
    const n = items.length;
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      if (n) index = (index + 1) % n;
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      if (n) index = (index - 1 + n) % n;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[index];
      if (item) runItem(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      void close();
    } else if (e.key === "Backspace" && mode === "move" && !query) {
      e.preventDefault();
      mode = "main";
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
      // Not on to the window, which would open the palette again.
      e.preventDefault();
      e.stopPropagation();
      void close();
    }
  }

  /** Hover follows the mouse only when it really moved (see SlashMenu.svelte). */
  let lastPointer: { x: number; y: number } | null = null;
  function onmousemove(e: MouseEvent, i: number) {
    const moved = lastPointer !== null && (e.clientX !== lastPointer.x || e.clientY !== lastPointer.y);
    lastPointer = { x: e.clientX, y: e.clientY };
    if (moved) index = i;
  }

  /** The title with the typed text marked, when the title contains it. */
  function parts(title: string): [string, string, string] {
    const q = query.trim().toLowerCase();
    const at = q ? title.toLowerCase().indexOf(q) : -1;
    return at < 0 ? [title, "", ""] : [title.slice(0, at), title.slice(at, at + q.length), title.slice(at + q.length)];
  }

  const placeholder = $derived(
    mode === "move" ? `Move “${app.current ? app.current.title || "New Note" : ""}” to which folder?` : "Search actions, folders and notes…",
  );
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="scrim" onmousedown={() => void close()}></div>
<div class="palette" role="dialog" aria-label="Command palette" aria-modal="true">
  <input
    bind:this={input}
    bind:value={query}
    {onkeydown}
    {placeholder}
    type="text"
    spellcheck="false"
    autocomplete="off"
    role="combobox"
    aria-label={mode === "move" ? "Folder" : "Search actions, folders and notes"}
    aria-expanded="true"
    aria-controls="palette-list"
    aria-activedescendant={items[index] ? `palette-${items[index].key}` : undefined}
  />
  <div class="list" id="palette-list" role="listbox" aria-label="Results" bind:this={list}>
    {#if items.length === 0}
      <div class="empty">{mode === "move" ? "No other folders match" : `Nothing matches “${query.trim()}”`}</div>
    {/if}
    {#each sections as section (section.title)}
      <div class="group" role="presentation">{section.title}</div>
      {#each section.items as item (item.key)}
        {@const i = items.indexOf(item)}
        {@const [before, match, after] = parts(item.title)}
        <div
          class="item"
          class:active={i === index}
          role="option"
          id="palette-{item.key}"
          data-key={item.key}
          aria-selected={i === index}
          tabindex="-1"
          onmousemove={(e) => onmousemove(e, i)}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => runItem(item)}
          onkeydown={() => {}}
        >
          <span class="icon"><item.icon size={17} strokeWidth={1.8} /></span>
          <span class="text">
            <span class="title">
              {#if item.locked}<LockKeyhole size={12} class="lock" aria-label="Locked" />{/if}{before}<mark>{match}</mark>{after}
            </span>
            {#if item.sub}<span class="sub">{item.sub}</span>{/if}
          </span>
          {#if item.hint}<kbd>{item.hint}</kbd>{/if}
        </div>
      {/each}
    {/each}
  </div>
  <div class="footer" aria-hidden="true">
    <span><kbd>↑</kbd><kbd>↓</kbd> choose</span>
    <span><kbd>↵</kbd> {mode === "move" ? "move" : "open"}</span>
    {#if mode === "move"}<span><kbd>⌫</kbd> back</span>{/if}
    <span><kbd>esc</kbd> close</span>
  </div>
</div>

<style>
  .scrim {
    position: absolute;
    inset: 0;
    z-index: 90;
    background: rgba(0, 0, 0, 0.18);
  }
  .palette {
    position: absolute;
    z-index: 91;
    top: 12%;
    left: 50%;
    translate: -50% 0;
    width: min(580px, calc(100% - 48px));
    display: flex;
    flex-direction: column;
    background: var(--bg-list);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
    animation: pop 0.12s ease-out;
    font-size: 13px;
  }
  @keyframes pop {
    from {
      opacity: 0;
      scale: 0.98;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .palette {
      animation: none;
    }
  }
  input {
    height: 48px;
    padding: 0 18px;
    border: none;
    border-bottom: 1px solid var(--separator);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 16px;
    outline: none;
  }
  input::placeholder {
    color: var(--text-tertiary);
  }
  .list {
    max-height: min(420px, 55vh);
    overflow-y: auto;
    padding: 6px;
  }
  .group {
    padding: 8px 10px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-tertiary);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: var(--radius-md);
    cursor: default;
  }
  .item.active {
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    background: var(--bg-input);
    color: var(--text-secondary);
  }
  .item.active .icon {
    background: color-mix(in srgb, var(--accent-contrast) 22%, transparent);
    color: inherit;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .title,
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title :global(.lock) {
    margin-right: 4px;
    vertical-align: -1px;
  }
  .sub {
    font-size: 11.5px;
    color: var(--text-secondary);
  }
  .item.active .sub {
    color: inherit;
    opacity: 0.85;
  }
  mark {
    background: none;
    color: inherit;
    font-weight: 700;
  }
  kbd {
    flex: none;
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--bg-input);
    color: var(--text-secondary);
    font: inherit;
    font-size: 11px;
  }
  .item.active kbd {
    background: color-mix(in srgb, var(--accent-contrast) 22%, transparent);
    color: inherit;
  }
  .empty {
    padding: 18px 12px;
    color: var(--text-secondary);
    text-align: center;
  }
  .footer {
    display: flex;
    gap: 14px;
    padding: 7px 14px;
    border-top: 1px solid var(--separator);
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .footer kbd {
    margin-right: 2px;
    padding: 0 4px;
  }
</style>
