// Which language a file is in (for syntax colours), and how it's indented.
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

export const PLAIN_TEXT = "Plain Text";

/** Files CodeMirror doesn't recognize by name. */
const BY_FILENAME: [RegExp, string][] = [
  [/^\.(bashrc|bash_profile|bash_aliases|bash_logout|profile|zshrc|zprofile|zshenv|zlogin|xinitrc|xprofile)$/, "Shell"],
  [/^(PKGBUILD|APKBUILD|configure)$/, "Shell"],
  [/\.(zsh|ksh|bash)$/i, "Shell"],
  [/\.(svelte|vue)$/i, "HTML"],
  [/^\.env(\..+)?$/, "Properties files"],
  [/\.(conf|cfg|cnf|service|socket|timer|target|mount|desktop|editorconfig)$/i, "Properties files"],
  [/^\.(gitconfig|npmrc|editorconfig)$/, "Properties files"],
  [/\.(jsonc|json5|webmanifest)$/i, "JSON"],
];

/** Scripts without an extension: the program named on the first line (#!). */
const BY_SHEBANG: [RegExp, string][] = [
  [/python/, "Python"],
  [/\b(ba|z|da|k|mk)?sh\b/, "Shell"],
  [/\b(node|deno|bun)\b/, "JavaScript"],
  [/\bruby\b/, "Ruby"],
  [/\bperl\b/, "Perl"],
  [/\bphp\b/, "PHP"],
  [/\blua\b/, "Lua"],
];

export function findLanguage(name: string): LanguageDescription | null {
  if (name === PLAIN_TEXT) return null;
  return languages.find((l) => l.name === name) ?? LanguageDescription.matchLanguageName(languages, name, false);
}

/** The language for a file, from its name, or from its first line for scripts. */
export function detectLanguage(fileName: string, text: string): LanguageDescription | null {
  const byName = LanguageDescription.matchFilename(languages, fileName);
  if (byName) return byName;
  for (const [re, lang] of BY_FILENAME) if (re.test(fileName)) return findLanguage(lang);
  const first = text.slice(0, 200).split("\n")[0];
  if (first.startsWith("#!")) for (const [re, lang] of BY_SHEBANG) if (re.test(first)) return findLanguage(lang);
  return null;
}

/** Every language, for the picker: Plain Text first, then A–Z. */
export const LANGUAGE_NAMES: string[] = [PLAIN_TEXT, ...languages.map((l) => l.name).sort((a, b) => a.localeCompare(b))];

export interface Indentation {
  tabs: boolean;
  /** Spaces per level (also used for tabs' width). */
  size: number;
}

/**
 * How the file is indented: tabs if more lines start with a tab than with spaces;
 * otherwise the most common step between indentation levels (2, 3, 4 or 8; 4 if unclear).
 */
export function detectIndentation(text: string): Indentation {
  let tabLines = 0;
  let spaceLines = 0;
  const steps = new Map<number, number>();
  let previous = 0;
  for (const line of text.split("\n").slice(0, 2000)) {
    if (!line.trim()) continue;
    if (line.startsWith("\t")) {
      tabLines++;
      continue;
    }
    const spaces = line.length - line.trimStart().length;
    if (spaces > 0) spaceLines++;
    const step = Math.abs(spaces - previous);
    if (step > 0 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1);
    previous = spaces;
  }
  if (tabLines > spaceLines) return { tabs: true, size: 4 };
  let best = 4;
  let bestCount = 0;
  for (const size of [2, 4, 3, 8]) {
    const count = steps.get(size) ?? 0;
    if (count > bestCount) [best, bestCount] = [size, count];
  }
  return { tabs: false, size: best };
}
