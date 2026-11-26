// CodeMirror look for the Files window, using TuxNotes' colour variables so light and
// dark follow the app's theme.
import { EditorView } from "@codemirror/view";

export const codeTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13.5px",
    color: "var(--text)",
    backgroundColor: "var(--bg-editor)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.55",
  },
  ".cm-content": { padding: "10px 0 40vh" },
  ".cm-line": { padding: "0 16px 0 10px" },
  ".cm-gutters": {
    backgroundColor: "var(--bg-editor)",
    color: "var(--text-tertiary)",
    border: "none",
    paddingLeft: "8px",
  },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "3ch" },
  ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-secondary)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent-strong)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
    { backgroundColor: "color-mix(in srgb, var(--accent) 32%, transparent) !important" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 18%, transparent)" },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--accent) 60%, transparent)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--accent) 60%, transparent)" },
  ".cm-panels": { backgroundColor: "var(--bg-sidebar)", color: "var(--text)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--separator)" },
  ".cm-panel.cm-search": { padding: "6px 10px", fontFamily: "var(--font-ui)", fontSize: "13px" },
  ".cm-panel.cm-search input, .cm-panel.cm-search button": { fontFamily: "var(--font-ui)", fontSize: "12.5px" },
  ".cm-textfield": {
    backgroundColor: "var(--bg-input)",
    border: "1px solid transparent",
    borderRadius: "6px",
    color: "var(--text)",
    padding: "3px 7px",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--bg-input)",
    border: "none",
    borderRadius: "6px",
    color: "var(--text)",
    padding: "3px 9px",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--bg-list)",
    border: "none",
    borderRadius: "8px",
    boxShadow: "var(--shadow-pop)",
  },
});
