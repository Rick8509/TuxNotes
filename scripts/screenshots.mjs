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

const code = (language, t) => ({ type: "codeBlock", attrs: { language }, content: [text(t)] });

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
      folder("travel", "Travel", "personal", false, 1),
      folder("work", "Work", null, false, 2),
      folder("projects", "Projects", "work", false, 1),
      folder("recipes", "Recipes", null, false, 3),
    ],
    notes: [
      note("trip", "travel", 2 * HOUR, [
        p("Weekend at the lake"),
        p("Leaving Friday after work. The cabin key is under the blue flower pot."),
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
      note("deploy", "work", 3 * HOUR, [
        p("Deploying the new site"),
        p("Run from the project folder. Takes about five minutes; the old version keeps serving until the switch."),
        code("bash", "# build and upload\nnpm ci && npm run build\nrsync -az --delete dist/ web:/srv/site/next/\n\n# switch over, keep the old one for a quick rollback\nssh web 'cd /srv/site && mv live old && mv next live'"),
        h(2, "Afterwards"),
        tasks([true, "Check the home page and the shop"], [false, "Watch the error log for an hour"], [false, "Tell the team in the chat"]),
        p(text("Rollback: ", "bold"), "swap the folders back and reload the web server."),
      ]),
      note("standup", "work", 5 * HOUR, [
        p("Team standup"),
        p("Monday 24 November"),
        bullets("Release notes are ready for review", "New laptop arrives Wednesday", "Ask about the conference budget"),
      ]),
      note("ideas", "notes", 26 * HOUR, [p("Gift ideas"), p("Mum: pottery class. Leo: a good flashlight. Sam: concert tickets.")]),
      note("cake", "recipes", 3 * DAY, [
        p("Lemon cake"),
        p("From Grandma's recipe card. Bake at 175 °C for 45 minutes."),
        h(2, "Ingredients"),
        bullets("250 g flour", "200 g sugar", "4 eggs", "2 lemons (zest and juice)", "200 g butter"),
        h(2, "Steps"),
        numbered("Beat butter and sugar until fluffy.", "Add the eggs one by one.", "Fold in flour, zest and juice.", "Bake, then pour over the lemon glaze."),
      ]),
      note("books", "personal", 5 * DAY, [
        p("Books to read"),
        tasks([true, "The Left Hand of Darkness"], [false, "Project Hail Mary"], [false, "The Overstory"]),
      ]),
      note("wifi", "notes", 9 * DAY, [p("Guest Wi-Fi"), p("Network: Lakehouse-Guest. The password is on the fridge.")]),
      note("garden", "personal", 12 * DAY, [p("Garden"), p("Plant the tulip bulbs before the first frost.")]),
    ],
  };
}

// Files for the Files window (the mock reads them from localStorage).
const SAMPLE_FILES = [
  {
    path: "/home/you/projects/weather/server.py",
    text: `"""A tiny weather service: today's weather for a city, as JSON."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

FORECASTS = {"lisbon": ("sunny", 21), "oslo": ("snow", -3), "tokyo": ("cloudy", 14)}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        city = parse_qs(urlparse(self.path).query).get("city", ["lisbon"])[0]
        sky, temp = FORECASTS.get(city.lower(), ("unknown", None))
        body = json.dumps({"city": city, "sky": sky, "temperature": temp})
        self.send_response(200 if temp is not None else 404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body.encode())


if __name__ == "__main__":
    print("Serving on http://localhost:8000")
    HTTPServer(("", 8000), Handler).serve_forever()
`,
  },
  {
    path: "/home/you/projects/weather/README.md",
    text: `# Weather Service

A tiny service that answers with **today's weather** for a city, as JSON. Written in *Python*, no extra packages.

## Run it

1. Install Python 3.10 or newer
2. Start the server
3. Open \`localhost:8000/?city=oslo\`

\`\`\`bash
python3 server.py
curl "localhost:8000/?city=tokyo"
\`\`\`

## Cities

| City | Sky | °C |
|---|---|---|
| Lisbon | sunny | 21 |
| Oslo | snow | -3 |
| Tokyo | cloudy | 14 |

- [x] JSON answers
- [ ] A forecast for the week
`,
  },
  { path: "/home/you/projects/weather/config.yaml", text: "port: 8000\ncities:\n  - lisbon\n  - oslo\n  - tokyo\n" },
];

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
await page.setViewport({ width: 1328, height: 872, deviceScaleFactor: 1.5 });
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

// Draw the app as a floating window: transparent around it, with a soft shadow.
const FRAME_CSS = `
  #app { position: fixed !important; inset: 34px 44px 58px !important; height: auto !important;
         border-radius: var(--window-radius); box-shadow: 0 22px 48px rgba(0,0,0,.30), 0 2px 8px rgba(0,0,0,.12); }
`;

async function open(theme, path = "/") {
  await page.goto(base + "/icon.png");
  await page.evaluate(
    (db, files, theme) => {
      localStorage.clear();
      localStorage.setItem("tuxnotes-mock-v1", JSON.stringify(db));
      localStorage.setItem("tuxnotes-mock-files", JSON.stringify(files));
      localStorage.setItem("tuxnotes-mock-google", "off");
      localStorage.setItem("tuxnotes-prefs-v1", JSON.stringify({ theme }));
    },
    sampleDb(),
    SAMPLE_FILES,
    theme,
  );
  await page.goto(base + path, { waitUntil: "load" });
  await page.addStyleTag({ content: FRAME_CSS });
  await sleep(800);
}
const folder = (name) =>
  page.evaluate((name) => {
    const row = [...document.querySelectorAll(".sidebar .row")].find((r) => r.querySelector(".name")?.textContent.trim() === name);
    row?.click();
    return !!row;
  }, name);
const openNote = async (id) => {
  await page.click(`.note[data-id="${id}"]`);
  await sleep(400);
};
const blur = () => page.evaluate(() => document.activeElement?.blur());
async function shot(name) {
  await page.mouse.move(2, 2);
  await sleep(450);
  await page.screenshot({ path: join(out, `${name}.png`), omitBackground: true });
  console.log(`saved docs/screenshots/${name}.png`);
}

/** Paste a picture of a lake at sunset (drawn here) after the note's first paragraph. */
async function pasteLakePicture() {
  await page.evaluate(async () => {
    const W = 1600, H = 560;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    const lin = (y0, y1, stops) => {
      const gr = g.createLinearGradient(0, y0, 0, y1);
      stops.forEach(([at, col]) => gr.addColorStop(at, col));
      return gr;
    };
    const horizon = H * 0.58;
    g.fillStyle = lin(0, horizon, [[0, "#3b4a8c"], [0.45, "#c06c84"], [0.8, "#f8b195"], [1, "#fde2b5"]]);
    g.fillRect(0, 0, W, horizon);
    // Sun and its glow
    const sun = g.createRadialGradient(W * 0.62, horizon - 40, 10, W * 0.62, horizon - 40, 260);
    sun.addColorStop(0, "rgba(255,244,214,1)");
    sun.addColorStop(0.18, "rgba(255,226,170,0.95)");
    sun.addColorStop(1, "rgba(255,200,150,0)");
    g.fillStyle = sun;
    g.fillRect(0, 0, W, horizon);
    // Mountain ridges, far to near
    const ridge = (base, amp, seed, color) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, horizon);
      for (let x = 0; x <= W; x += 8) {
        const y = base - amp * (0.55 * Math.sin(x / 210 + seed) + 0.3 * Math.sin(x / 83 + seed * 2.1) + 0.15 * Math.sin(x / 37 + seed * 3.7));
        g.lineTo(x, y);
      }
      g.lineTo(W, horizon);
      g.closePath();
      g.fill();
    };
    ridge(horizon - 90, 60, 1.3, "#8d6b94");
    ridge(horizon - 50, 55, 4.1, "#6a4f7d");
    ridge(horizon - 18, 38, 2.2, "#3f3356");
    // Pines on the shore
    g.fillStyle = "#231c33";
    for (let i = 0; i < 46; i++) {
      const x = (i * 97 + (i % 5) * 23) % W;
      const h = 40 + ((i * 37) % 55);
      g.beginPath();
      g.moveTo(x, horizon - h);
      g.lineTo(x - h * 0.22, horizon + 2);
      g.lineTo(x + h * 0.22, horizon + 2);
      g.closePath();
      g.fill();
    }
    // The lake: the sky mirrored, darker, with shimmering lines
    g.fillStyle = lin(horizon, H, [[0, "#e7a98f"], [0.35, "#9c6b8d"], [1, "#2e3a6b"]]);
    g.fillRect(0, horizon, W, H - horizon);
    g.strokeStyle = "rgba(255,236,200,0.55)";
    for (let i = 0; i < 28; i++) {
      const y = horizon + 10 + i * i * 0.32;
      const w = 220 - i * 6;
      g.lineWidth = 2 + i * 0.05;
      g.beginPath();
      g.moveTo(W * 0.62 - w / 2 + ((i * 53) % 30), y);
      g.lineTo(W * 0.62 + w / 2 - ((i * 31) % 40), y);
      g.stroke();
    }
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
    const file = new File([blob], "lake.jpg", { type: "image/jpeg" });
    // Cursor at the end of the first paragraph, then paste.
    const para = document.querySelectorAll(".prose > p")[1];
    const range = document.createRange();
    range.selectNodeContents(para);
    range.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document.querySelector(".prose").focus();
    const dt = new DataTransfer();
    dt.items.add(file);
    document.querySelector(".prose").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await sleep(900);
}

// 1. The main window: all notes, a note with a picture and a checklist (light)
await open("light");
await openNote("trip");
await pasteLakePicture();
await blur();
await shot("notes-light");

// 2. Dark, with a code block
await open("dark");
await openNote("deploy");
await blur();
await shot("notes-dark");

// 3. Slash commands
await open("light");
await openNote("ideas");
await page.evaluate(() => {
  const last = [...document.querySelectorAll(".prose > p")].at(-1);
  const range = document.createRange();
  range.selectNodeContents(last);
  range.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  document.querySelector(".prose").focus();
});
await page.keyboard.press("Enter");
await page.keyboard.type("/");
await sleep(500);
await shot("slash-commands");

// 4. The command palette (dark)
await open("dark");
await openNote("kickoff");
await page.keyboard.down("Control");
await page.keyboard.down("Shift");
await page.keyboard.press("P");
await page.keyboard.up("Shift");
await page.keyboard.up("Control");
await sleep(700);
await shot("command-palette");

// 5. Files window: code (dark) and a Markdown file as a formatted page (light)
await open("dark", "/?window=files");
await page.evaluate(() => [...document.querySelectorAll(".tab")].find((t) => t.textContent.includes("server.py"))?.click());
await sleep(500);
await page.evaluate(() => document.activeElement?.blur());
await shot("files-code");

await open("light", "/?window=files");
await page.evaluate(() => [...document.querySelectorAll(".tab")].find((t) => t.textContent.includes("README.md"))?.click());
await sleep(600);
await blur();
await shot("files-markdown");

// 6. Backup to a folder (Settings)
await open("light");
await openNote("trip");
await page.click('button[aria-label="Settings"]');
await sleep(300);
await page.evaluate(() => [...document.querySelectorAll(".nav-item")].find((e) => e.textContent.includes("Backup"))?.click());
await sleep(300);
await page.evaluate(() => [...document.querySelectorAll(".panel .btn")].find((e) => e.textContent.includes("Back Up to a Folder"))?.click());
await sleep(1500);
await page.evaluate(() => document.querySelectorAll('.toast button[aria-label="Dismiss"]').forEach((b) => b.click()));
await sleep(200);
await shot("backup");

await browser.close();
if (errors.length) console.error("page errors:", errors);
process.exit(errors.length ? 1 : 0); // also stops the preview server
