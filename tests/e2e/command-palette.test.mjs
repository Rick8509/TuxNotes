// Ctrl+Shift+P: the command palette finds actions ("export pdf", "dark"), folders and
// notes (by title or by words inside), runs them with Enter, and moves a note to a folder
// in a second step. Escape closes it and puts the cursor back.
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE_URL ?? "http://localhost:4173";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await b.newPage();
await page.setViewport({ width: 1200, height: 800 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failures++; };

const isOpen = () => page.evaluate(() => !!document.querySelector(".palette"));
const open = async () => {
  await page.keyboard.down("Control"); await page.keyboard.down("Shift");
  await page.keyboard.press("P");
  await page.keyboard.up("Shift"); await page.keyboard.up("Control");
  await sleep(250);
};
const search = async (text) => {
  await page.evaluate(() => { const i = document.querySelector(".palette input"); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.keyboard.type(text); await sleep(400);
};
const active = () => page.evaluate(() => document.querySelector(".palette .item.active .title")?.textContent.trim() ?? null);
const groups = () => page.evaluate(() => [...document.querySelectorAll(".palette .group")].map((g) => g.textContent.trim()));
const titles = () => page.evaluate(() => [...document.querySelectorAll(".palette .item .title")].map((t) => t.textContent.trim()));
const currentTitle = () => page.evaluate(() => document.querySelector(".prose h1, .prose p")?.textContent ?? null);
const listTitles = () => page.evaluate(() => [...document.querySelectorAll(".note-list .title, .list .title")].map((t) => t.textContent.trim()));

await page.goto(BASE + "/icon.png");
await page.evaluate(() => {
  localStorage.clear();
  const t = Date.now();
  const f = (id, name, parentId = null, isDefault = false) => ({ id, name, isDefault, parentId, sortOrder: 1, createdAt: t, updatedAt: t });
  const n = (id, folderId, title, body, ago) => ({
    id, folderId, title, snippet: body, plain: `${title}\n${body}`,
    content: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] }, { type: "paragraph", content: [{ type: "text", text: body }] }] },
    isPinned: false, createdAt: t - ago, updatedAt: t - ago, deletedAt: null, isLocked: false,
  });
  localStorage.setItem("tuxnotes-mock-v1", JSON.stringify({
    folders: [f("f0", "Notes", null, true), f("work", "Work"), f("proj", "Projects", "work")],
    notes: [
      n("shop", "f0", "Shopping list", "milk and bread", 1000),
      n("trip", "f0", "Trip to Lisbon", "pack sunscreen", 60_000),
      n("plan", "proj", "Project plan", "milestones", 120_000),
    ],
  }));
});
await page.goto(BASE + "/", { waitUntil: "load" }); await sleep(700);
await page.click(".prose"); await sleep(150);

// Opening
await open();
check("Ctrl+Shift+P opens the palette, ready to type", (await isOpen()) && (await page.evaluate(() => document.activeElement?.matches(".palette input"))));
check("…with recent notes and all actions", JSON.stringify(await groups()) === '["Recent Notes","Actions"]' && (await titles()).includes("Export as PDF…"), JSON.stringify(await groups()));
check("…the open note isn't in Recent Notes", !(await titles()).slice(0, 2).includes("Shopping list"), JSON.stringify((await titles()).slice(0, 3)));
await page.keyboard.press("Escape"); await sleep(250);
check("Escape closes it and the cursor is back in the note", !(await isOpen()) && (await page.evaluate(() => !!document.activeElement?.closest(".prose"))));
await open(); await open();
check("Ctrl+Shift+P again closes it", !(await isOpen()));

// Actions
await open();
await search("export pdf");
check("'export pdf' finds Export as PDF first", (await active()) === "Export as PDF…", JSON.stringify(await titles()));
await search("dark");
check("'dark' finds the dark appearance", (await active()) === "Use Dark Appearance", JSON.stringify(await titles()));
await page.keyboard.press("Enter"); await sleep(300);
check("Enter does it and closes the palette", !(await isOpen()) && (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
await open();
await search("dark");
check("…and it's no longer offered once on", !(await titles()).includes("Use Dark Appearance"), JSON.stringify(await titles()));
await search("light");
await page.keyboard.press("Enter"); await sleep(300);

// ↑/↓
await open(); await search("note");
const first = await active();
await page.keyboard.press("ArrowDown"); await sleep(100);
const second = await active();
await page.keyboard.press("ArrowUp"); await sleep(100);
check("↓ and ↑ move through the results", first && second && first !== second && (await active()) === first, `${first} / ${second}`);
await page.keyboard.press("Escape"); await sleep(200);

// Notes, by title and by words inside
await open(); await search("lisbon");
check("a note's title finds it, ahead of actions", (await groups())[0] === "Notes" && (await active()) === "Trip to Lisbon", JSON.stringify(await groups()));
check("…shown with its folder", await page.evaluate(() => document.querySelector(".palette .item.active .sub")?.textContent.startsWith("Notes")));
await page.keyboard.press("Enter"); await sleep(500);
check("Enter opens the note", (await currentTitle()) === "Trip to Lisbon", await currentTitle());
await open(); await search("milestones");
check("words inside a note find it too", (await titles()).includes("Project plan"), JSON.stringify(await titles()));
await page.keyboard.press("Escape"); await sleep(200);

// Folders
await open(); await search("projects");
check("folders are found, with their path", (await active()) === "Projects" && (await page.evaluate(() => document.querySelector(".palette .item.active .sub")?.textContent)) === "Work › Projects", JSON.stringify(await titles()));
await page.keyboard.press("Enter"); await sleep(400);
check("Enter shows that folder", await page.evaluate(() => [...document.querySelectorAll(".sidebar .row.active .name")].some((n) => n.textContent.trim() === "Projects")));

// Move the open note to a folder: the second step
await open(); await search("lisbon"); await page.keyboard.press("Enter"); await sleep(500);
await open(); await search("move");
check("'move' finds Move Note to Folder…", (await active()) === "Move Note to Folder…", JSON.stringify(await titles()));
await page.keyboard.press("Enter"); await sleep(250);
check("…which asks for the folder in the same box", (await isOpen()) && (await page.evaluate(() => document.querySelector(".palette input").placeholder)) === "Move “Trip to Lisbon” to which folder?" && JSON.stringify(await groups()) === '["Move to"]');
check("…without the folder it's in", !(await titles()).includes("Notes") && (await titles()).includes("Work"), JSON.stringify(await titles()));
await page.keyboard.press("Backspace"); await sleep(200);
check("Backspace goes back to everything", JSON.stringify(await groups()) === '["Recent Notes","Actions"]', JSON.stringify(await groups()));
await search("move"); await page.keyboard.press("Enter"); await sleep(250);
await page.keyboard.type("wor"); await sleep(250);
await page.keyboard.press("Enter"); await sleep(500);
const folderOf = await page.evaluate(async () => JSON.parse(localStorage.getItem("tuxnotes-mock-v1")).notes.find((n) => n.id === "trip").folderId);
check("Enter moves the note there", !(await isOpen()) && folderOf === "work", folderOf);

// New note, find in note, settings
await open(); await search("new note"); await page.keyboard.press("Enter"); await sleep(500);
await page.keyboard.type("Made from the palette"); await sleep(600);
check("New Note: a new note, ready to type in", (await currentTitle()) === "Made from the palette", await currentTitle());
await open(); await search("find in"); await page.keyboard.press("Enter"); await sleep(400);
check("Find in Note opens the find bar", await page.evaluate(() => !!document.querySelector(".find-bar")));
await page.keyboard.press("Escape"); await sleep(200);
await open(); await search("shortcuts"); await page.keyboard.press("Enter"); await sleep(400);
check("Keyboard Shortcuts opens them in Settings, listing the palette", await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Settings"]')?.textContent.includes("Ctrl+Shift+P")));
await page.keyboard.press("Escape"); await sleep(300);
check("the palette doesn't open over Settings", await (async () => { await page.click('button[aria-label="Settings"]'); await sleep(200); await open(); const o = await isOpen(); await page.keyboard.press("Escape"); await sleep(200); return !o; })());

// Nothing found; mouse
await open(); await search("zzqx");
check("nothing found says so", await page.evaluate(() => document.querySelector(".palette .empty")?.textContent.includes("Nothing matches “zzqx”")));
await search("print");
await page.evaluate(() => document.querySelector(".scrim").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))); await sleep(250);
check("clicking outside closes it", !(await isOpen()));
await open(); await search("about");
await page.evaluate(() => [...document.querySelectorAll(".palette .item")].find((i) => i.textContent.includes("About TuxNotes")).click()); await sleep(400);
check("clicking an action does it", await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Settings"]')?.textContent.includes("About") ?? false));

console.log(`\n${failures ? failures + " FAILED" : "ALL PASSED"} | page errors: ${errors.length ? JSON.stringify(errors) : "none"}`);
await b.close();
process.exit(failures || errors.length ? 1 : 0);
