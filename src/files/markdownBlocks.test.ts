import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { parseMarkdownPage, serializeMarkdownPage } from "./markdownBlocks";

const roundTrip = (text: string) => {
  const page = parseMarkdownPage(text);
  return serializeMarkdownPage(page, page.doc.content ?? []);
};

/** Change the text of the first text node containing `find`. */
function editText(nodes: JSONContent[], find: string, replace: string): JSONContent[] {
  const copy = structuredClone(nodes);
  let done = false;
  const walk = (n: JSONContent) => {
    if (done) return;
    if (n.type === "text" && n.text?.includes(find)) {
      n.text = n.text.replace(find, replace);
      done = true;
    }
    n.content?.forEach(walk);
  };
  copy.forEach(walk);
  if (!done) throw new Error(`"${find}" not found`);
  return copy;
}

// Markdown written in styles TuxNotes wouldn't use itself: all of it must survive.
const QUIRKY = `---
title: Quirky file
tags: [a, b]
---

Setext Title
============

* star bullet
* another   with  spaces

1) paren list
2) second

Some *emphasis* and __strong__ text,
wrapped over two lines.

~~~js
const x = 1;
~~~

| a | b |
|---|:-:|
| 1 | 2 |

<div align="center">
  <img src="logo.png">
</div>

![Logo](images/logo.png "The logo") and a [ref link][docs].

- [ ] todo
- [x] done

[docs]: https://example.com/docs
`;

describe("Markdown files: formatted view without rewriting", () => {
  it.each([
    ["the project README", readFileSync("README.md", "utf8")],
    ["the changelog", readFileSync("CHANGELOG.md", "utf8")],
    ["the release playbook", readFileSync("docs/RELEASING.md", "utf8")],
    ["unusual styles, front matter, HTML, images, references", QUIRKY],
    ["no final newline", "# Title\n\nText"],
    ["only blank lines", "\n\n\n"],
    ["empty", ""],
  ])("opening and saving %s changes nothing", (_, text) => {
    expect(roundTrip(text)).toBe(text);
  });

  it("an edit changes only its own block", () => {
    const page = parseMarkdownPage(QUIRKY);
    const out = serializeMarkdownPage(page, editText(page.doc.content!, "another", "ANOTHER"));
    // Only the list is written fresh (in TuxNotes' style); everything else stays.
    expect(out).toContain("- star bullet\n- ANOTHER");
    expect(out.replace(/- star bullet\n- ANOTHER\s+with\s+spaces\n/, "")).toBe(QUIRKY.replace("* star bullet\n* another   with  spaces\n", ""));
  });

  it("keeps front matter, HTML, images and link definitions while other blocks change", () => {
    const page = parseMarkdownPage(QUIRKY);
    const out = serializeMarkdownPage(page, editText(page.doc.content!, "wrapped over", "now over"));
    expect(out.startsWith("---\ntitle: Quirky file\ntags: [a, b]\n---\n")).toBe(true);
    expect(out).toContain('<div align="center">\n  <img src="logo.png">\n</div>');
    expect(out).toContain('![Logo](images/logo.png "The logo")');
    expect(out).toContain("[docs]: https://example.com/docs");
    expect(out).toContain("Setext Title\n============");
    expect(out).toContain("now over two lines");
  });

  it("adds new blocks with blank lines around them", () => {
    const page = parseMarkdownPage("# Title\n\nFirst.\n\nLast.\n");
    const nodes = page.doc.content!;
    const added = [nodes[0], nodes[1], { type: "paragraph", content: [{ type: "text", text: "Middle." }] }, nodes[2]];
    expect(serializeMarkdownPage(page, added)).toBe("# Title\n\nFirst.\n\nMiddle.\n\nLast.\n");
  });

  it("removes deleted blocks and their blank line", () => {
    const page = parseMarkdownPage("# Title\n\nFirst.\n\nSecond.\n\nLast.\n");
    const nodes = page.doc.content!;
    expect(serializeMarkdownPage(page, [nodes[0], nodes[1], nodes[3]])).toBe("# Title\n\nFirst.\n\nLast.\n");
    expect(serializeMarkdownPage(page, [nodes[0], nodes[1], nodes[2]])).toBe("# Title\n\nFirst.\n\nSecond.\n");
  });

  it("writes a changed last block with a final newline", () => {
    const page = parseMarkdownPage("# Title\n\nEnd");
    expect(serializeMarkdownPage(page, editText(page.doc.content!, "End", "The end"))).toBe("# Title\n\nThe end\n");
  });

  it("shows every heading level and images inline", () => {
    const page = parseMarkdownPage("#### Four\n\n###### Six\n\nSee ![cat](cat.png).\n");
    const [h4, h6, p] = page.doc.content!;
    expect([h4.attrs?.level, h6.attrs?.level]).toEqual([4, 6]);
    expect(p.content?.find((n) => n.type === "image")?.attrs).toMatchObject({ src: "cat.png", alt: "cat" });
  });

  it("writes an edited block containing an image back with the image", () => {
    const page = parseMarkdownPage("See ![cat](cat.png \"Kitty\") here.\n");
    const out = serializeMarkdownPage(page, editText(page.doc.content!, "here", "there"));
    expect(out).toBe('See ![cat](cat.png "Kitty") there.\n');
  });
});
