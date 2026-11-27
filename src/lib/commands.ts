// The command palette's actions (Ctrl+Shift+P): everything you can do from the menus and
// shortcuts, found by typing. The palette itself is components/CommandPalette.svelte;
// matching is the same as the slash commands' (editor/slashCommands.ts).

import {
  ArchiveRestore,
  HardDriveUpload,
  NotebookText,
  Copy,
  Download,
  FileCode,
  FilePlus,
  FileText,
  FileUp,
  FolderInput,
  FolderPlus,
  Info,
  Keyboard,
  Lock,
  LockKeyholeOpen,
  Maximize,
  Monitor,
  Moon,
  PanelLeft,
  Pin,
  PinOff,
  Printer,
  RefreshCw,
  Search,
  Settings,
  SpellCheck,
  Sun,
  TextSearch,
  Trash2,
  Columns2,
} from "@lucide/svelte";
import type { Component } from "svelte";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, isTauri } from "./api";
import type { Matchable } from "./editor/slashCommands";
import { exportMarkdown, exportPdf, importMarkdown, printNote } from "./importExport";
import { app } from "./stores/app.svelte";
import { prefs } from "./stores/prefs.svelte";
import { ui } from "./stores/ui.svelte";
import { updates } from "./stores/updates.svelte";
import { identity } from "./stores/identity.svelte";

export interface PaletteCommand extends Matchable {
  id: string;
  icon: Component;
  /** The shortcut for it, shown on the right. */
  hint?: string;
  /** Left out when it can't be used now (e.g. no note is open). */
  available?: () => boolean;
  run: () => unknown;
}

/** What the palette knows when it opens. */
export interface PaletteContext {
  /** Where backups go, when one is chosen: Back Up Now is offered. */
  backupPlace: "folder" | "drive" | null;
  /** Ask which folder to move the open note to (the palette's second step). */
  pickFolder: () => void;
}

const note = () => app.current;
/** A note is open and not in Recently Deleted. */
const active = () => !!app.current && !app.current.deletedAt;
/** The open note's text can be seen (not a hidden locked note). */
const visible = () => !!app.current && app.current.content !== null;

async function backUpNow(place: "folder" | "drive") {
  await app.flush();
  app.showInfo("Backing up your notes…");
  try {
    const info = await api.backupNow();
    const n = info.noteCount ?? 0;
    app.showInfo(`Backed up ${n} note${n === 1 ? "" : "s"} to ${place === "folder" ? "the backup folder" : "Google Drive"}`);
  } catch (e) {
    app.showError(e);
  }
}

async function checkForUpdates() {
  await updates.check();
  if (updates.error) app.showError(updates.error);
  else if (updates.newer) {
    app.showInfo(`TuxNotes ${updates.newer.latest} is out`, { label: "Get It", run: () => void updates.openReleasePage() });
  } else app.showInfo(`You're up to date (${identity.name} ${identity.version})`);
}

async function toggleFullscreen() {
  const win = getCurrentWindow();
  await win.setFullscreen(!(await win.isFullscreen()));
}

export function paletteCommands(ctx: PaletteContext): PaletteCommand[] {
  const trashed = () => !!app.current?.deletedAt;
  const commands: PaletteCommand[] = [
    // Notes
    { id: "new-note", title: "New Note", keywords: ["create", "add", "write"], icon: FilePlus, hint: "Ctrl+N", run: () => app.newNote() },
    {
      id: "new-folder",
      title: "New Folder",
      keywords: ["create", "add", "directory"],
      icon: FolderPlus,
      hint: "Ctrl+Shift+N",
      run: () => {
        if (!ui.sidebarShown) ui.toggleSidebar();
        app.startNewFolder(null);
      },
    },
    {
      id: "search",
      title: "Search All Notes",
      keywords: ["find", "look for"],
      icon: Search,
      hint: "Ctrl+Shift+F",
      run: () => {
        if (!ui.listVisible) ui.toggleFocus();
        app.focusSearchTick++;
      },
    },
    { id: "find", title: "Find in Note", keywords: ["search", "find in page"], icon: TextSearch, hint: "Ctrl+F", available: visible, run: () => app.findInNoteTick++ },

    // The open note
    {
      id: "pin",
      title: note()?.isPinned ? "Unpin Note" : "Pin Note",
      keywords: ["top", "favourite", "favorite", "star"],
      icon: note()?.isPinned ? PinOff : Pin,
      available: active,
      run: () => app.togglePin(note()!.id),
    },
    {
      id: "move",
      title: "Move Note to Folder…",
      keywords: ["folder", "file", "organize", "organise"],
      icon: FolderInput,
      available: active,
      run: ctx.pickFolder,
    },
    {
      id: "duplicate",
      title: "Duplicate Note",
      keywords: ["copy", "clone"],
      icon: Copy,
      available: () => active() && !note()!.isLocked,
      run: () => app.duplicateNote(note()!.id),
    },
    note()?.isLocked
      ? { id: "lock", title: "Remove Lock", keywords: ["unlock", "password"], icon: LockKeyholeOpen, available: active, run: () => app.removeLock(note()!.id) }
      : { id: "lock", title: "Lock Note…", keywords: ["password", "protect", "encrypt", "private"], icon: Lock, available: active, run: () => app.lockNote(note()!.id) },
    { id: "lock-now", title: "Lock Now", keywords: ["lock all", "hide locked"], icon: Lock, available: () => app.lock.unlocked, run: () => app.lockNow() },
    {
      id: "info",
      title: "Note Info…",
      keywords: ["word count", "words", "characters", "details", "statistics"],
      icon: Info,
      available: visible,
      run: () => app.flush().then(() => (app.showNoteInfo = true)),
    },
    { id: "export-md", title: "Export as Markdown…", keywords: ["save", "md", "download", "markdown"], icon: Download, available: visible, run: exportMarkdown },
    { id: "export-pdf", title: "Export as PDF…", keywords: ["save", "pdf", "download"], icon: FileText, available: visible, run: exportPdf },
    { id: "print", title: "Print…", keywords: ["printer", "paper"], icon: Printer, hint: "Ctrl+P", available: visible, run: printNote },
    {
      id: "delete",
      title: "Delete Note",
      keywords: ["remove", "trash", "bin"],
      icon: Trash2,
      hint: "Ctrl+Delete",
      available: active,
      run: () => app.trashNote(note()!.id),
    },
    { id: "restore", title: "Restore Note", keywords: ["undelete", "recover", "bring back"], icon: ArchiveRestore, available: trashed, run: () => app.restoreNote(note()!.id) },
    {
      id: "delete-forever",
      title: "Delete Permanently…",
      keywords: ["remove", "erase", "destroy"],
      icon: Trash2,
      available: trashed,
      run: () => app.deleteNoteForever(note()!.id),
    },

    // Files
    { id: "import", title: "Import Markdown Files…", keywords: ["md", "open", "markdown"], icon: FileUp, run: importMarkdown },
    {
      id: "open-file",
      title: "Open File…",
      keywords: ["text", "code", "txt", "files window", "editor"],
      icon: FileCode,
      hint: "Ctrl+O",
      run: () => api.openFileDialog().catch((e) => app.showError(e)),
    },

    // Places
    { id: "all-notes", title: "Show All Notes", keywords: ["go to", "everything", "list"], icon: NotebookText, run: () => app.setFilter({ kind: "all" }) },
    { id: "trash", title: "Show Recently Deleted", keywords: ["go to", "trash", "bin", "deleted"], icon: Trash2, run: () => app.setFilter({ kind: "trash" }) },
    {
      id: "empty-trash",
      title: "Empty Recently Deleted…",
      keywords: ["trash", "bin", "clear", "delete all"],
      icon: Trash2,
      available: () => app.trashCount > 0,
      run: () => app.emptyTrash(),
    },

    // View
    {
      id: "sidebar",
      title: ui.sidebarShown ? "Hide Sidebar" : "Show Sidebar",
      keywords: ["folders", "panel", "toggle"],
      icon: PanelLeft,
      hint: "Ctrl+Alt+S",
      run: () => ui.toggleSidebar(),
    },
    {
      id: "focus",
      title: ui.listVisible ? "Focus Mode" : "Leave Focus Mode",
      keywords: ["distraction free", "zen", "hide panes", "toggle"],
      icon: Columns2,
      hint: "Ctrl+Alt+F",
      run: () => ui.toggleFocus(),
    },
    { id: "fullscreen", title: "Full Screen", keywords: ["maximize", "maximise", "toggle"], icon: Maximize, hint: "F11", available: () => isTauri, run: toggleFullscreen },
    {
      id: "theme-light",
      title: "Use Light Appearance",
      keywords: ["theme", "light mode", "day", "white"],
      icon: Sun,
      available: () => prefs.theme !== "light",
      run: () => prefs.set("theme", "light"),
    },
    {
      id: "theme-dark",
      title: "Use Dark Appearance",
      keywords: ["theme", "dark mode", "night", "black"],
      icon: Moon,
      available: () => prefs.theme !== "dark",
      run: () => prefs.set("theme", "dark"),
    },
    {
      id: "theme-system",
      title: "Use System Appearance",
      keywords: ["theme", "auto", "automatic", "desktop"],
      icon: Monitor,
      available: () => prefs.theme !== "system",
      run: () => prefs.set("theme", "system"),
    },
    {
      id: "spelling",
      title: prefs.spellCheck ? "Turn Off Spell Checking" : "Turn On Spell Checking",
      keywords: ["spelling", "dictionary", "spellcheck", "toggle"],
      icon: SpellCheck,
      run: () => prefs.set("spellCheck", !prefs.spellCheck),
    },

    // Settings and backup
    { id: "settings", title: "Settings", keywords: ["preferences", "options", "general"], icon: Settings, hint: "Ctrl+,", run: () => (app.settingsSection = "general") },
    {
      id: "back-up",
      title: "Back Up Now",
      keywords: ["backup", "save", "copy", "usb"],
      icon: HardDriveUpload,
      available: () => ctx.backupPlace !== null,
      run: () => backUpNow(ctx.backupPlace!),
    },
    {
      id: "backup-settings",
      title: "Backup Settings",
      keywords: ["backup", "restore", "usb", "drive", "nextcloud", "dropbox", "google"],
      icon: HardDriveUpload,
      run: () => (app.settingsSection = "backup"),
    },
    { id: "shortcuts", title: "Keyboard Shortcuts", keywords: ["keys", "hotkeys", "help"], icon: Keyboard, run: () => (app.settingsSection = "shortcuts") },
    { id: "updates", title: "Check for Updates", keywords: ["new version", "upgrade", "release"], icon: RefreshCw, run: checkForUpdates },
    { id: "about", title: "About TuxNotes", keywords: ["version", "help", "info"], icon: Info, run: () => (app.settingsSection = "about") },
  ];
  return commands.filter((c) => c.available?.() ?? true);
}
