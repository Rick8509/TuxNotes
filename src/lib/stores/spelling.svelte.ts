// Spell checking: applies Settings → General → Spelling to the note editor (WebKitGTK's
// checker with the installed Hunspell dictionaries; see src-tauri/src/spelling.rs).
import { api } from "../api";
import type { SpellingInfo } from "../types";
import { prefs } from "./prefs.svelte";

class Spelling {
  /** Installed dictionaries (loaded when Settings needs them). */
  info = $state<SpellingInfo | null>(null);
  /** Languages in use right now. */
  active = $state<string[]>([]);

  async loadInfo() {
    try {
      this.info = await api.spellingInfo();
    } catch {
      this.info = { available: [], systemDefault: [] };
    }
  }

  /** The languages that are ticked in Settings (the desktop's language until changed). */
  get chosen(): string[] {
    return prefs.spellLanguages.length ? prefs.spellLanguages : (this.info?.systemDefault ?? []);
  }

  /** Apply the current preferences. */
  async apply() {
    try {
      this.active = await api.setSpelling(prefs.spellCheck, [...prefs.spellLanguages]);
    } catch (e) {
      console.warn("couldn't change spell checking:", e);
    }
  }

  /** Tick or untick a language (at least one stays ticked). */
  toggle(code: string, on: boolean) {
    const next = on ? [...new Set([...this.chosen, code])] : this.chosen.filter((l) => l !== code);
    if (next.length) prefs.set("spellLanguages", next);
  }
}

export const spelling = new Spelling();

/**
 * "en_US" → "English (United States)" in the interface language. Codes with extra parts
 * are named from the part that's known ("de_DE_frami" → "German (Germany), frami");
 * unknown codes are shown as they are.
 */
export function languageName(code: string, locale = typeof navigator === "undefined" ? "en" : navigator.language): string {
  let names: Intl.DisplayNames;
  try {
    names = new Intl.DisplayNames([locale], { type: "language", languageDisplay: "standard", fallback: "none" });
  } catch {
    return code;
  }
  const parts = code.split(/[_-]/).filter(Boolean);
  for (let n = parts.length; n >= 1; n--) {
    let name: string | undefined;
    try {
      name = names.of(parts.slice(0, n).join("-"));
    } catch {
      name = undefined;
    }
    if (name) {
      const rest = parts.slice(n).join(" ");
      return rest ? `${name}, ${rest}` : name;
    }
  }
  return code;
}
