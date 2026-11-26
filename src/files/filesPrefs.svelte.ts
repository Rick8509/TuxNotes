// Files window preferences (this computer): word wrap.
const KEY = "tuxnotes-files-v1";

class FilesPrefs {
  wrap = $state(false);

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { wrap?: unknown };
      if (typeof saved.wrap === "boolean") this.wrap = saved.wrap;
    } catch {
      /* defaults */
    }
  }

  setWrap(on: boolean) {
    this.wrap = on;
    try {
      localStorage.setItem(KEY, JSON.stringify({ wrap: on }));
    } catch {
      /* not remembered */
    }
  }
}

export const filesPrefs = new FilesPrefs();
