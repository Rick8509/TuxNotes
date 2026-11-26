// "A new version is out": Settings → Updates (switch, Check Now), the sidebar card (Get It,
// dismiss per version), the remembered answer, and the once-a-day background check.
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE_URL ?? "http://localhost:4173";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await b.newPage();
await page.setViewport({ width: 1200, height: 800 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// Record links opened in the browser instead of opening them.
await page.evaluateOnNewDocument(() => {
  window.__opened = [];
  window.open = (url) => { window.__opened.push(url); return null; };
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failures++; };

const card = () => page.evaluate(() => document.querySelector(".update-card")?.textContent.replace(/\s+/g, " ").trim() ?? null);
const status = () => page.evaluate(() => document.querySelector(".update-status")?.textContent.replace(/\s+/g, " ").trim() ?? null);
const checks = () => page.evaluate(() => globalThis.__updateChecks ?? 0);
const openSettings = async () => { await page.click('button[aria-label="Settings"]'); await sleep(300); };
const closeSettings = async () => { await page.keyboard.press("Escape"); await sleep(200); };
const clickButton = (text, scope = ".window") => page.evaluate(({ text, scope }) => [...document.querySelectorAll(`${scope} button`)].find((b) => b.textContent.trim() === text)?.click(), { text, scope });
const start = async (setup) => {
  await page.goto(BASE + "/icon.png");
  await page.evaluate(setup);
  await page.goto(BASE + "/", { waitUntil: "load" }); await sleep(700);
};

// First start: nothing shown, nothing asked yet
await start(() => localStorage.clear());
check("no update card at first", (await card()) === null);
await openSettings();
check("Settings → General has Updates, on by default", await page.evaluate(() => {
  const row = [...document.querySelectorAll(".window .row")].find((r) => r.textContent.includes("Check for new versions"));
  return !!row && row.querySelector("input").checked;
}));
check("…not checked yet", (await status()) === "Not checked yet.", await status());
await clickButton("Check Now"); await sleep(300);
check("Check Now with no newer version: up to date", (await status())?.startsWith("You're up to date"), await status());
check("…and says when it checked", await page.evaluate(() => document.querySelector(".window").textContent.includes("Last checked: Today at")));

// A newer version
await page.evaluate(() => localStorage.setItem("tuxnotes-mock-latest", "0.2.0"));
await clickButton("Check Now"); await sleep(300);
check("a newer version is reported", (await status()) === "TuxNotes 0.2.0 is out.", await status());
await clickButton("Get It"); await sleep(200);
check("Get It opens its release page", JSON.stringify(await page.evaluate(() => window.__opened)) === '["https://github.com/Rick8509/TuxNotes/releases/tag/v0.2.0"]', JSON.stringify(await page.evaluate(() => window.__opened)));
await page.evaluate(() => [...document.querySelectorAll(".window nav button, .window .nav button, .window button")].find((b) => b.textContent.trim() === "About")?.click()); await sleep(200);
check("About mentions it too", await page.evaluate(() => document.querySelector(".about-update")?.textContent.includes("TuxNotes 0.2.0 is out")));
await closeSettings();
check("the sidebar shows a card", (await card())?.startsWith("TuxNotes 0.2.0 is out"), await card());

// Remembered: shown at the next start without asking again
const before = await checks();
await page.reload({ waitUntil: "load" }); await sleep(700);
check("after a restart the card is still there (no new question)", (await card())?.startsWith("TuxNotes 0.2.0 is out") && (await checks()) === 0, `${await card()} / ${await checks()} (was ${before})`);
await clickButton("Get It", ".update-card"); await sleep(200);
check("the card's Get It opens the page", (await page.evaluate(() => window.__opened.length)) === 1);

// Dismissed for this version only
await page.click('.update-card button[aria-label="Dismiss"]'); await sleep(200);
check("✕ hides the card", (await card()) === null);
await page.reload({ waitUntil: "load" }); await sleep(700);
check("…and it stays hidden for that version", (await card()) === null);
await page.evaluate(() => localStorage.setItem("tuxnotes-mock-latest", "0.3.0"));
await openSettings(); await clickButton("Check Now"); await sleep(300); await closeSettings();
check("a later version shows it again", (await card())?.startsWith("TuxNotes 0.3.0 is out"), await card());

// Turned off: no card
await openSettings();
await page.evaluate(() => [...document.querySelectorAll(".window .row")].find((r) => r.textContent.includes("Check for new versions")).querySelector("input").click()); await sleep(200);
await closeSettings();
check("turning checks off hides the card", (await card()) === null);

// Offline
await page.evaluate(() => localStorage.setItem("tuxnotes-mock-latest", "offline"));
await openSettings(); await clickButton("Check Now"); await sleep(300);
check("offline: a clear message", (await status()) === "Couldn't reach GitHub. Are you online?", await status());
await closeSettings();

// Background: about 10 seconds after start, once a day, and only when switched on
await start(() => { localStorage.clear(); localStorage.setItem("tuxnotes-mock-latest", "0.2.0"); });
check("no question right at start", (await checks()) === 0);
await sleep(10_500);
check("…but a little later it asks by itself", (await checks()) === 1, String(await checks()));
check("…and shows the card", (await card())?.startsWith("TuxNotes 0.2.0 is out"), await card());
await page.reload({ waitUntil: "load" }); await sleep(10_800);
check("asked today already: no second question", (await checks()) === 0, String(await checks()));
await start(() => { localStorage.clear(); localStorage.setItem("tuxnotes-prefs-v1", JSON.stringify({ checkUpdates: false })); });
await sleep(10_800);
check("switched off: it never asks", (await checks()) === 0, String(await checks()));

console.log(`\n${failures ? failures + " FAILED" : "ALL PASSED"} | page errors: ${errors.length ? JSON.stringify(errors) : "none"}`);
await b.close();
process.exit(failures || errors.length ? 1 : 0);
