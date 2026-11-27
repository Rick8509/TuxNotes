import { describe, expect, it } from "vitest";
import { detectIndentation, detectLanguage, findLanguage, LANGUAGE_NAMES, PLAIN_TEXT } from "./languages";

const lang = (name: string, text = "") => detectLanguage(name, text)?.name ?? PLAIN_TEXT;

describe("language detection", () => {
  it.each([
    ["server.py", "Python"],
    ["main.rs", "Rust"],
    ["App.tsx", "TSX"],
    ["index.html", "HTML"],
    ["Dockerfile", "Dockerfile"],
    ["data.json", "JSON"],
    ["config.toml", "TOML"],
    ["docker-compose.yml", "YAML"],
    ["README.md", "Markdown"],
    ["query.sql", "SQL"],
    [".bashrc", "Shell"],
    [".zshrc", "Shell"],
    ["PKGBUILD", "Shell"],
    ["Page.svelte", "HTML"],
    [".env", "Properties files"],
    [".env.local", "Properties files"],
    ["nginx.conf", "Nginx"],
    ["app.service", "Properties files"],
    ["tsconfig.jsonc", "JSON"],
    ["notes.txt", PLAIN_TEXT],
    ["build.log", PLAIN_TEXT],
  ])("%s → %s", (name, expected) => {
    expect(lang(name)).toBe(expected);
  });

  it("reads the first line of scripts without an extension", () => {
    expect(lang("backup", "#!/usr/bin/env python3\nprint(1)")).toBe("Python");
    expect(lang("deploy", "#!/bin/bash\necho hi")).toBe("Shell");
    expect(lang("run", "#!/bin/sh\n")).toBe("Shell");
    expect(lang("serve", "#!/usr/bin/env node\n")).toBe("JavaScript");
    expect(lang("notes", "just some text")).toBe(PLAIN_TEXT);
  });

  it("finds languages by name for the picker", () => {
    expect(findLanguage("Python")?.name).toBe("Python");
    expect(findLanguage("python")?.name).toBe("Python");
    expect(findLanguage(PLAIN_TEXT)).toBeNull();
    expect(LANGUAGE_NAMES[0]).toBe(PLAIN_TEXT);
    expect(LANGUAGE_NAMES.length).toBeGreaterThan(100);
  });
});

describe("indentation detection", () => {
  it("finds the step between levels", () => {
    expect(detectIndentation("a:\n  b:\n    c\n  d\n")).toEqual({ tabs: false, size: 2 });
    expect(detectIndentation("def f():\n    if x:\n        y()\n    return 1\n")).toEqual({ tabs: false, size: 4 });
    expect(detectIndentation("{\n\tfoo;\n\t\tbar;\n}\n")).toEqual({ tabs: true, size: 4 });
  });

  it("falls back to 4 spaces", () => {
    expect(detectIndentation("no indentation here\nat all\n")).toEqual({ tabs: false, size: 4 });
    expect(detectIndentation("")).toEqual({ tabs: false, size: 4 });
  });
});
