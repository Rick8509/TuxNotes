// Code blocks with syntax colours (highlight.js through lowlight), a language picker and
// a Copy button. The language is the block's `language` attribute, as before (it's also
// what ```python sets in Markdown); none means "detect it".

import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";

const base = createLowlight(common);

/** Rarely used languages that highlight.js's guessing picks too often (short SQL came out
 *  as Visual Basic, HTML as a PHP template): only used when chosen. */
const NOT_GUESSED = new Set(["vbnet", "arduino", "wasm", "php-template", "python-repl", "objectivec", "plaintext"]);
const GUESSABLE = base.listLanguages().filter((l) => !NOT_GUESSED.has(l));

/** lowlight, guessing only among common languages (used for highlighting and the label). */
export const lowlight: typeof base = {
  ...base,
  highlightAuto: (value, options) => base.highlightAuto(value, { subset: GUESSABLE, ...options }),
};

/** Names shown in the picker for highlight.js's language ids. */
const NAMES: Record<string, string> = {
  arduino: "Arduino",
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  go: "Go",
  graphql: "GraphQL",
  ini: "INI / TOML",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  less: "Less",
  lua: "Lua",
  makefile: "Makefile",
  markdown: "Markdown",
  objectivec: "Objective-C",
  perl: "Perl",
  php: "PHP",
  "php-template": "PHP template",
  plaintext: "Plain text",
  python: "Python",
  "python-repl": "Python console",
  r: "R",
  ruby: "Ruby",
  rust: "Rust",
  scss: "SCSS",
  shell: "Shell session",
  sql: "SQL",
  swift: "Swift",
  typescript: "TypeScript",
  vbnet: "Visual Basic .NET",
  wasm: "WebAssembly",
  xml: "HTML / XML",
  yaml: "YAML",
};

/** A language id's name ("cpp" → "C++"); ids it doesn't know are shown as they are. */
export function languageName(id: string): string {
  return NAMES[id] ?? id;
}

/** Picker choices: real languages A–Z (Plain text is offered separately). */
export const LANGUAGES = lowlight
  .listLanguages()
  .filter((id) => id !== "plaintext")
  .map((id) => ({ id, name: NAMES[id] ?? id }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** The language highlight.js guesses for some code (null when it can't tell). */
export function detectCodeLanguage(text: string): string | null {
  if (text.trim().length < 12) return null;
  const result = lowlight.highlightAuto(text);
  const lang = (result.data as { language?: string; relevance?: number } | undefined)?.language;
  const relevance = (result.data as { relevance?: number } | undefined)?.relevance ?? 0;
  return lang && relevance >= 4 ? lang : null;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};

export const CodeBlock = CodeBlockLowlight.configure({
  lowlight,
  // No red underlines in code.
  HTMLAttributes: { spellcheck: "false" },
}).extend({
  // In the editor: the code with a small bar above it (language, Copy).
  addNodeView() {
    return ({ node, editor, getPos, view }) => {
      let current = node;
      const dom = el("div", "code-block");
      const bar = el("div", "code-block-bar");
      bar.contentEditable = "false";
      const select = el("select", "code-block-language");
      select.setAttribute("aria-label", "Code language");
      select.title = "Language for colours";
      const auto = el("option");
      auto.value = "";
      const plain = el("option");
      plain.value = "plaintext";
      plain.textContent = "Plain text";
      const other = el("option");
      select.append(auto, plain, ...LANGUAGES.map((l) => Object.assign(el("option"), { value: l.id, textContent: l.name })), other);
      const copy = el("button", "code-block-copy");
      copy.type = "button";
      copy.textContent = "Copy";
      copy.title = "Copy the code";
      bar.append(select, copy);
      const pre = el("pre");
      const code = el("code");
      code.spellcheck = false;
      pre.append(code);
      dom.append(bar, pre);

      let detectTimer: ReturnType<typeof setTimeout> | undefined;
      const showDetected = () => {
        const found = current.attrs.language ? null : detectCodeLanguage(current.textContent);
        auto.textContent = found ? `Auto-detect (${languageName(found)})` : "Auto-detect";
      };

      const sync = (n: typeof node) => {
        const lang = (n.attrs.language as string | null) ?? "";
        const known = !lang || lang === "plaintext" || LANGUAGES.some((l) => l.id === lang);
        // A language from elsewhere (an imported ```svelte) stays, under its own name.
        other.hidden = known;
        if (!known) Object.assign(other, { value: lang, textContent: languageName(lang) });
        select.value = lang;
        select.disabled = !view.editable;
        code.className = lang ? `language-${lang}` : "";
        clearTimeout(detectTimer);
        detectTimer = setTimeout(showDetected, 300);
      };
      sync(node);

      // The note becomes editable (or read-only) after its code blocks are drawn. (`view`,
      // not editor.view: blocks in the starting content are drawn before that exists.)
      const editableWatch = new MutationObserver(() => (select.disabled = !view.editable));
      editableWatch.observe(view.dom, { attributes: true, attributeFilter: ["contenteditable"] });

      select.addEventListener("change", () => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        editor
          .chain()
          .command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, { ...current.attrs, language: select.value || null });
            return true;
          })
          .run();
      });

      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(current.textContent);
          copy.textContent = "Copied";
        } catch {
          copy.textContent = "Couldn't copy";
        }
        setTimeout(() => (copy.textContent = "Copy"), 1500);
      });

      return {
        dom,
        contentDOM: code,
        update: (n) => {
          if (n.type !== current.type) return false;
          current = n;
          sync(n);
          return true;
        },
        // The bar is ours: typing and clicks there don't belong to the text.
        stopEvent: (e) => bar.contains(e.target as globalThis.Node),
        ignoreMutation: (m) => bar.contains(m.target as globalThis.Node) || m.type === "attributes",
        destroy: () => {
          clearTimeout(detectTimer);
          editableWatch.disconnect();
        },
      };
    };
  },
});
