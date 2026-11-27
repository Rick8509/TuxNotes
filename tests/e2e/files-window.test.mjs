// Files window (?window=files in the browser preview): tabs for opened text and code
// files, errors for files that can't be shown, read-only files, keyboard shortcuts.
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE_URL ?? "http://localhost:4173";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await b.newPage();
await page.setViewport({ width: 1100, height: 720 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failures++; };

const tabs = () => page.$$eval(".tab .name", (els) => els.map((e) => e.textContent.trim()));
const activeTab = () => page.evaluate(() => document.querySelector(".tab.active .name")?.textContent.trim() ?? null);
const lines = () => page.$$eval(".cm-content .cm-line", (els) => els.map((e) => e.textContent));
const status = () => page.evaluate(() => document.querySelector(".status")?.textContent.replace(/\s+/g, " ").trim() ?? "");
const clickTab = (name) => page.evaluate((name) => [...document.querySelectorAll(".tab")].find((t) => t.querySelector(".name").textContent.trim() === name).click(), name);
const ctrl = async (key, shift = false) => {
  await page.keyboard.down("Control"); if (shift) await page.keyboard.down("Shift");
  await page.keyboard.press(key);
  if (shift) await page.keyboard.up("Shift"); await page.keyboard.up("Control");
  await sleep(150);
};

await page.goto(BASE + "/icon.png");
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("tuxnotes-mock-files", JSON.stringify([
    { path: "/home/you/code/hello.py", text: "def greet(name):\n    print(f\"Hello, {name}!\")\n\ngreet(\"world\")\n" },
    { path: "/home/you/notes.txt", text: "first line\r\nsecond line\r\n" },
    { path: "/home/you/photo.bin", text: "" },
    { path: "/etc/hosts", text: "127.0.0.1 localhost\n" },
  ]));
});
await page.goto(BASE + "/?window=files", { waitUntil: "load" }); await sleep(800);

check("opened files appear as tabs", JSON.stringify(await tabs()) === JSON.stringify(["hello.py", "notes.txt", "photo.bin", "hosts"]), JSON.stringify(await tabs()));
check("the last opened file is active", (await activeTab()) === "hosts", await activeTab());
check("…and named in the window title", (await page.title()) === "hosts — TuxNotes", await page.title());
check("files you can't change say Read-only", (await status()).includes("Read-only"), await status());

await clickTab("hello.py"); await sleep(200);
check("a code file shows its text", JSON.stringify(await lines()) === JSON.stringify(["def greet(name):", '    print(f"Hello, {name}!")', "", 'greet("world")', ""]), JSON.stringify(await lines()));
check("…with line numbers", (await page.$$eval(".cm-lineNumbers .cm-gutterElement", (els) => els.map((e) => e.textContent).filter(Boolean))).includes("4"));
check("…and the path, encoding and line endings below", /\/home\/you\/code\/hello\.py.*UTF-8.*LF/.test(await status()), await status());
check("…and isn't read-only", !(await status()).includes("Read-only"));
check("…and can be edited (it isn't read-only)", await page.$eval(".cm-content", (e) => e.getAttribute("aria-readonly") !== "true" && e.contentEditable === "true"));

// The cursor position is kept per tab
await page.click(".cm-content .cm-line:nth-child(4)"); await sleep(100);
await clickTab("notes.txt"); await sleep(200);
check("switching tabs shows the other file", (await lines())[0] === "first line", JSON.stringify(await lines()));
check("…and its Windows line endings", (await status()).includes("CRLF"), await status());
await clickTab("hello.py"); await sleep(200);
check("coming back keeps the cursor line", await page.evaluate(() => document.querySelector(".cm-activeLine")?.textContent) === 'greet("world")', await page.evaluate(() => document.querySelector(".cm-activeLine")?.textContent));

// A file that isn't text
await clickTab("photo.bin"); await sleep(200);
check("a binary file shows a clear message", await page.evaluate(() => document.querySelector(".empty h2")?.textContent.includes("photo.bin") && document.querySelector(".empty p")?.textContent.includes("isn't a text file")));
await page.evaluate(() => [...document.querySelectorAll(".empty .btn")].find((b) => b.textContent === "Close Tab").click()); await sleep(150);
check("…and Close Tab closes it", !(await tabs()).includes("photo.bin"), JSON.stringify(await tabs()));

// Keyboard: Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+W; middle-click closes
await clickTab("hello.py"); await sleep(100);
await ctrl("Tab");
check("Ctrl+Tab goes to the next tab", (await activeTab()) === "notes.txt", await activeTab());
await ctrl("Tab", true); await ctrl("Tab", true);
check("Ctrl+Shift+Tab goes back, wrapping around", (await activeTab()) === "hosts", await activeTab());
await ctrl("w");
check("Ctrl+W closes the tab", JSON.stringify(await tabs()) === JSON.stringify(["hello.py", "notes.txt"]), JSON.stringify(await tabs()));
const notesTab = await page.evaluateHandle(() => [...document.querySelectorAll(".tab")].find((t) => t.textContent.includes("notes.txt")));
await notesTab.click({ button: "middle" }); await sleep(150);
check("middle-click closes a tab", JSON.stringify(await tabs()) === JSON.stringify(["hello.py"]), JSON.stringify(await tabs()));
await page.click('.tab.active .close'); await sleep(150);
check("the × closes the last tab", (await tabs()).length === 0);

// Empty window: Open File…
check("with no files, it invites you to open one", await page.evaluate(() => document.querySelector(".empty h2")?.textContent === "Open a text or code file"));
check("…the title is just the app's name", (await page.title()) === "TuxNotes", await page.title());
await page.evaluate(() => [...document.querySelectorAll(".empty .btn")].find((b) => b.textContent.startsWith("Open File")).click()); await sleep(400);
check("Open File… opens the chosen file in a tab", (await activeTab()) === "example.py" && (await lines())[0] === "def greet(name):", `${await activeTab()} ${JSON.stringify(await lines())}`);
await ctrl("o"); await sleep(300);
check("Ctrl+O works too (the same file isn't opened twice)", JSON.stringify(await tabs()) === '["example.py"]', JSON.stringify(await tabs()));

// The notes window offers Open File… in the ⋯ menu
await page.goto(BASE + "/", { waitUntil: "load" }); await sleep(600);
await page.click('button[aria-label="New note"]'); await sleep(300);
await page.click('button[aria-label="More actions"]'); await sleep(200);
check("the notes window has ⋯ → Open File…", await page.evaluate(() => [...document.querySelectorAll(".menu button")].some((b) => b.textContent.includes("Open File…"))));

console.log(`\n${failures ? failures + " FAILED" : "ALL PASSED"} | page errors: ${errors.length ? JSON.stringify(errors) : "none"}`);
await b.close();
process.exit(failures || errors.length ? 1 : 0);
