// Spell checking: on by default with the desktop's language, Settings → General → Spelling
// turns it off or picks languages, and code and links are never checked.
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

const calls = () => page.evaluate(() => globalThis.__spellingCalls ?? []);
const lastCall = async () => (await calls()).at(-1);
const proseSpellcheck = () => page.$eval(".prose", (e) => e.getAttribute("spellcheck"));
const languages = () => page.$$eval(".languages .language", (els) => els.map((l) => ({
  name: l.querySelector("span").textContent.trim(),
  code: l.querySelector(".code").textContent.trim(),
  on: l.querySelector("input").checked,
  disabled: l.querySelector("input").disabled,
})));
const tick = (code) => page.evaluate((code) => {
  [...document.querySelectorAll(".languages .language")].find((l) => l.querySelector(".code").textContent.trim() === code).querySelector("input").click();
}, code);
const spellSwitch = () => page.evaluateHandle(() =>
  [...document.querySelectorAll(".window .row")].find((r) => r.textContent.includes("Check spelling while typing")).querySelector("input"));
const openSettings = async () => { await page.click('button[aria-label="Settings"]'); await sleep(300); };
const closeSettings = async () => { await page.keyboard.press("Escape"); await sleep(200); };

await page.goto(BASE + "/icon.png");
await page.evaluate(() => {
  localStorage.clear();
  const t = Date.now();
  const doc = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Spelling" }] },
    { type: "paragraph", content: [{ type: "text", text: "Visit " }, { type: "text", text: "exmple.com", marks: [{ type: "link", attrs: { href: "https://exmple.com" } }] }, { type: "text", text: " and run " }, { type: "text", text: "npm i", marks: [{ type: "code" }] }] },
    { type: "codeBlock", content: [{ type: "text", text: "cd /usr/bin && ls -la" }] },
  ] };
  localStorage.setItem("tuxnotes-mock-v1", JSON.stringify({
    folders: [{ id: "f0", name: "Notes", isDefault: true, parentId: null, sortOrder: 0, createdAt: t, updatedAt: t }],
    notes: [{ id: "a", folderId: "f0", title: "Spelling", snippet: "", plain: "Spelling", content: doc, isPinned: false, createdAt: t, updatedAt: t, deletedAt: null, isLocked: false }],
  }));
});
await page.goto(BASE + "/", { waitUntil: "load" }); await sleep(700);
await page.click('.note[data-id="a"]'); await sleep(250);

// On by default with the desktop's language
check("spell checking is switched on at start", JSON.stringify(await lastCall()) === JSON.stringify({ enabled: true, languages: [] }), JSON.stringify(await calls()));
check("the note asks for spell checking", (await proseSpellcheck()) === "true");
check("…but not in code blocks", await page.$eval(".prose .code-block code", (e) => e.getAttribute("spellcheck")) === "false");
check("…inline code", await page.$eval(".prose code:not(pre code)", (e) => e.getAttribute("spellcheck")) === "false");
check("…or links", await page.$eval(".prose a", (e) => e.getAttribute("spellcheck")) === "false");

// Settings → General → Spelling
await openSettings();
check("Settings shows the Spelling section", await page.evaluate(() => [...document.querySelectorAll(".subhead")].some((h) => h.textContent === "Spelling")));
let langs = await languages();
check("installed dictionaries are listed by name", JSON.stringify(langs.map((l) => l.name)) === JSON.stringify(["German (Germany)", "English (United Kingdom)", "English (United States)", "French (France)"]), JSON.stringify(langs.map((l) => l.name)));
check("the desktop's language is ticked", JSON.stringify(langs.filter((l) => l.on).map((l) => l.code)) === '["en_US"]', JSON.stringify(langs));
check("the only ticked language can't be unticked", langs.find((l) => l.code === "en_US").disabled);

await tick("de_DE"); await sleep(200);
check("ticking German adds it", JSON.stringify((await lastCall()).languages) === '["en_US","de_DE"]', JSON.stringify(await lastCall()));
langs = await languages();
check("…and both can be unticked again", !langs.find((l) => l.code === "en_US").disabled && !langs.find((l) => l.code === "de_DE").disabled);
await tick("en_US"); await sleep(200);
check("unticking English leaves German", JSON.stringify((await lastCall()).languages) === '["de_DE"]', JSON.stringify(await lastCall()));

// Off: WebKit's checker and the note's underlines
await (await spellSwitch()).click(); await sleep(200);
check("turning it off switches the checker off", (await lastCall()).enabled === false, JSON.stringify(await lastCall()));
check("…hides the language list", (await languages()).length === 0);
await closeSettings();
check("…and the note stops asking for spell checking", (await proseSpellcheck()) === "false");

// Remembered after a restart
await page.reload({ waitUntil: "load" }); await sleep(700);
check("off is remembered after a restart", JSON.stringify(await lastCall()) === JSON.stringify({ enabled: false, languages: ["de_DE"] }), JSON.stringify(await calls()));
await page.click('.note[data-id="a"]'); await sleep(200);
check("…and the note still doesn't check", (await proseSpellcheck()) === "false");
await openSettings();
await (await spellSwitch()).click(); await sleep(200);
check("turning it back on keeps the chosen language", JSON.stringify(await lastCall()) === JSON.stringify({ enabled: true, languages: ["de_DE"] }), JSON.stringify(await lastCall()));
langs = await languages();
check("…ticked in the list", JSON.stringify(langs.filter((l) => l.on).map((l) => l.code)) === '["de_DE"]', JSON.stringify(langs));
await closeSettings();
check("…and the note checks again", (await proseSpellcheck()) === "true");

console.log(`\n${failures ? failures + " FAILED" : "ALL PASSED"} | page errors: ${errors.length ? JSON.stringify(errors) : "none"}`);
await b.close();
process.exit(failures || errors.length ? 1 : 0);
