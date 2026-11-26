// Markdown files in the Files window: a formatted page you can edit, or the Markdown
// text; edits change only the blocks you touched, everything else stays as written.
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE_URL ?? "http://localhost:4173";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await b.newPage();
await page.setViewport({ width: 1100, height: 800 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failures++; };

const README = [
  "---",
  "title: Demo",
  "---",
  "",
  "Project Title",
  "=============",
  "",
  "* first   item",
  "* second item",
  "",
  "Some *emphasis* here,",
  "wrapped over two lines.",
  "",
  "| a | b |",
  "|---|:-:|",
  "| 1 | 2 |",
  "",
  '<p align="center">centred</p>',
  "",
  "`".repeat(3) + "bash",
  "echo hello",
  "`".repeat(3),
  "",
  "![Logo](img/logo.png)",
  "",
  "Last paragraph.",
  "",
].join("\n");

const clickTab = async (name) => { await page.evaluate((name) => [...document.querySelectorAll(".tab")].find((t) => t.querySelector(".name").textContent.trim() === name).click(), name); await sleep(300); };
const status = () => page.evaluate(() => document.querySelector(".status")?.textContent.replace(/\s+/g, " ").trim() ?? "");
const isDirty = () => page.evaluate(() => !!document.querySelector(".tab.active .close.dirty"));
const diskText = (path) => page.evaluate((path) => globalThis.__mockFileText(path), path);
const sourceText = () => page.evaluate(() => [...document.querySelectorAll(".code-area .cm-content .cm-line")].map((l) => l.textContent).join("\n"));
const view = (label) => page.evaluate((label) => [...document.querySelectorAll(".view-switch button")].find((b) => b.textContent.trim() === label)?.click(), label);
const ctrl = async (key, shift = false) => {
  await page.keyboard.down("Control"); if (shift) await page.keyboard.down("Shift");
  await page.keyboard.press(key);
  if (shift) await page.keyboard.up("Shift"); await page.keyboard.up("Control");
  await sleep(300);
};

await page.goto(BASE + "/icon.png");
await page.evaluate((README) => {
  localStorage.clear();
  localStorage.setItem("tuxnotes-mock-files", JSON.stringify([
    { path: "/home/you/project/README.md", text: README },
    { path: "/home/you/project/main.py", text: "print('hi')\n" },
    { path: "/etc/doc/readonly.md", text: "# Read only\n\nCan't change this.\n" },
  ]));
}, README);
await page.goto(BASE + "/?window=files", { waitUntil: "load" }); await sleep(900);
await clickTab("README.md");

// Formatted by default
check("a Markdown file opens as a formatted page", await page.evaluate(() => document.querySelector(".md-page .prose h1")?.textContent === "Project Title"), await page.evaluate(() => document.querySelector(".md-page .prose")?.innerHTML.slice(0, 120)));
check("…with lists, tables and emphasis", await page.evaluate(() => {
  const p = document.querySelector(".md-page .prose");
  return p.querySelectorAll("ul li").length === 2 && !!p.querySelector("table td") && p.querySelector("em")?.textContent === "emphasis";
}));
check("…code blocks too (with their bar)", await page.evaluate(() => document.querySelector(".md-page .code-block code")?.textContent === "echo hello" && !!document.querySelector(".md-page .code-block-bar")));
check("…images as a chip", await page.evaluate(() => document.querySelector(".md-page .md-image")?.textContent.includes("Logo")));
check("…front matter in a box, not in the page", await page.evaluate(() => document.querySelector(".front-matter pre")?.textContent === "---\ntitle: Demo\n---" && !document.querySelector(".md-page .prose").textContent.includes("title: Demo")));
check("the status bar offers Formatted | Markdown", /Formatted\s*Markdown/.test(await status()) && !(await status()).includes("Ln "), await status());

// Nothing changes by just looking
await sleep(400);
check("opening it doesn't count as a change", !(await isDirty()));

// Edit one paragraph
await page.evaluate(() => {
  const p = [...document.querySelectorAll(".md-page .prose p")].find((x) => x.textContent === "Last paragraph.");
  const range = document.createRange(); range.setStart(p.firstChild, p.firstChild.length); range.collapse(true);
  getSelection().removeAllRanges(); getSelection().addRange(range);
  p.closest(".prose").focus();
});
await page.keyboard.type(" Edited!"); await sleep(400);
check("editing the page marks the file as changed", await isDirty());
await view("Markdown"); await sleep(400);
const expected = README.replace("Last paragraph.", "Last paragraph. Edited!");
check("the Markdown view shows the file with only that paragraph changed", (await sourceText()) === expected, JSON.stringify(await sourceText()).slice(0, 300));
check("…and the usual text tools", (await status()).includes("Ln ") && (await status()).includes("Markdown"), await status());
await ctrl("s");
check("saving writes only that change (front matter, bullets, table, HTML untouched)", (await diskText("/home/you/project/README.md")) === expected, JSON.stringify(await diskText("/home/you/project/README.md")).slice(0, 300));
check("…and clears the mark", !(await isDirty()));

// Edits in the text view show in the formatted page
await page.click(".code-area .cm-content"); await ctrl("End");
await page.keyboard.type("\n## Added in text"); await sleep(200);
await view("Formatted"); await sleep(400);
check("text edits show in the formatted page", await page.evaluate(() => [...document.querySelectorAll(".md-page .prose h2")].some((h) => h.textContent === "Added in text")));
check("Ctrl+Shift+M switches views", await (async () => { await ctrl("m", true); const t = await page.evaluate(() => !document.querySelector(".md-page")); await ctrl("m", true); return t && (await page.evaluate(() => !!document.querySelector(".md-page"))); })());
await ctrl("s");

// Remembered, other files unaffected, read-only files
await view("Markdown"); await sleep(200);
await page.reload({ waitUntil: "load" }); await sleep(900);
await clickTab("README.md");
check("the chosen view is remembered", await page.evaluate(() => !document.querySelector(".md-page") && !!document.querySelector(".code-area .cm-content")));
await view("Formatted"); await sleep(300);
await clickTab("main.py");
check("other files have no view switch", !(await status()).includes("Formatted"), await status());
await clickTab("readonly.md");
check("a read-only Markdown file shows formatted but can't be changed", await page.evaluate(() => document.querySelector(".md-page .prose")?.getAttribute("contenteditable") === "false"));

// Changed on disk while shown formatted
await clickTab("README.md");
await page.evaluate(() => globalThis.__mockFileChange("/home/you/project/README.md", "# Replaced elsewhere\n\nNew text.\n"));
await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await sleep(600);
check("a change made elsewhere shows in the formatted page", await page.evaluate(() => document.querySelector(".md-page .prose h1")?.textContent === "Replaced elsewhere"), await page.evaluate(() => document.querySelector(".md-page .prose h1")?.textContent));
check("…without counting as my change", !(await isDirty()));

console.log(`\n${failures ? failures + " FAILED" : "ALL PASSED"} | page errors: ${errors.length ? JSON.stringify(errors) : "none"}`);
await b.close();
process.exit(failures || errors.length ? 1 : 0);
