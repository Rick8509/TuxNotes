// The Files window's tabs: text and code files opened from "Open With", the Open dialog,
// drops or the command line (see src-tauri/src/files.rs).
import { api, errorText } from "../lib/api";
import type { FileEntry, FileStatus, TextFile } from "../lib/types";
import type { Indentation } from "./languages";

export interface FileTab extends FileEntry {
  state: "loading" | "ready" | "error";
  file?: TextFile;
  error?: string;
  /** Language for syntax colours ("Plain Text" for none), detected or picked. */
  language?: string;
  indentation?: Indentation;
  /** Edited since it was opened or saved. */
  dirty?: boolean;
  /** Another program changed or deleted the file while it had unsaved changes. */
  conflict?: "changed" | "deleted";
}

class Files {
  tabs = $state<FileTab[]>([]);
  activeId = $state<string | null>(null);

  get active(): FileTab | null {
    return this.tabs.find((t) => t.id === this.activeId) ?? null;
  }

  /** Open whatever was opened since the last call (new tabs, or switch to an open one). */
  async pull() {
    let entries: FileEntry[];
    try {
      entries = await api.takePendingFiles();
    } catch (e) {
      console.warn("couldn't get files to open:", e);
      return;
    }
    for (const entry of entries) this.open(entry);
  }

  open(entry: FileEntry) {
    if (!this.tabs.some((t) => t.id === entry.id)) {
      this.tabs.push({ ...entry, state: "loading" });
      void this.load(entry.id);
    }
    this.activeId = entry.id;
  }

  async load(id: string) {
    try {
      const file = await api.readTextFile(id);
      this.update(id, { state: "ready", file, name: file.name, path: file.path, error: undefined });
    } catch (e) {
      this.update(id, { state: "error", error: errorText(e) });
    }
  }

  get dirtyTabs(): FileTab[] {
    return this.tabs.filter((t) => t.dirty);
  }

  setDirty(id: string, dirty: boolean) {
    this.update(id, { dirty });
  }

  setConflict(id: string, conflict: FileTab["conflict"]) {
    this.update(id, { conflict });
  }

  /** Saved, or reloaded from disk: this is now what's on disk. */
  synced(id: string, file: TextFile) {
    const tab = this.tabs.find((t) => t.id === id);
    this.update(id, { file: { ...file, text: tab?.file?.text ?? file.text }, conflict: undefined });
  }

  /** "Keep Mine": the change on disk is noted, so saving later replaces it without asking. */
  keepMine(id: string, status: FileStatus) {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab?.file) this.update(id, { file: { ...tab.file, modified: status.modified, size: status.size }, conflict: undefined });
  }

  /** Save As: the tab now shows another file (with its own id). */
  renamed(oldId: string, file: TextFile) {
    // That file may already be open in another tab: this one replaces it.
    if (file.id !== oldId) this.close(file.id);
    const i = this.tabs.findIndex((t) => t.id === oldId);
    if (i < 0) return;
    const text = this.tabs[i].file?.text ?? file.text;
    this.tabs[i] = { ...this.tabs[i], id: file.id, name: file.name, path: file.path, file: { ...file, text }, conflict: undefined };
    if (this.activeId === oldId) this.activeId = file.id;
  }

  /** Language and indentation, once the code view knows them (or the user picks one). */
  setInfo(id: string, info: { language: string; indentation?: Indentation }) {
    this.update(id, info);
  }

  private update(id: string, patch: Partial<FileTab>) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i >= 0) this.tabs[i] = { ...this.tabs[i], ...patch };
  }

  /** Close a tab; the one next to it becomes active. */
  close(id: string) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    this.tabs.splice(i, 1);
    if (this.activeId === id) this.activeId = this.tabs[Math.min(i, this.tabs.length - 1)]?.id ?? null;
  }

  /** Next (1) or previous (-1) tab, wrapping around. */
  step(delta: number) {
    if (!this.tabs.length) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activeId = this.tabs[(i + delta + this.tabs.length) % this.tabs.length].id;
  }
}

export const files = new Files();
