// Images in notes: resize with the corner handle or the Size menu, quick rotate, and
// Edit Image… (flip, crop); every edit is a new attachment so Undo brings the old back.
// The test image has four coloured quarters, so pixel colours show what happened to it.
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

const frame = () => page.$(".prose .note-image-frame");
const imageId = () => page.evaluate(() => document.querySelector(".prose .note-image-frame")?.dataset.attachmentId);
const frameWidth = () => page.evaluate(() => document.querySelector(".prose .note-image-frame")?.style.width ?? null);
const savedImage = () => page.evaluate(() => {
  const notes = JSON.parse(localStorage.getItem("tuxnotes-mock-v1")).notes;
  const find = (n) => (n.type === "image" ? n : (n.content ?? []).map(find).find(Boolean));
  return notes.map((n) => find(n.content)).find(Boolean)?.attrs ?? null;
});
/** Size and the colour at the middle of each quarter of the shown image. */
const pixels = () => page.evaluate(async () => {
  const img = document.querySelector(".prose .note-image-frame img");
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const at = (fx, fy) => {
    const [r, g, bl] = ctx.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data;
    return r > 200 && g > 200 && bl < 80 ? "yellow" : r > 200 ? "red" : g > 200 ? "green" : bl > 200 ? "blue" : `${r},${g},${bl}`;
  };
  return { w: c.width, h: c.height, tl: at(0.25, 0.25), tr: at(0.75, 0.25), bl: at(0.25, 0.75), br: at(0.75, 0.75) };
});
const menuItems = () => page.$$eval(".menu button", (els) => els.map((e) => e.textContent.trim()));
const rightClickImage = async () => {
  const box = await (await frame()).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" }); await sleep(200);
};
const menu = async (label) => {
  await rightClickImage();
  await page.evaluate((label) => [...document.querySelectorAll(".menu button")].find((b) => b.textContent.trim().replace(/^✓\s*/, "") === label).click(), label);
  await sleep(800);
};

await page.goto(BASE + "/icon.png");
await page.evaluate(() => {
  localStorage.clear();
  const t = Date.now();
  localStorage.setItem("tuxnotes-mock-v1", JSON.stringify({
    folders: [{ id: "f0", name: "Notes", isDefault: true, parentId: null, sortOrder: 0, createdAt: t, updatedAt: t }],
    notes: [{ id: "a", folderId: "f0", title: "Photos", snippet: "", plain: "Photos", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Photos" }] }, { type: "paragraph" }] }, isPinned: false, createdAt: t, updatedAt: t, deletedAt: null, isLocked: false }],
  }));
});
await page.goto(BASE + "/", { waitUntil: "load" }); await sleep(600);
await page.click('.note[data-id="a"]'); await sleep(250);
await page.click(".prose p:last-child"); await sleep(100);

// Paste a 400×200 image: red | green over blue | yellow
await page.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 400; c.height = 200;
  const ctx = c.getContext("2d");
  [["#ff0000", 0, 0], ["#00ff00", 200, 0], ["#0000ff", 0, 100], ["#ffff00", 200, 100]].forEach(([col, x, y]) => { ctx.fillStyle = col; ctx.fillRect(x, y, 200, 100); });
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "quarters.png", { type: "image/png" }));
  document.querySelector(".prose").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await sleep(900);
const original = await imageId();
let p = await pixels();
check("the pasted image is in the note", !!original && p.w === 400 && p.tl === "red" && p.br === "yellow", JSON.stringify(p));

// M1: resize with the corner handle
const box = await (await frame()).boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await sleep(150);
check("hovering shows the resize handle", await page.evaluate(() => getComputedStyle(document.querySelector(".note-image-handle")).opacity === "1"));
const handle = await (await page.$(".note-image-handle")).boundingBox();
const contentW = await page.evaluate(() => document.querySelector(".prose").clientWidth);
await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + contentW * 0.33, handle.y, { steps: 6 }); await sleep(100);
check("while dragging, the size shows", await page.evaluate(() => getComputedStyle(document.querySelector(".note-image-badge")).display === "block" && /%$/.test(document.querySelector(".note-image-badge").textContent)), await page.evaluate(() => document.querySelector(".note-image-badge").textContent));
await page.mouse.move(box.x + contentW * 0.505, handle.y, { steps: 6 });
await page.mouse.up(); await sleep(1300);
check("dragging the handle resizes (snapping to 50%)", (await frameWidth()) === "50%", await frameWidth());
check("…and it's saved with the note", (await savedImage())?.width === 50, JSON.stringify(await savedImage()));

// M1: the Size menu
await rightClickImage();
const items = await menuItems();
check("the image menu has edit, rotate and size items", ["Edit Image…", "Rotate Left", "Rotate Right", "Small", "Medium", "Large", "Full Width", "Original Size", "Open", "Save a Copy…", "Delete"].every((l) => items.some((i) => i.replace(/^✓\s*/, "") === l)), JSON.stringify(items));
check("…with the current size ticked", items.includes("✓  Medium") || items.some((i) => /^✓\s*Medium$/.test(i)), JSON.stringify(items));
await page.keyboard.press("Escape"); await sleep(100);
await menu("Small");
check("Size → Small makes it a quarter wide", (await frameWidth()) === "25%", await frameWidth());
await menu("Original Size");
check("Size → Original Size goes back to its own size", (await frameWidth()) === "" && (await savedImage())?.width == null, `${await frameWidth()} ${JSON.stringify(await savedImage())}`);
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control"); await sleep(300);
check("Undo brings the previous size back", (await frameWidth()) === "25%", await frameWidth());

// M2: quick rotate (a new image) and Undo
await menu("Rotate Right");
p = await pixels();
check("Rotate Right turns the image (400×200 → 200×400)", p.w === 200 && p.h === 400, JSON.stringify(p));
check("…the right way round (blue now top-left, red top-right)", p.tl === "blue" && p.tr === "red" && p.bl === "yellow" && p.br === "green", JSON.stringify(p));
check("…as a new image, keeping its size setting", (await imageId()) !== original && (await frameWidth()) === "25%", `${await imageId()} ${await frameWidth()}`);
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control"); await sleep(500);
check("Undo brings the original image back", (await imageId()) === original && (await pixels()).w === 400, await imageId());
await menu("Rotate Left");
p = await pixels();
check("Rotate Left turns the other way (green top-left)", p.w === 200 && p.tl === "green" && p.tr === "yellow", JSON.stringify(p));
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control"); await sleep(500);

// M2: Edit Image…
await menu("Edit Image…");
check("Edit Image… opens the editor", await page.evaluate(() => !!document.querySelector('.dialog[aria-label="Edit Image"] canvas')));
check("…showing the result's size", await page.evaluate(() => document.querySelector(".dialog footer").textContent.includes("400 × 200")));
check("…with Done available and Reset not (nothing changed yet)", await page.evaluate(() => !document.querySelector(".dialog .btn.primary").disabled && [...document.querySelectorAll(".dialog .tool")].find((b) => b.textContent.includes("Reset")).disabled));
await page.keyboard.press("Escape"); await sleep(200);
check("Escape closes it without changes", !(await page.$('.dialog[aria-label="Edit Image"]')) && (await imageId()) === original);

await menu("Edit Image…");
await page.click('.dialog button[aria-label="Flip horizontally"]'); await sleep(100);
await page.evaluate(() => [...document.querySelectorAll(".dialog .tool")].find((b) => b.textContent.includes("Crop")).click()); await sleep(100);
check("Crop shows the crop frame with shapes", await page.evaluate(() => !!document.querySelector(".crop.active .grip.se") && document.querySelectorAll(".aspects button").length === 5));
await page.evaluate(() => [...document.querySelectorAll(".aspects button")].find((b) => b.textContent === "Square").click()); await sleep(100);
check("…Square makes a square crop", await page.evaluate(() => document.querySelector(".dialog footer").textContent.includes("200 × 200")), await page.evaluate(() => document.querySelector(".dialog footer").textContent));
// Drag the crop to the left edge (over what was the green half before flipping)
const crop = await (await page.$(".crop.active")).boundingBox();
await page.mouse.move(crop.x + crop.width / 2, crop.y + crop.height / 2);
await page.mouse.down(); await page.mouse.move(crop.x - 400, crop.y + crop.height / 2, { steps: 5 }); await page.mouse.up(); await sleep(100);
await page.evaluate(() => document.querySelector(".dialog .btn.primary").click()); await sleep(1200);
p = await pixels();
check("Done adds the flipped, cropped image", !(await page.$('.dialog[aria-label="Edit Image"]')) && p.w === 200 && p.h === 200, JSON.stringify(p));
check("…with the right part of the picture (flipped: green over yellow on the left)", p.tl === "green" && p.bl === "yellow", JSON.stringify(p));
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control"); await sleep(500);
check("Undo brings the original back", (await imageId()) === original);

// Read-only notes: no handle and no editing
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Delete note")?.click()); await sleep(600);
await page.evaluate(() => [...document.querySelectorAll(".sidebar .row")].find((r) => r.textContent.includes("Recently Deleted"))?.click()); await sleep(400);
await page.click('.note[data-id="a"]'); await sleep(300);
const roBox = await (await frame()).boundingBox();
await page.mouse.move(roBox.x + 10, roBox.y + 10); await sleep(150);
check("in a read-only note the resize handle stays hidden", await page.evaluate(() => getComputedStyle(document.querySelector(".note-image-handle")).opacity === "0"));
await rightClickImage();
check("…and the menu has no editing items", !(await menuItems()).some((i) => i.includes("Edit Image") || i.includes("Rotate")), JSON.stringify(await menuItems()));

console.log(`\n${failures ? failures + " FAILED" : "ALL PASSED"} | page errors: ${errors.length ? JSON.stringify(errors) : "none"}`);
await b.close();
process.exit(failures || errors.length ? 1 : 0);
