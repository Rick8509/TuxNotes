// Pure helpers for scripts/release.mjs: version numbers, the changelog and the
// AppStream file. No file access here, so everything is easy to test
// (scripts/release-lib.test.mjs).

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** "1.2.3" → parts; anything else throws. */
export function parseVersion(v) {
  const m = VERSION.exec(v);
  if (!m) {
    const hint = /^\d+\.\d+\.\d+-/.test(v)
      ? " Pre-release versions such as 1.0.0-beta.1 aren't used: Linux packages would treat them as newer than 1.0.0. For a test version, use a test run of \"Build and Publish\" (docs/RELEASING.md)."
      : "";
    throw new Error(`"${v}" isn't a version like 1.2.3.${hint}`);
  }
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

const format = ({ major, minor, patch }) => `${major}.${minor}.${patch}`;

export const BUMPS = ["patch", "minor", "major", "keep"];

/**
 * The next version after `current`:
 * - patch: 1.2.3 → 1.2.4 (fixes only)
 * - minor: 1.2.3 → 1.3.0 (new features)
 * - major: 1.2.3 → 2.0.0 (a big milestone)
 * - keep:  the current version (the very first release, or one prepared but not published)
 * - or an exact, higher version such as "2.0.0"
 */
export function nextVersion(current, bump) {
  const v = parseVersion(current);
  switch (bump) {
    case "keep":
      return current;
    case "patch":
      return format({ ...v, patch: v.patch + 1 });
    case "minor":
      return format({ ...v, minor: v.minor + 1, patch: 0 });
    case "major":
      return format({ major: v.major + 1, minor: 0, patch: 0 });
    default: {
      parseVersion(bump); // throws for anything that isn't a version
      if (compareVersions(bump, current) < 0) throw new Error(`${bump} is older than the current version ${current}`);
      return bump;
    }
  }
}

/** Negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (const k of ["major", "minor", "patch"]) if (x[k] !== y[k]) return x[k] - y[k];
  return 0;
}

// ---------------------------------------------------------------- changelog

const UNRELEASED = /^## Unreleased[ \t]*$/m;
const SECTION = /^## /m;

/** The text under "## Unreleased" (without the heading), trimmed. */
export function unreleasedNotes(changelog) {
  const m = UNRELEASED.exec(changelog);
  if (!m) throw new Error('CHANGELOG.md has no "## Unreleased" section');
  const rest = changelog.slice(m.index + m[0].length);
  const end = rest.search(SECTION);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/** The notes for one released version, or null if it isn't in the changelog. */
export function releaseNotes(changelog, version) {
  const heading = new RegExp(`^## \\[?${version.replace(/\./g, "\\.")}\\]?(?: |$).*$`, "m");
  const m = heading.exec(changelog);
  if (!m) return null;
  const rest = changelog.slice(m.index + m[0].length);
  const end = rest.search(SECTION);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/**
 * Move the Unreleased notes under a new "## <version> - <date>" heading, leaving an
 * empty Unreleased section on top for the next changes.
 *
 * With `reopen`, a version that already has a section (a release that was prepared but
 * never published) gets the new date and any new Unreleased notes on top of its own.
 */
export function releaseChangelog(changelog, version, date, { reopen = false } = {}) {
  const notes = unreleasedNotes(changelog);
  if (releaseNotes(changelog, version) !== null) {
    if (!reopen) throw new Error(`CHANGELOG.md already has a section for ${version}`);
    return reopenSection(changelog, version, date, notes);
  }
  if (!notes) throw new Error('Nothing to release: "## Unreleased" in CHANGELOG.md is empty. Add a line for each change first.');
  const m = UNRELEASED.exec(changelog);
  const before = changelog.slice(0, m.index);
  const rest = changelog.slice(m.index + m[0].length);
  const end = rest.search(SECTION);
  const after = end === -1 ? "" : rest.slice(end);
  return `${before}## Unreleased\n\n## ${version} - ${date}\n\n${notes}\n${after ? `\n${after}` : ""}`;
}

function reopenSection(changelog, version, date, newNotes) {
  const v = version.replace(/\./g, "\\.");
  let out = changelog;
  if (newNotes) {
    const m = UNRELEASED.exec(out);
    const rest = out.slice(m.index + m[0].length);
    const end = rest.search(SECTION);
    out = `${out.slice(0, m.index)}## Unreleased\n\n${end === -1 ? "" : rest.slice(end)}`;
  }
  const heading = new RegExp(`^## \\[?${v}\\]?(?: .*)?$\\n*`, "m");
  return out.replace(heading, `## ${version} - ${date}\n\n${newNotes ? `${newNotes}\n\n` : ""}`);
}

// ---------------------------------------------------------------- AppStream

/** Add (or update) the <release> entry for a version at the top of <releases>. */
export function addMetainfoRelease(xml, version, date, repoUrl) {
  const entry =
    `    <release version="${version}" date="${date}">\n` +
    `      <url type="details">${repoUrl}/releases/tag/v${version}</url>\n` +
    `    </release>\n`;
  const existing = new RegExp(`[ \\t]*<release version="${version.replace(/\./g, "\\.")}"[\\s\\S]*?</release>\\n`);
  if (existing.test(xml)) return xml.replace(existing, entry);
  if (!/<releases>\n/.test(xml)) throw new Error("the metainfo file has no <releases> section");
  return xml.replace(/<releases>\n/, `<releases>\n${entry}`);
}

/** The newest version listed in the metainfo file. */
export function metainfoVersion(xml) {
  return /<release version="([^"]+)"/.exec(xml)?.[1] ?? null;
}

// ---------------------------------------------------------------- version files

/** Set the [workspace.package] version in the root Cargo.toml. */
export function setCargoTomlVersion(toml, version) {
  const re = /(\[workspace\.package\][^[]*?\nversion = ")[^"]+(")/;
  if (!re.test(toml)) throw new Error("Cargo.toml has no [workspace.package] version");
  return toml.replace(re, `$1${version}$2`);
}

export function cargoTomlVersion(toml) {
  return /\[workspace\.package\][^[]*?\nversion = "([^"]+)"/.exec(toml)?.[1] ?? null;
}

/** Set the version of the given crates in Cargo.lock. */
export function setCargoLockVersions(lock, crates, version) {
  let out = lock;
  for (const name of crates) {
    const re = new RegExp(`(\\[\\[package\\]\\]\\nname = "${name}"\\nversion = ")[^"]+(")`);
    if (!re.test(out)) throw new Error(`Cargo.lock has no package "${name}"`);
    out = out.replace(re, `$1${version}$2`);
  }
  return out;
}
