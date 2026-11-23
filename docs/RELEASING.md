# Releasing TuxNotes

Everything runs on GitHub: no local build, no tags by hand. A release takes three steps and about 25 minutes, most of it waiting.

## How it fits together

```
 work ──push──▶ dev ──"Release" button──▶ pull request "Release vX.Y.Z" ──merge──▶ main ──▶ GitHub Release vX.Y.Z
                 │                         (checks must be green)                          (.deb, .rpm, AppImage)
                 └─ every push is checked (CI)
```

- **`dev`** is where work happens and the repository's default branch. Every push and pull request runs the checks (`.github/workflows/ci.yml`).
- **`main`** only receives releases. It's protected: changes only through a pull request whose checks are all green.
- **Release** (`.github/workflows/release.yml`) prepares a release: it raises the version, moves the changelog notes under it, commits that to `dev` and opens the pull request into `main`.
- **Publish** (`.github/workflows/publish.yml`) runs when that pull request is merged: it builds the packages, signs a record of the build, tags the version and publishes the GitHub Release.

## Release a new version

1. **Write the notes.** Every user-visible change should have a line under `## Unreleased` in `CHANGELOG.md` (on `dev`). Those lines become the release notes. The release refuses to start when that section is empty.
2. **Start it.** On GitHub: **Actions → Release → Run workflow**, choose the kind of version (see below), click **Run workflow**. After a minute there's a pull request **"Release vX.Y.Z"**.
3. **Publish it.** Open the pull request. If GitHub shows **Approve and run workflows**, click it: GitHub asks this for pull requests opened by a bot, and the checks only start after it. Wait until the checks are green (about 10 minutes), read the notes, and click **Merge pull request**. Watch **Actions → Publish**: about 15 minutes later the release is on the [Releases page](https://github.com/Rick8509/TuxNotes/releases).

That's all. To update your own computer, install the new `.deb` from the release.

### Which version?

| Choice | Example | Use it for |
|---|---|---|
| **patch** | 0.1.0 → 0.1.1 | Fixes only |
| **minor** | 0.1.1 → 0.2.0 | New features (with or without fixes) |
| **major** | 0.9.0 → 1.0.0 | A big milestone, or changes that break old data or habits |
| **keep** | 0.1.0 → 0.1.0 | The very first release, or after closing a release pull request without merging it (see below) |
| exact version | 1.0.0 | When you want a specific number (must be higher than the current one) |

Versions are always `X.Y.Z`. Pre-release versions like `1.0.0-beta.1` aren't used, because Linux package managers would treat them as newer than `1.0.0`. For a test version, use a test run.

## Test run: build the packages without publishing

**Actions → Publish → Run workflow**, keep **Test run** ticked. It builds the `.deb`, `.rpm` and AppImage from `dev` and attaches them to the run (scroll down to *Artifacts → packages*). Nothing is tagged or published. Use it to try a version on your own computer before releasing, or to check that the packages still build after big changes.

## Before you release

- [ ] The checks on `dev` are green (the badge in the README, or **Actions → CI**).
- [ ] `CHANGELOG.md` has a line under `## Unreleased` for each change users will notice.
- [ ] If the look of the app changed: `npm run screenshots` and commit the new `docs/screenshots/` (they appear in the README and in software centres).
- [ ] For bigger releases: a test run, and install the `.deb` from it on your computer.

## When something goes wrong

| What you see | What to do |
|---|---|
| Release fails with **"Nothing to release"** | Add lines under `## Unreleased` in `CHANGELOG.md` on `dev`, then run Release again. |
| Release fails with **"A release is already waiting"** | Merge that pull request, or close it and run Release again. |
| Release fails with **"was already released"** | That version exists. Choose patch/minor/major, or a higher exact version. |
| A check fails on the release pull request | Fix it on `dev` and push. The pull request picks up the new commit and the checks run again. Merge when green. |
| The release pull request says **Merging is blocked** and no checks run | Look for **Approve and run workflows** on the pull request and click it. If there's no such button: **Actions → CI → Run workflow** (from `dev`). |
| You want to change the notes before publishing | Edit `CHANGELOG.md` on `dev` (under the version's heading) and push. |
| You closed a release pull request and want to release later | The version was already raised on `dev`. Next time, run Release with **keep**: it re-uses that version and adds any newer notes to it. |
| **Publish** failed (red X in Actions) | Nothing was published. Open the run to see which step failed. If GitHub had a hiccup, click **Re-run failed jobs**. If the code needs a fix: fix it on `dev`, then run Release with **patch**. |
| The release is published but has a bad bug | Fix it on `dev`, add a line to the changelog, run Release with **patch**. A published version is never changed or reused. |
| Need to publish again from `main` (e.g. after a GitHub outage) | **Actions → Publish → Run workflow → Use workflow from: main**, untick **Test run**. It publishes only if the version isn't released yet. |

## Things to know

- **Everything on `dev` goes into the next release.** Keep `dev` releasable: finish a feature on its own branch and merge it into `dev` when it's done.
- **Google Drive backup in releases:** add the repository secrets `TUXNOTES_GOOGLE_CLIENT_ID` and `TUXNOTES_GOOGLE_CLIENT_SECRET` (see [google-setup.md](google-setup.md)). The next release includes Google sign-in automatically. Without them, the Backup settings say it isn't available.
- **Check names are part of `main`'s protection.** The four CI jobs (*Core + Drive client*, *Frontend*, *Browser tests*, *App*) must pass before merging. If you rename a job in `ci.yml`, update **Settings → Branches → main** too, or merging will wait forever for a check that no longer exists.
- **What a release changes in the repository:** `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `CHANGELOG.md` and `packaging/io.github.Rick8509.TuxNotes.metainfo.xml`. A test fails if their versions ever disagree. `node scripts/release.mjs check` checks it by hand.
- **Dependency updates:** Dependabot opens bundled pull requests into `dev` on Mondays. Merge them when their checks are green; they go out with the next release.
- **Checking a download:** every release has `SHA256SUMS.txt`, and each package can be verified with `gh attestation verify <file> --repo Rick8509/TuxNotes`.

## Releasing by hand (only if GitHub Actions is unavailable)

```bash
git switch dev && git pull
node scripts/release.mjs prepare patch            # or minor / major / keep; prints the version
git commit -am "Release vX.Y.Z" && git push
# open and merge the pull request dev → main on GitHub, then:
git switch main && git pull
npx tauri build                                   # .deb, .rpm and AppImage in target/release/bundle/
gh release create vX.Y.Z target/release/bundle/{deb/*.deb,rpm/*.rpm,appimage/*.AppImage} \
  --target main --title "TuxNotes X.Y.Z" --notes "$(node scripts/release.mjs notes X.Y.Z)"
```
