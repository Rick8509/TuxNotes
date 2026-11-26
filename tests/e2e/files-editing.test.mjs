// Files window editing: unsaved-changes dot, Ctrl+S / Save As, questions when closing,
// files changed or deleted by other programs, encodings that can't hold the text,
// read-only files, and unsaved edits surviving tab switches.
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE_URL ?? "http://localhost:4173";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await b.newPage();
await page.setViewport({ width: 1000, height: 700 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failures++; };

const tabs = () => page.$$eval(".tab .name", (els) => els.map((e) => e.textContent.trim()));
const activeTab = () => page.evaluate(() => document.querySelector(".tab.active .name")?.textContent.trim() ?? null);
const clickTab = async (name) => { await page.evaluate((name) => [...document.querySelectorAll(".tab")].find((t) => t.querySelector(".name").textContent.trim() === name).click(), name); await sleep(200); };
const isDirty = (name) => page.evaluate((name) => [...document.querySelectorAll(".tab")].find((t) => t.querySelector(".name").textContent.trim() === name)?.querySelector(".close.dirty") != null, name);
const docText = () => page.evaluate(() => [...document.querySelectorAll(".code-area:not(.hidden) .cm-content .cm-line")].map((l) => l.textContent).join("\n"));
const diskText = (path) => page.evaluate((path) => globalThis.__mockFileText(path), path);
const changeOnDisk = (path, text) => page.evaluate(({ path, text }) => globalThis.__mockFileChange(path, text), { path, text });
const checkDisk = async () => { await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await sleep(300); };
const dialog = () => page.evaluate(() => document.querySelector(".dialog h2")?.textContent ?? null);
const answer = async (label) => { await page.evaluate((label) => [...document.querySelectorAll(".dialog button")].find((b) => b.textContent === label).click(), label); await sleep(300); };
const banner = () => page.evaluate(() => document.querySelector(".code-area:not(.hidden) .banner")?.textContent.replace(/\s+/g, " ").trim() ?? null);
const status = () => page.evaluate(() => document.querySelector(".status")?.textContent.replace(/\s+/g, " ").trim() ?? "");
const ctrl = async (key, shift = false) => {
  await page.keyboard.down("Control"); if (shift) await page.keyboard.down("Shift");
  await page.keyboard.press(key);
  if (shift) await page.keyboard.up("Shift"); await page.keyboard.up("Control");
  await sleep(300);
};
const typeAtEnd = async (text) => {
  await page.click(".code-area:not(.hidden) .cm-content");
  await ctrl("End"); await page.keyboard.type(text); await sleep(150);
};

await page.goto(BASE + "/icon.png");
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("tuxnotes-mock-files", JSON.stringify([
    { path: "/home/you/notes.txt", text: "first line\n" },
    { path: "/home/you/old-windows.txt", text: "café\r\n", encoding: "Windows-1252" },
    { path: "/etc/hosts", text: "127.0.0.1 localhost\n" },
    { path: "/home/you/photo.bin", text: "" },
    { path: "/home/you/app.js", text: "const x = 1;\n" },
  ]));
});
await page.goto(BASE + "/?window=files", { waitUntil: "load" }); await sleep(900);

// Editing marks the tab and the title; Ctrl+S saves
await clickTab("notes.txt");
await typeAtEnd("second line");
check("editing marks the tab as unsaved", await isDirty("notes.txt"));
check("…and the window title", (await page.title()) === "● notes.txt — TuxNotes", await page.title());
await ctrl("s");
check("Ctrl+S saves", (await diskText("/home/you/notes.txt")) === "first line\nsecond line", JSON.stringify(await diskText("/home/you/notes.txt")));
check("…and clears the mark", !(await isDirty("notes.txt")) && (await page.title()) === "notes.txt — TuxNotes", await page.title());
await page.keyboard.type("!"); await sleep(100);
check("typing again marks it again", await isDirty("notes.txt"));
await page.keyboard.press("Backspace"); await sleep(150);
check("…and undoing the change by hand clears it", !(await isDirty("notes.txt")));

// Unsaved edits survive switching to a tab that can't be shown, and back
await typeAtEnd(" (draft)");
await clickTab("photo.bin");
check("a binary file's tab shows its message", await page.evaluate(() => document.querySelector(".empty h2")?.textContent.includes("photo.bin")));
await clickTab("notes.txt");
check("unsaved edits are still there after switching back", (await docText()).endsWith("second line (draft)") && (await isDirty("notes.txt")), await docText());

// Closing a tab with unsaved changes asks
await ctrl("w");
check("closing an unsaved tab asks first", (await dialog()) === "Save changes to “notes.txt”?", await dialog());
await answer("Cancel");
check("Cancel keeps the tab and the edits", (await tabs()).includes("notes.txt") && (await isDirty("notes.txt")));
await ctrl("w"); await answer("Save");
check("Save saves, then closes the tab", !(await tabs()).includes("notes.txt") && (await diskText("/home/you/notes.txt")).endsWith("(draft)"), JSON.stringify(await tabs()));

// Auto-closing brackets and Tab indent while editing code
await clickTab("app.js");
await typeAtEnd("\nfoo(");
check("brackets close themselves", (await docText()).endsWith("foo()"), JSON.stringify(await docText()));
await page.keyboard.press("End"); await page.keyboard.press("Enter"); await page.keyboard.press("Tab"); await page.keyboard.type("y"); await sleep(100);
check("Tab indents instead of leaving the editor", /\n(\s+|\t)y$/.test(await docText()) && (await page.evaluate(() => !!document.activeElement?.closest(".cm-content"))), JSON.stringify(await docText()));
await ctrl("w"); await answer("Don't Save");
check("Don't Save closes without saving", !(await tabs()).includes("app.js") && (await diskText("/home/you/app.js")) === "const x = 1;\n");

// Changed by another program while not edited: reloads by itself
await page.evaluate(() => { localStorage.setItem("tuxnotes-mock-files", "[]"); });
await clickTab("old-windows.txt");
await changeOnDisk("/home/you/old-windows.txt", "café\r\nadded elsewhere\r\n");
await checkDisk();
check("a file changed elsewhere reloads when it wasn't edited", (await docText()).includes("added elsewhere") && !(await isDirty("old-windows.txt")), await docText());

// Changed elsewhere while edited: asks, Keep Mine, then Save replaces it
await typeAtEnd("mine");
await changeOnDisk("/home/you/old-windows.txt", "theirs\r\n");
await checkDisk();
check("a file changed elsewhere while edited shows a choice", (await banner())?.includes("Another program changed"), await banner());
check("…and keeps my text meanwhile", (await docText()).endsWith("mine"));
await page.evaluate(() => [...document.querySelectorAll(".banner-btn")].find((b) => b.textContent === "Keep Mine").click()); await sleep(200);
check("Keep Mine hides the message", (await banner()) === null, await banner());
await ctrl("s");
check("…and Save then replaces their version without asking", (await dialog()) === null && (await diskText("/home/you/old-windows.txt")).endsWith("mine"), JSON.stringify(await diskText("/home/you/old-windows.txt")));
check("…keeping Windows line endings", (await diskText("/home/you/old-windows.txt")).includes("\r\n"), JSON.stringify(await diskText("/home/you/old-windows.txt")));

// Saving over a change not noticed yet asks first
await typeAtEnd(" again");
await changeOnDisk("/home/you/old-windows.txt", "theirs, newer\r\n");
await ctrl("s");
check("saving over a change made elsewhere asks first", (await dialog())?.includes("was changed by another program"), await dialog());
await answer("Cancel");
check("…Cancel leaves their version alone", (await diskText("/home/you/old-windows.txt")) === "theirs, newer\r\n");
await ctrl("s"); await answer("Save Anyway");
check("…Save Anyway saves mine", (await diskText("/home/you/old-windows.txt")).endsWith(" again"));

// Text the file's old encoding can't hold
await typeAtEnd(" 日本");
await ctrl("s");
check("characters Windows-1252 can't hold: asks to save as UTF-8", (await dialog()) === "Save “old-windows.txt” as UTF-8?", await dialog());
await answer("Save as UTF-8");
check("…and saves as UTF-8", (await status()).includes("UTF-8") && !(await status()).includes("Windows-1252") && (await diskText("/home/you/old-windows.txt")).endsWith("日本"), await status());

// Deleted by another program
await changeOnDisk("/home/you/old-windows.txt", null);
await checkDisk();
check("a deleted file says so", (await banner())?.includes("was deleted or moved"), await banner());
await typeAtEnd(".");
await ctrl("s");
check("…and Save creates it again", (await diskText("/home/you/old-windows.txt"))?.endsWith("日本.") && (await banner()) === null, await banner());

// Read-only file: can't be edited, Save becomes Save As
await clickTab("hosts");
await typeAtEnd("# nope");
check("a read-only file can't be changed", !(await docText()).includes("nope") && !(await isDirty("hosts")), await docText());
await ctrl("s");
check("Save on a read-only file saves a copy (Save As)", (await activeTab()) === "copy of hosts" && (await diskText("/home/you/Documents/copy of hosts")) === "127.0.0.1 localhost\n", `${await activeTab()} ${JSON.stringify(await diskText("/home/you/Documents/copy of hosts"))}`);
await typeAtEnd("# mine now");
check("…and the copy can be edited", (await docText()).endsWith("# mine now") && (await isDirty("copy of hosts")), await docText());
await ctrl("s", true);
check("Ctrl+Shift+S saves under another name too", (await activeTab()) === "copy of copy of hosts", await activeTab());

console.log(`\n${failures ? failures + " FAILED" : "ALL PASSED"} | page errors: ${errors.length ? JSON.stringify(errors) : "none"}`);
await b.close();
process.exit(failures || errors.length ? 1 : 0);
