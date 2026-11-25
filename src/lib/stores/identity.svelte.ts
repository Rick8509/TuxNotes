// Which app this is: "TuxNotes", or "TuxNotes Dev" for test builds (their own app ID,
// notes and settings). Shown in the sidebar and in Settings → About.
import { api } from "../api";

class Identity {
  name = $state("TuxNotes");
  dev = $state(false);
  version = $state("");

  async load() {
    try {
      const info = await api.appInfo();
      this.name = info.name;
      this.dev = info.dev;
      this.version = info.version;
      document.title = info.name;
    } catch {
      /* keep the defaults */
    }
  }
}

export const identity = new Identity();
