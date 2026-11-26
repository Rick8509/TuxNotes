// Files window preferences (this computer): word wrap, how Markdown files are shown.
const KEY = "tuxnotes-files-v1";

export type MarkdownView = "formatted" | "text";

class FilesPrefs {
  wrap = $state(false);
  markdownView = $state<MarkdownView>("formatted");

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { wrap?: unknown; markdownView?: unknown };
      if (typeof saved.wrap === "boolean") this.wrap = saved.wrap;
      if (saved.markdownView === "formatted" || saved.markdownView === "text") this.markdownView = saved.markdownView;
    } catch {
      /* defaults */
    }
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ wrap: this.wrap, markdownView: this.markdownView }));
    } catch {
      /* not remembered */
    }
  }

  setWrap(on: boolean) {
    this.wrap = on;
    this.save();
  }

  setMarkdownView(view: MarkdownView) {
    this.markdownView = view;
    this.save();
  }
}

export const filesPrefs = new FilesPrefs();
