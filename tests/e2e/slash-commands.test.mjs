// Slash commands: typing "/" opens a menu at the cursor that inserts blocks.
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE_URL ?? "http://localhost:4173";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await b.newPage();
await page.setViewport({ width: 1200, height: 760 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failures++; };

const menuOpen = () => page.evaluate(() => !!document.querySelector(".slash-menu"));
const items = () => page.$$eval(".slash-menu .item .title", (els) => els.map((e) => e.textContent.trim()));
const activeItem = () => page.evaluate(() => document.querySelector(".slash-menu .item.active .title")?.textContent.trim() ?? null);
const groups = () => page.$$eval(".slash-menu .group", (els) => els.map((e) => e.textContent.trim()));
/** The top-level block the cursor is in (the note always ends with an empty line). */
const lastBlock = () => page.evaluate(() => {
  const prose = document.querySelector(".prose");
  let el = getSelection().anchorNode;
  if (el?.nodeType === 3) el = el.parentElement;
  while (el && el.parentElement !== prose) el = el.parentElement;
  if (!el) return null;
  return { tag: el.tagName.toLowerCase(), type: el.dataset.type ?? null, text: el.textContent };
});
const proseText = () => page.$eval(".prose", (e) => e.textContent);
/** A new empty line at the end of the note. */
const newLine = async () => {
  // Click the note's last line (always a paragraph); start a new one if it has text.
  await page.click(".prose > p:last-child"); await sleep(60);
  await page.keyboard.press("End");
  if (await page.$eval(".prose > p:last-child", (p) => p.textContent !== "")) await page.keyboard.press("Enter");
  await sleep(80);
};

await page.goto(BASE + "/icon.png");
await page.evaluate(() => {
  localStorage.clear();
  const t = Date.now();
  const p = (x) => ({ type: "paragraph", content: [{ type: "text", text: x }] });
  localStorage.setItem("tuxnotes-mock-v1", JSON.stringify({
    folders: [{ id: "f0", name: "Notes", isDefault: true, parentId: null, sortOrder: 0, createdAt: t, updatedAt: t }],
    notes: [{ id: "a", folderId: "f0", title: "Slash", snippet: "", plain: "Slash", content: { type: "doc", content: [p("Slash")] }, isPinned: false, createdAt: t, updatedAt: t, deletedAt: null, isLocked: false }],
  }));
});
await page.goto(BASE + "/", { waitUntil: "load" }); await sleep(600);
await page.click('.note[data-id="a"]'); await sleep(250);
await page.click(".prose p:first-child"); await sleep(80);

// The empty line you're on says how to insert things
await newLine();
check("an empty line shows the hint", await page.evaluate(() => {
  const p = document.querySelector(".prose p.is-empty");
  return p?.dataset.placeholder === "Type / for commands" && getComputedStyle(p, "::before").content.includes("Type /");
}));

// "/" opens the menu with groups, the first item highlighted
await page.keyboard.type("/"); await sleep(150);
check("typing / opens the menu", await menuOpen());
check("…with groups", JSON.stringify(await groups()) === JSON.stringify(["Text", "Lists", "Insert", "Date and time"]), JSON.stringify(await groups()));
check("…and the first item highlighted", (await activeItem()) === "Body", await activeItem());
check("…pointed at for screen readers", await page.evaluate(() => document.querySelector(".prose").getAttribute("aria-activedescendant") === "slash-item-body"));

// Typing filters; Enter inserts and removes the typed "/check"
await page.keyboard.type("check"); await sleep(120);
check("typing filters the menu", (await items())[0] === "Checklist", JSON.stringify(await items()));
check("…and marks the typed letters", await page.evaluate(() => document.querySelector(".slash-menu .item.active mark")?.textContent === "Check"));
await page.keyboard.press("Enter"); await sleep(150);
check("Enter closes the menu", !(await menuOpen()));
check("…and makes a checklist", (await lastBlock()).type === "taskList", JSON.stringify(await lastBlock()));
check("…without the typed /check", !(await proseText()).includes("/check"), await proseText());
await page.keyboard.type("Milk"); await sleep(80);
check("the cursor is in the new checklist item", (await lastBlock()).type === "taskList" && (await lastBlock()).text.endsWith("Milk"), JSON.stringify(await lastBlock()));
await page.keyboard.press("Enter"); await page.keyboard.press("Enter"); await sleep(80); // leave the checklist

// Abbreviations, arrows and Tab
await newLine();
await page.keyboard.type("/hr"); await sleep(120);
check("“hr” finds Divider", (await activeItem()) === "Divider", await activeItem());
await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace"); await sleep(100);
check("Backspace shows the whole list again", (await items()).length > 10, String((await items()).length));
await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown"); await sleep(80);
check("arrow down moves the highlight", (await activeItem()) === "Heading", await activeItem());
await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp"); await sleep(80);
check("arrow up wraps to the end", (await activeItem()) === "Date and Time", await activeItem());
await page.keyboard.type("subh"); await sleep(100);
await page.keyboard.press("Tab"); await sleep(150);
check("Tab inserts too (Subheading)", (await lastBlock()).tag === "h3", JSON.stringify(await lastBlock()));
await page.keyboard.type("Section"); await page.keyboard.press("Enter"); await sleep(80);

// Arrow keys with the mouse resting on the menu: the highlight must follow the keys,
// not jump to the item under the (unmoved) pointer when the list scrolls.
await newLine();
await page.keyboard.type("/"); await sleep(150);
const box = await page.$eval(".slash-menu .list", (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 20 }; });
await page.mouse.move(box.x, box.y); await sleep(80);
const seen = [];
// WebKitGTK (the engine TuxNotes runs on) sends "fake" mousemove events at the unmoved
// pointer after scrolling or layout changes; headless Chrome doesn't, so send them here.
const fakeMouseMove = () => page.evaluate(({ x, y }) => {
  document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
}, box);
for (let i = 0; i < 9; i++) {
  await page.keyboard.press("ArrowDown"); await sleep(60);
  await fakeMouseMove(); await sleep(30);
  seen.push(await activeItem());
}
const expected = ["Title", "Heading", "Subheading", "Monospaced", "Quote", "Checklist", "Bulleted List", "Numbered List", "Table"];
check("with the mouse on the menu, ↓ still moves one item at a time", JSON.stringify(seen) === JSON.stringify(expected), JSON.stringify(seen));
await page.mouse.move(box.x, box.y + 40); await sleep(80);
check("…while moving the mouse still highlights the item under it", (await activeItem()) !== "Table", await activeItem());
await page.keyboard.press("Escape"); await sleep(80);
await page.mouse.move(5, 5);
await page.keyboard.press("Backspace"); await sleep(60);

// Escape closes and keeps the text; the menu stays closed while typing on
await page.keyboard.type("/ta"); await sleep(120);
await page.keyboard.press("Escape"); await sleep(120);
check("Escape closes the menu", !(await menuOpen()));
check("…and keeps what was typed", (await lastBlock()).text === "/ta", JSON.stringify(await lastBlock()));
await page.keyboard.type("b"); await sleep(120);
check("…and it stays closed while typing on", !(await menuOpen()));
await page.keyboard.press("Enter"); await sleep(80);

// No matches: a message, and Enter makes a new line as usual
await page.keyboard.type("/zzzq"); await sleep(120);
check("no matches shows a message", await page.evaluate(() => document.querySelector(".slash-menu .empty")?.textContent.includes("zzzq")));
await page.keyboard.press("Enter"); await sleep(120);
check("…and Enter then just starts a new line", !(await menuOpen()) && (await lastBlock()).text === "", JSON.stringify(await lastBlock()));

// Mouse: hover highlights, click inserts
await page.keyboard.type("/tab"); await sleep(150);
const tableItem = await page.$('.slash-menu .item[data-id="table"]');
await tableItem.hover(); await sleep(60);
await tableItem.click(); await sleep(200);
check("clicking an item inserts it (table)", await page.evaluate(() => !!document.querySelector(".prose table")));
check("…and the note keeps the focus", await page.evaluate(() => !!document.activeElement?.closest(".prose")));
await page.keyboard.type("/"); await sleep(120);
check("inside a table, Table and Divider aren't offered", await page.evaluate(() => !document.querySelector('.slash-menu [data-id="table"]') && !document.querySelector('.slash-menu [data-id="divider"]')));
await page.keyboard.press("Escape"); await sleep(100);

// Not in the middle of words or web addresses, not in code
await newLine();
await page.keyboard.type("and/or https://example.com/a"); await sleep(120);
check("no menu in the middle of a word or address", !(await menuOpen()));
await page.keyboard.press("Enter");
await page.keyboard.type("```"); await page.keyboard.press("Enter"); await sleep(80);
await page.keyboard.type("cd /usr/bin"); await sleep(120);
check("no menu inside a code block", !(await menuOpen()) && (await lastBlock()).tag === "pre", JSON.stringify(await lastBlock()));

// Dates are inserted as text
await newLine();
await page.keyboard.type("Due /today"); await sleep(120);
await page.keyboard.press("Enter"); await sleep(120);
const year = String(new Date().getFullYear());
check("“today” inserts the date after the text", (await lastBlock()).text.startsWith("Due ") && (await lastBlock()).text.includes(year), JSON.stringify(await lastBlock()));

// Clicking elsewhere closes the menu
await page.keyboard.press("Enter");
await page.keyboard.type("/"); await sleep(120);
await page.click(".search input"); await sleep(150);
check("clicking outside the note closes the menu", !(await menuOpen()));

// Saved as real content
await sleep(1200);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("tuxnotes-mock-v1")).notes[0].content);
const types = JSON.stringify(saved).match(/"type":"(taskList|heading|table|codeBlock)"/g) ?? [];
check("the note is saved with what was inserted", ["taskList", "heading", "table", "codeBlock"].every((t) => types.some((x) => x.includes(t))), JSON.stringify(types));

console.log(`\n${failures ? failures + " FAILED" : "ALL PASSED"} | page errors: ${errors.length ? JSON.stringify(errors) : "none"}`);
await b.close();
process.exit(failures || errors.length ? 1 : 0);
