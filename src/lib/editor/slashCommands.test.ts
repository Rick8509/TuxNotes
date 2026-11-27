import { describe, expect, it } from "vitest";
import { filterCommands, matchScore, SLASH_COMMANDS } from "./slashCommands";

const first = (query: string) => filterCommands(SLASH_COMMANDS, query)[0]?.id;
const ids = (query: string) => filterCommands(SLASH_COMMANDS, query).map((c) => c.id);

describe("slash command matching", () => {
  it("shows every command, in menu order, before anything is typed", () => {
    expect(ids("")).toEqual(SLASH_COMMANDS.map((c) => c.id));
    expect(ids("  ")).toEqual(SLASH_COMMANDS.map((c) => c.id));
  });

  it.each([
    ["check", "checklist"],
    ["todo", "checklist"],
    ["to-do", "checklist"],
    ["task", "checklist"],
    ["tick", "checklist"],
    ["chk", "checklist"],
    ["h1", "title"],
    ["title", "title"],
    ["h2", "heading"],
    ["head", "heading"],
    ["sub", "subheading"],
    ["h3", "subheading"],
    ["code", "code"],
    ["mono", "code"],
    ["quote", "quote"],
    ["bul", "bullets"],
    ["num", "numbers"],
    ["ol", "numbers"],
    ["tab", "table"],
    ["grid", "table"],
    ["img", "attach"],
    ["image", "attach"],
    ["pdf", "attach"],
    ["file", "attach"],
    ["url", "link"],
    ["hr", "divider"],
    ["line", "divider"],
    ["div", "divider"],
    ["today", "date"],
    ["time", "time"],
    ["timestamp", "datetime"],
    ["text", "body"],
  ])("“%s” finds %s first", (query, id) => {
    expect(first(query)).toBe(id);
  });

  it("ignores case and accents", () => {
    expect(first("CHECKLIST")).toBe("checklist");
    expect(first("Tàble")).toBe("table");
  });

  it("finds nothing for unrelated words", () => {
    expect(ids("xyz")).toEqual([]);
    expect(ids("zzzz")).toEqual([]);
  });

  it("ranks title matches above keyword matches", () => {
    const list = filterCommands(SLASH_COMMANDS, "list");
    // "Bulleted List" and "Numbered List" have it in their names; Checklist ends with it.
    expect(list.slice(0, 3).map((c) => c.id).sort()).toEqual(["bullets", "checklist", "numbers"].sort());
    expect(matchScore(SLASH_COMMANDS.find((c) => c.id === "checklist")!, "")).toBe(1);
  });

  it("gives every command an icon, a description and a unique id", () => {
    const seen = new Set<string>();
    for (const c of SLASH_COMMANDS) {
      expect(c.icon).toBeTruthy();
      expect(c.description.length).toBeGreaterThan(5);
      expect(seen.has(c.id)).toBe(false);
      seen.add(c.id);
    }
  });
});

describe("matching several words (command palette)", () => {
  const items = [
    { title: "Export as PDF…", keywords: ["save", "pdf", "download"] },
    { title: "Export as Markdown…", keywords: ["save", "md", "download"] },
    { title: "Use Dark Appearance", keywords: ["theme", "dark mode", "night"] },
    { title: "Print…", keywords: ["printer", "paper"] },
  ];
  it("finds titles where each typed word starts a word", () => {
    expect(filterCommands(items, "export pdf").map((i) => i.title)).toEqual(["Export as PDF…"]);
    expect(filterCommands(items, "save md").map((i) => i.title)).toEqual(["Export as Markdown…"]);
    expect(filterCommands(items, "dark mode")[0].title).toBe("Use Dark Appearance");
  });
  it("needs every word", () => {
    expect(matchScore(items[0], "export word")).toBe(0);
    expect(filterCommands(items, "print pdf")).toEqual([]);
  });
});
