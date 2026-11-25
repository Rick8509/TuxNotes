#!/usr/bin/env node
// TuxNotes Dev: the app built as "TuxNotes Dev", with its own app ID, notes, settings
// and keyring entries (src-tauri/tauri.dev.conf.json), so it never touches TuxNotes.
//
//   npm run app:dev                         run it from the code, with live reload
//   npm run build:dev                       build its .deb, .rpm and AppImage
//   npm run build:dev -- --bundles deb      only the .deb (faster)
//
// Its version is <current version>-dev.<number of commits>, e.g. 0.1.0-dev.84, so each
// new build counts up and installs over the previous one.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [mode, ...extra] = process.argv.slice(2);
if (mode !== "run" && mode !== "build") {
  console.error("Usage: node scripts/dev-app.mjs run|build [arguments for tauri]");
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
let commits = "0";
try {
  commits = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: root }).toString().trim();
} catch {
  console.warn("No git history found; the dev version ends in .0");
}
const version = `${pkg.version}-dev.${commits}`;

// tauri.dev.conf.json plus the version, layered over tauri.conf.json by `--config`.
const config = { ...JSON.parse(readFileSync(join(root, "src-tauri", "tauri.dev.conf.json"), "utf8")), version };
mkdirSync(join(root, "target"), { recursive: true });
const configPath = join(root, "target", "tuxnotes-dev.conf.json");
writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);

console.log(`TuxNotes Dev ${version}`);
const tauri = mode === "run" ? ["tauri", "dev", "--config", configPath] : ["tauri", "build", "--config", configPath];
// Tauri doesn't compile the version from --config into the app; pass it for Settings → About.
const env = { ...process.env, TUXNOTES_BUILD_VERSION: version };
const result = spawnSync("npx", [...tauri, ...extra], { cwd: root, stdio: "inherit", env });
if (mode === "build" && result.status === 0) {
  console.log("\nPackages are in target/release/bundle/ (deb/, rpm/, appimage/). Install the .deb with:");
  console.log(`  sudo apt install ./target/release/bundle/deb/TuxNotes\\ Dev_${version}_amd64.deb`);
}
process.exit(result.status ?? 1);
