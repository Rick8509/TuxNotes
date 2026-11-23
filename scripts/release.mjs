#!/usr/bin/env node
// Release helper, used by the "Release step 1: prepare" and "Release step 2: build and
// publish" workflows (see docs/RELEASING.md).
//
//   node scripts/release.mjs prepare <patch|minor|major|keep|X.Y.Z> [--date YYYY-MM-DD] [--notes-out FILE] [--dry-run]
//       Raise the version everywhere (package.json, package-lock.json, Cargo.toml,
//       Cargo.lock), move the changelog's Unreleased notes under the new version and
//       add it to the AppStream file. Prints the new version.
//   node scripts/release.mjs check [VERSION]
//       Check that every file has the same version (and, with VERSION, that it's that
//       one and the changelog has its notes).
//   node scripts/release.mjs notes VERSION
//       Print the changelog notes for VERSION.
//   node scripts/release.mjs current
//       Print the current version.
//
// In GitHub Actions, prepare and check also write version= to $GITHUB_OUTPUT.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addMetainfoRelease,
  BUMPS,
  cargoTomlVersion,
  metainfoVersion,
  nextVersion,
  parseVersion,
  releaseChangelog,
  releaseNotes,
  setCargoLockVersions,
  setCargoTomlVersion,
} from "./release-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_URL = "https://github.com/Rick8509/TuxNotes";
const CRATES = ["tuxnotes", "tuxnotes-core", "tuxnotes-gdrive"];
const FILES = {
  package: "package.json",
  lock: "package-lock.json",
  cargo: "Cargo.toml",
  cargoLock: "Cargo.lock",
  changelog: "CHANGELOG.md",
  metainfo: "packaging/io.github.Rick8509.TuxNotes.metainfo.xml",
};

const read = (f) => readFileSync(join(root, f), "utf8");
const readJson = (f) => JSON.parse(read(f));
const writeJson = (f, value) => writeFileSync(join(root, f), JSON.stringify(value, null, 2) + "\n");

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function output(version) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
}

function option(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

/** Every place that holds the version, and what it says. */
function versions() {
  const lock = readJson(FILES.lock);
  const cargoLock = read(FILES.cargoLock);
  const found = {
    [FILES.package]: readJson(FILES.package).version,
    [FILES.lock]: lock.version,
    [`${FILES.lock} (packages[""])`]: lock.packages?.[""]?.version,
    [FILES.cargo]: cargoTomlVersion(read(FILES.cargo)),
    [FILES.metainfo]: metainfoVersion(read(FILES.metainfo)),
  };
  for (const name of CRATES) {
    found[`${FILES.cargoLock} (${name})`] = new RegExp(`\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`).exec(cargoLock)?.[1];
  }
  return found;
}

function check(expected) {
  const found = versions();
  const want = expected ?? found[FILES.package];
  const wrong = Object.entries(found).filter(([, v]) => v !== want);
  if (wrong.length) {
    fail(`Versions don't match ${want}: ${wrong.map(([f, v]) => `${f} has ${v ?? "none"}`).join(", ")}`);
  }
  if (expected && releaseNotes(read(FILES.changelog), expected) === null) {
    fail(`CHANGELOG.md has no "## ${expected} - <date>" section`);
  }
  return want;
}

function prepare(args) {
  const bump = args[0];
  if (!bump) fail(`Say how to change the version: ${BUMPS.join(", ")} or an exact version`);
  const current = check();
  let version;
  try {
    version = nextVersion(current, bump);
  } catch (e) {
    fail(e.message);
  }
  const date = option(args, "--date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date must look like 2026-12-31, not "${date}"`);

  let changelog;
  try {
    // "keep" may re-open a release that was prepared but never published.
    changelog = releaseChangelog(read(FILES.changelog), version, date, { reopen: version === current });
  } catch (e) {
    fail(e.message);
  }
  const notes = releaseNotes(changelog, version);

  if (!args.includes("--dry-run")) {
    const pkg = readJson(FILES.package);
    pkg.version = version;
    writeJson(FILES.package, pkg);
    const lock = readJson(FILES.lock);
    lock.version = version;
    lock.packages[""].version = version;
    writeJson(FILES.lock, lock);
    writeFileSync(join(root, FILES.cargo), setCargoTomlVersion(read(FILES.cargo), version));
    writeFileSync(join(root, FILES.cargoLock), setCargoLockVersions(read(FILES.cargoLock), CRATES, version));
    writeFileSync(join(root, FILES.metainfo), addMetainfoRelease(read(FILES.metainfo), version, date, REPO_URL));
    writeFileSync(join(root, FILES.changelog), changelog);
    check(version);
  }
  const notesOut = option(args, "--notes-out");
  if (notesOut) writeFileSync(notesOut, notes + "\n");
  output(version);
  console.log(version);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "prepare":
    prepare(args);
    break;
  case "check": {
    if (args[0]) {
      try {
        parseVersion(args[0]);
      } catch (e) {
        fail(e.message);
      }
    }
    const version = check(args[0]);
    output(version);
    console.log(`All files say ${version}`);
    break;
  }
  case "notes": {
    const notes = args[0] && releaseNotes(read(FILES.changelog), args[0]);
    if (!notes) fail(`CHANGELOG.md has no notes for ${args[0] ?? "(no version given)"}`);
    console.log(notes);
    break;
  }
  case "current":
    console.log(readJson(FILES.package).version);
    break;
  default:
    fail("Usage: node scripts/release.mjs prepare|check|notes|current … (see the top of this file)");
}
