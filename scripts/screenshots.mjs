// Screenshots for the README and app stores (docs/screenshots/*.png).
// Fills the browser preview (mock backend, src/lib/mock.ts) with made-up sample notes,
// so it never touches real notes. Run with `npm run screenshots`.
// Needs Google Chrome or Chromium: set CHROME=/path/to/chrome if it isn't found.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs", "screenshots");
const port = process.env.SCREENSHOT_PORT ?? "4180";
const base = `http://localhost:${port}`;
const chrome =
  process.env.CHROME ??
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
if (!chrome) {
  console.error("No Chrome or Chromium found. Set CHROME=/path/to/chrome.");
  process.exit(2);
}

// ---------------------------------------------------------------- sample notes
const text = (t, ...marks) => (marks.length ? { type: "text", text: t, marks: marks.map((m) => ({ type: m })) } : { type: "text", text: t });
const p = (...parts) => ({ type: "paragraph", content: parts.map((x) => (typeof x === "string" ? text(x) : x)) });
const h = (level, t) => ({ type: "heading", attrs: { level }, content: [text(t)] });
const bullets = (...items) => ({ type: "bulletList", content: items.map((i) => ({ type: "listItem", content: [p(i)] })) });
const numbered = (...items) => ({ type: "orderedList", attrs: { start: 1 }, content: items.map((i) => ({ type: "listItem", content: [p(i)] })) });
const tasks = (...items) => ({
  type: "taskList",
  content: items.map(([checked, t]) => ({ type: "taskItem", attrs: { checked }, content: [p(t)] })),
});
const cell = (kind, t) => ({ type: kind, attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p(t)] });
const table = (header, ...rows) => ({
  type: "table",
  content: [
    { type: "tableRow", content: header.map((t) => cell("tableHeader", t)) },
    ...rows.map((r) => ({ type: "tableRow", content: r.map((t) => cell("tableCell", t)) })),
  ],
});

const plainOf = (node) => (node.text ?? "") + (node.content ?? []).map(plainOf).join(node.type === "doc" ? "\n" : " ");

const HOUR = 3600_000;
const DAY = 24 * HOUR;
function sampleDb() {
  const t = CLOCK;
  const folder = (id, name, parentId = null, isDefault = false, sortOrder = 1) => ({ id, name, isDefault, parentId, sortOrder, createdAt: t, updatedAt: t });
  const note = (id, folderId, ago, blocks, isPinned = false) => {
    const content = { type: "doc", content: blocks };
    const lines = blocks.map(plainOf).map((s) => s.trim()).filter(Boolean);
    return {
      id, folderId, content, isPinned, isLocked: false, deletedAt: null,
      title: lines[0] ?? "", snippet: lines.slice(1).join(" ").slice(0, 120), plain: lines.join("\n"),
      createdAt: t - ago - DAY, updatedAt: t - ago,
    };
  };
  return {
    folders: [
      folder("notes", "Notes", null, true, 0),
      folder("personal", "Personal", null, false, 1),
      folder("work", "Work", null, false, 2),
      folder("projects", "Projects", "work", false, 1),
      folder("recipes", "Recipes", null, false, 3),
    ],
    notes: [
      note("trip", "personal", 2 * HOUR, [
        p("Weekend at the lake"),
        p("Leaving Friday after work. Cabin key is under the blue flower pot."),
        h(2, "Packing"),
        tasks([false, "Rain jackets"], [false, "Board games"], [false, "Camera and charger"], [true, "Hiking boots"], [true, "Sleeping bags"], [true, "Snacks for the drive"]),
        h(2, "Plan"),
        bullets("Saturday: hike to the waterfall (3 hours)", "Sunday: kayaks from 10:00, booked for four"),
      ], true),
      note("kickoff", "projects", 25 * 60_000, [
        p("Website relaunch kickoff"),
        p("Goal: a faster site that's easier to update. Launch before the spring campaign."),
        h(2, "Milestones"),
        table(["Milestone", "Owner", "Due"], ["Content audit", "Maya", "Dec 5"], ["New design", "Jonas", "Jan 16"], ["Launch", "Everyone", "Feb 27"]),
        h(2, "Next steps"),
        tasks([true, "Share the meeting notes"], [false, "Collect logins for the old site"], [false, "Book the design review"]),
        p(text("Decision: ", "bold"), "keep the blog, drop the old forum."),
      ]),
      note("standup", "work", 5 * HOUR, [
        p("Team standup"),
        p("Monday 24 November"),
        bullets("Release notes are ready for review", "New laptop arrives Wednesday", "Ask about the conference budget"),
      ]),
      note("cake", "recipes", 3 * DAY, [
        p("Lemon cake"),
        p("From Grandma's recipe card. Bake at 175 °C for 45 minutes."),
        h(2, "Ingredients"),
        bullets("250 g flour", "200 g sugar", "4 eggs", "2 lemons (zest and juice)", "200 g butter"),
        h(2, "Steps"),
        numbered("Beat butter and sugar until fluffy.", "Add the eggs one by one.", "Fold in flour, zest and juice.", "Bake, then pour over the lemon glaze."),
      ]),
      note("books", "personal", 6 * DAY, [
        p("Books to read"),
        tasks([true, "The Left Hand of Darkness"], [false, "Project Hail Mary"], [false, "The Overstory"]),
      ]),
      note("ideas", "notes", 26 * HOUR, [p("Gift ideas"), p("Mum: pottery class. Leo: a good flashlight. Sam: concert tickets.")]),
      note("wifi", "notes", 9 * DAY, [p("Guest Wi-Fi"), p("Network: Lakehouse-Guest. The password is on the fridge.")]),
      note("garden", "personal", 12 * DAY, [p("Garden"), p("Plant the tulip bulbs before the first frost.")]),
    ],
  };
}

// ---------------------------------------------------------------- run
const preview = spawn("npx", ["vite", "preview", "--port", port, "--strictPort"], { cwd: root, stdio: "ignore", detached: true });
const stop = () => {
  try {
    process.kill(-preview.pid);
  } catch {
    /* already gone */
  }
};
process.on("exit", stop);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 100) throw new Error("vite preview did not start");
  await new Promise((r) => setTimeout(r, 200));
}

mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// A fixed daytime clock, so the screenshots look the same on every run.
const CLOCK = Date.parse("2026-11-24T10:30:00");
await page.evaluateOnNewDocument((fixed) => {
  const RealDate = Date;
  const start = RealDate.now();
  const fakeNow = () => fixed + (RealDate.now() - start);
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fakeNow()]));
    }
    static now() {
      return fakeNow();
    }
  };
}, CLOCK);

async function open(theme) {
  await page.goto(base + "/icon.png");
  await page.evaluate(
    (db, theme) => {
      localStorage.clear();
      localStorage.setItem("tuxnotes-mock-v1", JSON.stringify(db));
      localStorage.setItem("tuxnotes-prefs-v1", JSON.stringify({ theme }));
    },
    sampleDb(),
    theme,
  );
  await page.goto(base + "/", { waitUntil: "load" });
  await sleep(700);
}
const folder = (name) =>
  page.evaluate((name) => {
    const row = [...document.querySelectorAll(".sidebar .tree-row .row")].find((r) => r.querySelector(".name")?.textContent.trim() === name);
    row?.click();
    return !!row;
  }, name);
async function shot(name) {
  await page.mouse.move(1, 1);
  await sleep(400);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`saved docs/screenshots/${name}.png`);
}

await open("light");
await folder("Projects");
await sleep(300);
await page.click('.note[data-id="kickoff"]');
await shot("notes-light");

await open("dark");
await folder("Personal");
await sleep(300);
await page.click('.note[data-id="trip"]');
await shot("checklist-dark");

await open("light");
await page.click(".search input");
await page.type(".search input", "lemon");
await sleep(600);
await page.click('.note[data-id="cake"]');
await shot("search-light");

await browser.close();
if (errors.length) console.error("page errors:", errors);
process.exit(errors.length ? 1 : 0); // also stops the preview server
