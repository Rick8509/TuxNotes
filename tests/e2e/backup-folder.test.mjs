// Back up to a folder (USB drive, Nextcloud, Dropbox, Syncthing): choose it, automatic
// backups, keep the last N, an unplugged drive, restoring on a new computer, changing and
// stopping, and how it sits next to Google Drive.
import puppeteer from "puppeteer-core";
const BASE = process.env.BASE_URL ?? "http://localhost:4173";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await b.newPage();
await page.setViewport({ width: 1100, height: 760 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failures++; };

const text = (sel) => page.evaluate((sel) => document.querySelector(sel)?.textContent.replace(/\s+/g, " ").trim() ?? null, sel);
const panel = () => text(".panel");
const toast = () => page.evaluate(() => [...document.querySelectorAll(".toast span")].map((e) => e.textContent.trim()).join(" | "));
const dismissToasts = () => page.evaluate(() => document.querySelectorAll('.toast button[aria-label="Dismiss"]').forEach((b) => b.click()));
const click = async (sel, t) => {
  const ok = await page.evaluate((sel, t) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.replace(/\s+/g, " ").trim().includes(t));
    el?.click();
    return !!el;
  }, sel, t);
  if (!ok) throw new Error(`no ${sel} with "${t}"`);
  await sleep(250);
};
const confirm = (label) => click('[role="alertdialog"] .btn', label);
const pick = (path) => page.evaluate((path) => (globalThis.__mockPickFolder = path), path);
const openBackup = async () => {
  if (await page.$('[role="dialog"][aria-label="Settings"]')) { await page.keyboard.press("Escape"); await sleep(200); }
  await page.click('button[aria-label="Settings"]'); await sleep(200);
  await click(".nav-item", "Backup"); await sleep(300);
};
const newNote = async (title) => { await page.click('button[aria-label="New note"]'); await sleep(150); await page.keyboard.type(title); await sleep(600); };
const backups = () => page.evaluate(() => [...document.querySelectorAll(".panel .backup")].map((e) => e.textContent.replace(/\s+/g, " ").trim()));

// A copy without Google sign-in, like the releases
await page.goto(BASE + "/icon.png");
await page.evaluate(() => { localStorage.clear(); localStorage.setItem("tuxnotes-mock-google", "off"); });
await page.goto(BASE + "/", { waitUntil: "load" }); await sleep(500);
await newNote("First note");
await openBackup();
let p = await panel();
check("Backup offers a folder", p.includes("Back Up to a Folder…") && p.includes("Restore from a folder") && p.includes("USB drive"), p);
check("…and nothing about Google when this copy has no Google sign-in", !p.includes("Google"), p);

// Choose a folder: the first backup is made right away
await click(".panel .btn", "Back Up to a Folder…"); await sleep(1200);
check("the first backup is made at once", (await toast()).includes("Backed up 1 note to the backup folder. TuxNotes will also back up daily from now on."), await toast());
await dismissToasts();
p = await panel();
check("the card shows the folder by its name and full path", (await text(".panel .card .email")) === "Nextcloud" && (await text(".panel .card .path")) === "/home/you/Nextcloud/TuxNotes Backups", p);
check("…when it last backed up", p.includes("Last backup: Today at"), p);
check("…and the usual choices, worded for a folder", p.includes("Keep in the folder") && p.includes("Back up when closing") && p.includes("Encrypt backups") && p.includes("Each backup is one file in this folder"), p);

// More backups, keep the last N
await page.keyboard.press("Escape"); await sleep(200);
await newNote("Second note");
await openBackup();
await click(".panel .btn", "Back Up Now"); await sleep(1100);
check("Back Up Now saves another", (await toast()) === "Backed up 2 notes to the backup folder", await toast());
await dismissToasts();
await click(".panel .btn", "Restore…"); await sleep(600);
check("Restore… lists the folder's backups, newest first", (await text("#backup-title")) === "Restore from a Folder" && (await backups()).length === 2 && (await backups())[0].includes("Latest") && (await backups())[0].includes("2 notes"), JSON.stringify(await backups()));
await page.keyboard.press("Escape"); await sleep(200);
await page.select(".panel .prefs label:nth-of-type(2) select", "5"); await sleep(200);
for (let i = 0; i < 5; i++) { await click(".panel .btn", "Back Up Now"); await sleep(1000); }
await dismissToasts();
await click(".panel .btn", "Restore…"); await sleep(600);
check("only the last 5 are kept", (await backups()).length === 5, String((await backups()).length));
await page.keyboard.press("Escape"); await sleep(200);

// The USB drive is unplugged
await page.evaluate(() => globalThis.__mockUnplug("/home/you/Nextcloud/TuxNotes Backups", true));
await openBackup();
p = await panel();
check("an unplugged folder is shown as waiting, not as failed", p.includes("Not available right now. If it's on a USB drive, plug it in: backups carry on by themselves."), p);
await click(".panel .btn", "Back Up Now"); await sleep(400);
check("Back Up Now explains what to do", (await toast()).includes("plug the drive in"), await toast());
await dismissToasts();
await page.evaluate(() => globalThis.__mockUnplug("/home/you/Nextcloud/TuxNotes Backups", false));
await openBackup();
check("plugged in again: back to normal", !(await panel()).includes("Not available"), await panel());

// Change the folder; cancelled and read-only choices change nothing
await pick(null);
await click(".panel .link", "Change…"); await sleep(300);
check("cancelling the folder dialog changes nothing", (await text(".panel .card .email")) === "Nextcloud");
await pick("/readonly/stick");
await click(".panel .link", "Change…"); await sleep(300);
check("a folder TuxNotes can't write to is refused with the reason", (await toast()).includes("it's read-only") && (await text(".panel .card .email")) === "Nextcloud", await toast());
await dismissToasts();
await pick("/media/you/USB");
await click(".panel .link", "Change…"); await sleep(1200);
check("changing the folder backs up there at once", (await text(".panel .card .email")) === "USB" && (await text(".panel .card .path")) === "/media/you/USB/TuxNotes Backups" && (await toast()).includes("Backed up 2 notes"), await toast());
await dismissToasts();

// Stop
await click(".panel .link", "Stop");
check("Stop asks first", (await text('[role="alertdialog"]'))?.includes("The backups already in it stay there"));
await confirm("Stop");
check("…then Backup is back to the start", (await panel()).includes("Back Up to a Folder…"), await panel());

// A new computer: restore from the Nextcloud folder
await pick("/home/you/Nextcloud");
await click(".panel .link", "Restore from a folder"); await sleep(600);
const list = await backups();
check("Restore from a folder finds the backups inside the chosen folder", (await text("#backup-title")) === "Restore from a Folder" && list.length === 5, JSON.stringify(list));
await page.evaluate(() => [...document.querySelectorAll(".panel .backup input")].at(-1).click()); await sleep(100);
await click(".panel .actions .btn", "Restore");
await confirm("Restore"); await sleep(1300);
check("restoring there also keeps backing up there", (await toast()) === "Restored 2 notes. New backups will be saved in the same folder.", await toast());
await openBackup();
check("…so Backup shows that folder", (await text(".panel .card .email")) === "Nextcloud", await panel());

// Restore from another folder (the USB stick) without changing where backups go
await pick("/media/you/USB/TuxNotes Backups");
await click(".panel .btn", "Restore…"); await sleep(600);
await click(".panel .link", "Another folder…"); await sleep(600);
check("Another folder… lists that folder", (await backups()).length === 1, JSON.stringify(await backups()));
await page.keyboard.press("Escape"); await sleep(200);
check("…and backups still go to the same place", (await text(".panel .card .email")) === "Nextcloud");

// Encrypted backups
await click(".panel .btn", "Set Password…");
check("the password text fits folders too", (await panel()).includes("before they're saved or uploaded"), await panel());
await page.type('.pw-form input[aria-label="Backup password"]', "correct horse");
await page.type('.pw-form input[aria-label="Verify backup password"]', "correct horse");
await click(".pw-form .btn", "Encrypt Backups"); await sleep(300);
await dismissToasts();
await click(".panel .btn", "Back Up Now"); await sleep(1100);
await click(".panel .btn", "Restore…"); await sleep(600);
check("encrypted backups are marked and don't show what they hold", (await backups())[0].includes("Encrypted") && !(await backups())[0].includes("notes"), JSON.stringify(await backups()));
await page.keyboard.press("Escape"); await sleep(200);

// With Google sign-in in this copy: both choices
await page.evaluate(() => localStorage.removeItem("tuxnotes-mock-google"));
await page.reload({ waitUntil: "load" }); await sleep(500);
await openBackup();
p = await panel();
check("with Google sign-in, Google Drive is offered next to the folder", p.includes("Back Up to a Folder…") && p.includes("Back Up to Google Drive") && p.includes("Restore from Google Drive"), p);
check("…the folder first", await page.evaluate(() => document.querySelector(".panel .btn.primary")?.textContent.includes("Folder")));

console.log(`\n${failures ? failures + " FAILED" : "ALL PASSED"} | page errors: ${errors.length ? JSON.stringify(errors) : "none"}`);
await b.close();
process.exit(failures || errors.length ? 1 : 0);
