// CodeMirror look for the Files window, using TuxNotes' colour variables so light and
// dark follow the app's theme.
import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

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

// Syntax colours: TuxNotes' --syntax-* variables (Xcode-like, light and dark in theme.css).

export const codeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: "var(--syntax-keyword)", fontWeight: "500" },
  { tag: [t.string, t.special(t.string), t.regexp, t.inserted, t.processingInstruction], color: "var(--syntax-string)" },
  { tag: [t.number, t.bool, t.atom, t.null, t.constant(t.name), t.standard(t.name)], color: "var(--syntax-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta], color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [t.typeName, t.className, t.namespace, t.self, t.annotation, t.modifier], color: "var(--syntax-type)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.labelName], color: "var(--syntax-function)" },
  { tag: [t.propertyName, t.special(t.variableName)], color: "var(--syntax-property)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--syntax-tag)" },
  { tag: t.attributeName, color: "var(--syntax-attribute)" },
  { tag: [t.operator, t.escape, t.punctuation], color: "var(--syntax-operator)" },
  { tag: [t.link, t.url], color: "var(--syntax-link)", textDecoration: "underline" },
  { tag: t.heading, fontWeight: "700", color: "var(--text)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.deleted, t.invalid], color: "var(--danger)" },
]);

/** Fold markers and matching brackets, in the same colours. */
export const codeExtras = EditorView.theme({
  ".cm-foldGutter .cm-gutterElement": { color: "var(--text-tertiary)", cursor: "default", padding: "0 4px" },
  ".cm-foldGutter .cm-gutterElement:hover": { color: "var(--text)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--bg-input)",
    border: "none",
    borderRadius: "4px",
    color: "var(--text-secondary)",
    padding: "0 5px",
    margin: "0 2px",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--accent) 55%, transparent)",
  },
  "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "color-mix(in srgb, var(--danger) 25%, transparent)" },
});
