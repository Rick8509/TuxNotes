// Files window code view: syntax colours by language, the language picker, word wrap,
// cursor position, indentation and folding.
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

const status = () => page.evaluate(() => document.querySelector(".status")?.textContent.replace(/\s+/g, " ").trim() ?? "");
const clickTab = (name) => page.evaluate((name) => [...document.querySelectorAll(".tab")].find((t) => t.querySelector(".name").textContent.trim() === name).click(), name);
/** The colour of the first piece of code with this exact text. */
const colorOf = (text) => page.evaluate((text) => {
  const span = [...document.querySelectorAll(".cm-content span")].find((s) => s.textContent === text);
  return span ? getComputedStyle(span).color : null;
}, text);
const plainColor = () => page.evaluate(() => getComputedStyle(document.querySelector(".cm-content")).color);

const longLine = "x = " + "'word' + ".repeat(60) + "'end'";
await page.goto(BASE + "/icon.png");
await page.evaluate((longLine) => {
  localStorage.clear();
  localStorage.setItem("tuxnotes-mock-files", JSON.stringify([
    { path: "/home/you/app.py", text: `import os\n\n\ndef main():\n    if True:\n        print("hi")\n    return 42\n\n${longLine}\n` },
    { path: "/home/you/backup", text: "#!/bin/bash\n# copy everything\nrsync -a ~/notes /mnt/usb\n" },
    { path: "/home/you/todo.txt", text: "buy milk\n\tand bread\n\tand eggs\n" },
    { path: "/home/you/site/index.html", text: "<!doctype html>\n<p class=\"intro\">Hello</p>\n" },
  ]));
}, longLine);
await page.goto(BASE + "/?window=files", { waitUntil: "load" }); await sleep(900);

// Python: detected, coloured
await clickTab("app.py"); await sleep(600);
check("the language is detected from the file name", (await status()).includes("Python"), await status());
const kw = await colorOf("def"), str = await colorOf('"hi"'), num = await colorOf("42");
check("keywords, strings and numbers get their own colours", kw && str && num && new Set([kw, str, num, await plainColor()]).size === 4, JSON.stringify({ kw, str, num }));
check("indentation is shown (4 spaces)", (await status()).includes("Spaces: 4"), await status());
check("folding markers appear for blocks", await page.evaluate(() => [...document.querySelectorAll(".cm-foldGutter .cm-gutterElement")].some((e) => e.textContent.trim() === "⌄")));

// Cursor position and selection in the status bar
await page.click(".cm-content .cm-line:nth-child(6)"); await page.keyboard.press("End"); await sleep(100);
check("the cursor line and column are shown", /Ln 6, Col 20/.test(await status()), await status());
await page.keyboard.down("Shift"); await page.keyboard.press("Home"); await page.keyboard.up("Shift"); await sleep(100);
check("…and how much is selected", /\(\d+ selected\)/.test(await status()), await status());

// Word wrap: off by default, Alt+Z or the Wrap button, remembered
const lineHeight = () => page.evaluate(() => [...document.querySelectorAll(".cm-line")].find((l) => l.textContent.startsWith("x = "))?.getBoundingClientRect().height);
const oneLine = await lineHeight();
await page.keyboard.down("Alt"); await page.keyboard.press("z"); await page.keyboard.up("Alt"); await sleep(200);
check("Alt+Z wraps long lines", (await lineHeight()) > oneLine * 2, `${oneLine} → ${await lineHeight()}`);
check("…and the Wrap button shows it's on", await page.evaluate(() => document.querySelector('.status-btn[aria-pressed="true"]')?.textContent.includes("Wrap")));
await clickTab("todo.txt"); await sleep(200); await clickTab("app.py"); await sleep(200);
check("wrap stays on when switching tabs", (await lineHeight()) > oneLine * 2);
await page.reload({ waitUntil: "load" }); await sleep(900);
await clickTab("app.py"); await sleep(400);
check("…and after reopening the window", (await lineHeight()) > oneLine * 2);
await page.evaluate(() => [...document.querySelectorAll(".status-btn")].find((b) => b.textContent.includes("Wrap")).click()); await sleep(200);
check("the Wrap button turns it off again", Math.abs((await lineHeight()) - oneLine) < 2);

// Scripts without an extension: the first line
await clickTab("backup"); await sleep(500);
check("a script is recognized by its first line (#!/bin/bash)", (await status()).includes("Shell"), await status());
check("…and coloured (comment)", (await colorOf("# copy everything")) !== (await plainColor()));

// Plain text, tabs
await clickTab("todo.txt"); await sleep(300);
check("plain text stays plain", (await status()).includes("Plain Text"), await status());
check("…indented with tabs", (await status()).includes("Tabs"), await status());

// The language picker
await page.evaluate(() => [...document.querySelectorAll(".status-btn")].find((b) => b.textContent.includes("Plain Text")).click()); await sleep(200);
check("the language button opens a searchable list", await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Search languages" && document.querySelectorAll(".picker .item").length > 100));
await page.keyboard.type("pyth"); await sleep(150);
check("typing filters it", await page.evaluate(() => document.querySelector(".picker .item.active")?.textContent.trim() === "Python"), await page.evaluate(() => document.querySelector(".picker .item.active")?.textContent.trim()));
await page.keyboard.press("Enter"); await sleep(500);
check("Enter picks it", (await status()).includes("Python") && !(await page.$(".picker")), await status());
await page.evaluate(() => [...document.querySelectorAll(".status-btn")].find((b) => b.textContent.includes("Python")).click()); await sleep(200);
await page.keyboard.press("Escape"); await sleep(150);
check("Escape closes the list", !(await page.$(".picker")));

// HTML
await clickTab("index.html"); await sleep(600);
check("HTML tags and attributes are coloured", (await colorOf("p")) !== (await plainColor()) && (await colorOf("class")) !== (await plainColor()), JSON.stringify([await colorOf("p"), await colorOf("class")]));

console.log(`\n${failures ? failures + " FAILED" : "ALL PASSED"} | page errors: ${errors.length ? JSON.stringify(errors) : "none"}`);
await b.close();
process.exit(failures || errors.length ? 1 : 0);
