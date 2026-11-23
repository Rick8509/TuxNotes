// Pure helpers for scripts/release.mjs: version numbers, the changelog and the
// AppStream file. No file access here, so everything is easy to test
// (scripts/release-lib.test.mjs).

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-(beta)\.(\d+))?$/;

/** "1.2.3" or "1.2.3-beta.4" → parts; anything else throws. */
export function parseVersion(v) {
  const m = VERSION.exec(v);
  if (!m) throw new Error(`"${v}" isn't a version like 1.2.3 or 1.2.3-beta.1`);
  return { major: +m[1], minor: +m[2], patch: +m[3], beta: m[4] ? +m[5] : null };
}

const format = ({ major, minor, patch, beta }) => `${major}.${minor}.${patch}${beta === null ? "" : `-beta.${beta}`}`;

export const BUMPS = ["patch", "minor", "major", "beta", "keep"];

/**
 * The next version after `current`:
 * - patch: 1.2.3 → 1.2.4 (a beta 1.3.0-beta.2 → 1.3.0, its final release)
 * - minor: 1.2.3 → 1.3.0 (1.3.0-beta.2 → 1.3.0)
 * - major: 1.2.3 → 2.0.0 (2.0.0-beta.2 → 2.0.0)
 * - beta:  1.2.3 → 1.3.0-beta.1, then 1.3.0-beta.2, …
 * - keep:  the current version (for the very first release)
 * - or an exact version such as "2.0.0" or "2.0.0-beta.1"
 */
export function nextVersion(current, bump) {
  const v = parseVersion(current);
  const isBeta = v.beta !== null;
  switch (bump) {
    case "keep":
      return current;
    case "patch":
      return isBeta ? format({ ...v, beta: null }) : format({ ...v, patch: v.patch + 1, beta: null });
    case "minor":
      return isBeta && v.patch === 0 ? format({ ...v, beta: null }) : format({ ...v, minor: v.minor + 1, patch: 0, beta: null });
    case "major":
      return isBeta && v.minor === 0 && v.patch === 0
        ? format({ ...v, beta: null })
        : format({ major: v.major + 1, minor: 0, patch: 0, beta: null });
    case "beta":
      return isBeta ? format({ ...v, beta: v.beta + 1 }) : format({ ...v, minor: v.minor + 1, patch: 0, beta: 1 });
    default: {
      parseVersion(bump); // throws for anything that isn't a version
      if (compareVersions(bump, current) <= 0 && bump !== current) {
        throw new Error(`${bump} is older than the current version ${current}`);
      }
      return bump;
    }
  }
}

/** Negative if a < b, 0 if equal, positive if a > b (a beta comes before its release). */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (const k of ["major", "minor", "patch"]) if (x[k] !== y[k]) return x[k] - y[k];
  if (x.beta === y.beta) return 0;
  if (x.beta === null) return 1;
  if (y.beta === null) return -1;
  return x.beta - y.beta;
}

export const isPrerelease = (v) => parseVersion(v).beta !== null;

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
  const type = isPrerelease(version) ? ' type="development"' : "";
  const entry =
    `    <release version="${version}" date="${date}"${type}>\n` +
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
