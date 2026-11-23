import { describe, expect, it } from "vitest";
import {
  addMetainfoRelease,
  cargoTomlVersion,
  compareVersions,
  metainfoVersion,
  nextVersion,
  releaseChangelog,
  releaseNotes,
  setCargoLockVersions,
  setCargoTomlVersion,
  unreleasedNotes,
} from "./release-lib.mjs";

describe("nextVersion", () => {
  it.each([
    ["0.1.0", "keep", "0.1.0"],
    ["0.1.0", "patch", "0.1.1"],
    ["0.1.3", "minor", "0.2.0"],
    ["0.9.3", "major", "1.0.0"],
    ["0.1.0", "beta", "0.2.0-beta.1"],
    ["0.2.0-beta.1", "beta", "0.2.0-beta.2"],
    ["0.2.0-beta.2", "minor", "0.2.0"],
    ["0.2.0-beta.2", "patch", "0.2.0"],
    ["1.0.0-beta.3", "major", "1.0.0"],
    ["0.2.0-beta.2", "major", "1.0.0"],
    ["0.1.0", "1.0.0-beta.1", "1.0.0-beta.1"],
    ["0.1.0", "0.1.0", "0.1.0"],
  ])("%s + %s → %s", (current, bump, expected) => {
    expect(nextVersion(current, bump)).toBe(expected);
  });

  it("refuses older or malformed versions", () => {
    expect(() => nextVersion("0.2.0", "0.1.9")).toThrow(/older/);
    expect(() => nextVersion("0.2.0", "v0.3.0")).toThrow();
    expect(() => nextVersion("0.2.0", "huge")).toThrow();
    expect(() => nextVersion("0.2", "patch")).toThrow();
  });

  it("orders a beta before its release", () => {
    expect(compareVersions("1.0.0-beta.9", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.9")).toBeGreaterThan(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });
});

const CHANGELOG = `# Changelog

All notable changes.

## Unreleased

### Added
- Tables.

### Fixed
- A crash.

## 0.1.0 - 2026-11-23

### Added
- Notes.
`;

describe("changelog", () => {
  it("reads the unreleased and released notes", () => {
    expect(unreleasedNotes(CHANGELOG)).toBe("### Added\n- Tables.\n\n### Fixed\n- A crash.");
    expect(releaseNotes(CHANGELOG, "0.1.0")).toBe("### Added\n- Notes.");
    expect(releaseNotes(CHANGELOG, "0.1.1")).toBeNull();
    expect(releaseNotes(CHANGELOG, "0.1")).toBeNull();
  });

  it("moves the unreleased notes under the new version and keeps an empty Unreleased", () => {
    const out = releaseChangelog(CHANGELOG, "0.2.0", "2026-12-01");
    expect(out).toBe(`# Changelog

All notable changes.

## Unreleased

## 0.2.0 - 2026-12-01

### Added
- Tables.

### Fixed
- A crash.

## 0.1.0 - 2026-11-23

### Added
- Notes.
`);
    expect(unreleasedNotes(out)).toBe("");
    expect(releaseNotes(out, "0.2.0")).toBe("### Added\n- Tables.\n\n### Fixed\n- A crash.");
  });

  it("works for the very first release", () => {
    const first = "# Changelog\n\n## Unreleased\n\n### Added\n- Everything.\n";
    const out = releaseChangelog(first, "0.1.0", "2026-11-24");
    expect(out).toBe("# Changelog\n\n## Unreleased\n\n## 0.1.0 - 2026-11-24\n\n### Added\n- Everything.\n");
  });

  it("re-opens a prepared but unpublished version, adding newer notes on top", () => {
    const prepared = releaseChangelog(CHANGELOG, "0.2.0", "2026-12-01");
    const withMore = prepared.replace("## Unreleased\n\n", "## Unreleased\n\n### Fixed\n- Another fix.\n\n");
    const out = releaseChangelog(withMore, "0.2.0", "2026-12-03", { reopen: true });
    expect(unreleasedNotes(out)).toBe("");
    expect(out).toContain("## 0.2.0 - 2026-12-03\n\n### Fixed\n- Another fix.\n\n### Added\n- Tables.");
    expect(out).not.toContain("2026-12-01");
    expect(releaseNotes(out, "0.1.0")).toBe("### Added\n- Notes.");
    // Nothing new: only the date changes.
    const again = releaseChangelog(prepared, "0.2.0", "2026-12-04", { reopen: true });
    expect(again).toBe(prepared.replace("## 0.2.0 - 2026-12-01", "## 0.2.0 - 2026-12-04"));
  });

  it("refuses an empty release or a version that's already there", () => {
    const empty = "# Changelog\n\n## Unreleased\n\n## 0.1.0 - 2026-11-23\n\n- Notes.\n";
    expect(() => releaseChangelog(empty, "0.1.1", "2026-12-01")).toThrow(/Nothing to release/);
    expect(() => releaseChangelog(CHANGELOG, "0.1.0", "2026-12-01")).toThrow(/already/);
    expect(() => releaseChangelog("# Changelog\n", "0.1.0", "2026-12-01")).toThrow(/Unreleased/);
  });
});

const METAINFO = `<component>
  <releases>
    <release version="0.1.0" date="2026-11-23">
      <url type="details">https://example.com/releases/tag/v0.1.0</url>
    </release>
  </releases>
</component>
`;

describe("metainfo", () => {
  it("adds the new release on top", () => {
    const out = addMetainfoRelease(METAINFO, "0.2.0", "2026-12-01", "https://example.com");
    expect(metainfoVersion(out)).toBe("0.2.0");
    expect(out).toContain('<release version="0.2.0" date="2026-12-01">\n      <url type="details">https://example.com/releases/tag/v0.2.0</url>');
    expect(out).toContain('<release version="0.1.0" date="2026-11-23">');
  });

  it("marks betas as development releases", () => {
    const out = addMetainfoRelease(METAINFO, "0.2.0-beta.1", "2026-12-01", "https://example.com");
    expect(out).toContain('<release version="0.2.0-beta.1" date="2026-12-01" type="development">');
  });

  it("updates the date when the version is already listed", () => {
    const out = addMetainfoRelease(METAINFO, "0.1.0", "2026-11-30", "https://example.com");
    expect(out.match(/<release /g)).toHaveLength(1);
    expect(out).toContain('<release version="0.1.0" date="2026-11-30">');
  });
});

describe("version files", () => {
  const toml = `[workspace]\nmembers = ["a"]\n\n[workspace.package]\nversion = "0.1.0"\nedition = "2024"\n\n[workspace.dependencies]\nserde = { version = "1" }\n`;
  const lock = `[[package]]\nname = "serde"\nversion = "1.0.0"\n\n[[package]]\nname = "tuxnotes"\nversion = "0.1.0"\n\n[[package]]\nname = "tuxnotes-core"\nversion = "0.1.0"\n`;

  it("sets the workspace version and leaves dependencies alone", () => {
    const out = setCargoTomlVersion(toml, "0.2.0");
    expect(cargoTomlVersion(out)).toBe("0.2.0");
    expect(out).toContain('serde = { version = "1" }');
  });

  it("sets only the named crates in Cargo.lock", () => {
    const out = setCargoLockVersions(lock, ["tuxnotes", "tuxnotes-core"], "0.2.0");
    expect(out).toContain('name = "tuxnotes"\nversion = "0.2.0"');
    expect(out).toContain('name = "tuxnotes-core"\nversion = "0.2.0"');
    expect(out).toContain('name = "serde"\nversion = "1.0.0"');
    expect(() => setCargoLockVersions(lock, ["missing"], "0.2.0")).toThrow(/missing/);
  });
});
