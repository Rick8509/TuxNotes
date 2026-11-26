// The Files window's tabs: text and code files opened from "Open With", the Open dialog,
// drops or the command line (see src-tauri/src/files.rs).
import { api, errorText } from "../lib/api";
import type { FileEntry, TextFile } from "../lib/types";

export interface FileTab extends FileEntry {
  state: "loading" | "ready" | "error";
  file?: TextFile;
  error?: string;
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
