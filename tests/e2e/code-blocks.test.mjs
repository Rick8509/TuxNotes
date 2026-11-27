// Code blocks in notes: syntax colours, the language picker (with Auto-detect), Copy,
// no spell checking, and read-only notes.
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE_URL ?? "http://localhost:4173";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
await b.defaultBrowserContext().overridePermissions(new URL(BASE).origin, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
const page = await b.newPage();
await page.setViewport({ width: 1200, height: 800 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failures++; };

const FENCE = "`".repeat(3);
const language = () => page.$eval(".code-block .code-block-language", (s) => s.value);
const autoLabel = (i = 0) => page.evaluate((i) => document.querySelectorAll('.code-block .code-block-language option[value=""]')[i]?.textContent ?? null, i);
const savedBlock = () => page.evaluate(() => {
  const n = JSON.parse(localStorage.getItem("tuxnotes-mock-v1")).notes[0].content;
  return n.content.find((b) => b.type === "codeBlock") ?? null;
});
const colorOf = (text) => page.evaluate((text) => {
  const span = [...document.querySelectorAll(".code-block code span")].find((s) => s.textContent === text);
  return span ? getComputedStyle(span).color : null;
}, text);
const plainColor = () => page.evaluate(() => getComputedStyle(document.querySelector(".code-block code")).color);

await page.goto(BASE + "/icon.png");
await page.evaluate(() => {
  localStorage.clear();
  const t = Date.now();
  localStorage.setItem("tuxnotes-mock-v1", JSON.stringify({
    folders: [{ id: "f0", name: "Notes", isDefault: true, parentId: null, sortOrder: 0, createdAt: t, updatedAt: t }],
    notes: [{ id: "a", folderId: "f0", title: "Snippets", snippet: "", plain: "Snippets", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Snippets" }] }, { type: "paragraph" }] }, isPinned: false, createdAt: t, updatedAt: t, deletedAt: null, isLocked: false }],
  }));
});
await page.goto(BASE + "/", { waitUntil: "load" }); await sleep(600);
await page.click('.note[data-id="a"]'); await sleep(250);
await page.click(".prose > p:last-child"); await sleep(100);

// A fence with "python" starts a Python code block
await page.keyboard.type(FENCE + "python "); await sleep(150);
await page.keyboard.type("def greet(name):"); await page.keyboard.press("Enter");
await page.keyboard.type("    return 'Hello ' + name  # say hi"); await sleep(400);
check("a python fence makes a Python code block", (await language()) === "python", await language());
check("…and the language can be changed (the note is editable)", await page.$eval(".code-block .code-block-language", (s) => !s.disabled));
check("…with a bar: language and Copy", await page.evaluate(() => !!document.querySelector(".code-block-bar .code-block-copy") && document.querySelector(".code-block-bar").contentEditable === "false"));
const kw = await colorOf("def"), str = await colorOf("'Hello '"), com = await colorOf("# say hi");
check("keywords, strings and comments are coloured", kw && str && com && new Set([kw, str, com, await plainColor()]).size === 4, JSON.stringify({ kw, str, com }));
check("…the text went into the code, not the bar", (await page.$eval(".code-block code", (c) => c.textContent)) === "def greet(name):\n    return 'Hello ' + name  # say hi");
check("code isn't spell checked", await page.$eval(".code-block code", (c) => c.spellcheck === false));
await sleep(1200);
check("the language is saved with the note", (await savedBlock())?.attrs?.language === "python", JSON.stringify((await savedBlock())?.attrs));

// The picker
const options = await page.$$eval(".code-block .code-block-language option:not([hidden])", (os) => os.map((o) => o.textContent));
check("the picker lists languages by name", options.includes("Plain text") && options.includes("JavaScript") && options.includes("C++") && options.length > 30, `${options.length}: ${options.slice(0, 6).join(", ")}`);
await page.select(".code-block .code-block-language", "javascript"); await sleep(1300);
check("choosing JavaScript changes the language", (await savedBlock())?.attrs?.language === "javascript", JSON.stringify((await savedBlock())?.attrs));
await page.select(".code-block .code-block-language", ""); await sleep(1300);
check("Auto-detect clears it", (await savedBlock())?.attrs?.language === null, JSON.stringify((await savedBlock())?.attrs));
check("…and shows what it detected", /^Auto-detect \(.+\)$/.test(await autoLabel()), await autoLabel());
await page.select(".code-block .code-block-language", "plaintext"); await sleep(300);
check("Plain text removes the colours", (await colorOf("def")) === null || (await colorOf("def")) === (await plainColor()));
await page.select(".code-block .code-block-language", "python"); await sleep(300);

// Copy
await page.click(".code-block .code-block-copy"); await sleep(200);
check("Copy puts the code on the clipboard", (await page.evaluate(() => navigator.clipboard.readText())) === "def greet(name):\n    return 'Hello ' + name  # say hi");
check("…and says so", (await page.$eval(".code-block .code-block-copy", (b) => b.textContent)) === "Copied");

// A note opened later: its code blocks can be changed too
await page.click('.note[data-id="a"]'); await sleep(100);
await page.reload({ waitUntil: "load" }); await sleep(700);
await page.click('.note[data-id="a"]'); await sleep(400);
check("after reopening the note, the language can still be changed", await page.$eval(".code-block .code-block-language", (s) => !s.disabled));

// Slash command
await page.click(".prose > p:last-child"); await sleep(100);
await page.keyboard.type("/code"); await sleep(200);
check("the slash menu calls it Code Block", await page.evaluate(() => document.querySelector(".slash-menu .item.active .title")?.textContent.trim() === "Code Block"));
await page.keyboard.press("Enter"); await sleep(200);
check("…and makes one with the bar", (await page.$$(".code-block")).length === 2);
await page.keyboard.type("SELECT name, email FROM users WHERE id = 1 ORDER BY name;"); await sleep(700);
check("unlabelled code is detected (SQL)", (await autoLabel(1))?.includes("SQL"), await autoLabel(1));

// Read-only notes: no changing the language
await sleep(1200);
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Delete note")?.click()); await sleep(600);
await page.evaluate(() => [...document.querySelectorAll(".sidebar .row")].find((r) => r.textContent.includes("Recently Deleted"))?.click()); await sleep(400);
await page.click('.note[data-id="a"]'); await sleep(300);
check("in a read-only note the language can't be changed", await page.$eval(".code-block .code-block-language", (s) => s.disabled));
check("…but Copy still works", await page.$eval(".code-block .code-block-copy", (b) => !b.disabled));

console.log(`\n${failures ? failures + " FAILED" : "ALL PASSED"} | page errors: ${errors.length ? JSON.stringify(errors) : "none"}`);
await b.close();
process.exit(failures || errors.length ? 1 : 0);
