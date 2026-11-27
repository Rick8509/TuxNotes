# Contributing to TuxNotes

Thanks for helping! This guide covers everything needed to work on TuxNotes: setting up, how the code is organized, the rules that keep people's notes safe, the tests, and how changes get released.

- **Bugs and ideas:** [open an issue](https://github.com/Rick8509/TuxNotes/issues/new/choose) (there are templates for both).
- **Security problems:** report them privately, see [SECURITY.md](SECURITY.md).
- **Code:** read on. Pull requests go to the `dev` branch.

## Set up

### Requirements (Debian/Ubuntu)

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libxdo-dev build-essential curl wget file
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust 1.90 or newer
```

You also need **Node.js 20 or newer**, and **Google Chrome or Chromium** for the browser tests. For Fedora, Arch and others, see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux). Spell checking uses the Hunspell dictionaries installed on the system (for example `hunspell-en-us`).

### Run it

```bash
npm install            # first time, and after dependencies change
npm run app:dev        # runs "TuxNotes Dev" from the code
```

`npm run app:dev` runs **TuxNotes Dev**: the same app with its own app ID (`io.github.Rick8509.TuxNotes.Dev`), notes folder, settings and keyring entries, a DEV badge and an orange icon. Your real notes are never touched. (`npm run tauri dev` runs it as the real TuxNotes, with your real notes.)

Leave it running while you work. Changes in `src/` appear almost instantly; changes in Rust (`src-tauri/`, `crates/`) recompile and restart the app (5–20 s). The first build takes a few minutes.

**Without Rust:** `npm run dev` serves the interface at http://localhost:1420 in a normal browser, with a built-in mock backend (`src/lib/mock.ts`) that keeps data in `localStorage`. `?window=files` shows the Files window.

### Build packages

To try your changes as an installed app, build TuxNotes Dev. It installs next to TuxNotes (package `tux-notes-dev`, command `tuxnotes-dev`):

```bash
npm run build:dev -- --bundles deb   # only the .deb (fastest); without it: .deb, .rpm and AppImage
sudo apt install ./target/release/bundle/deb/TuxNotes\ Dev_*_amd64.deb
```

Its version is the current one plus `-dev.<number of commits>`, so each build installs over the previous one. The real app is built with `npx tauri build`; releases do that on GitHub.

## How the code is organized

TuxNotes is a [Tauri 2](https://tauri.app) app: a Rust backend and a Svelte 5 interface running in the system's WebKitGTK.

```
crates/tuxnotes-core/     The storage engine, with no GUI parts
  src/store.rs              notes, folders, search, Recently Deleted
  src/migrations.rs         database schema versions (SQLite)
  src/lock.rs, crypto.rs    locked notes: Argon2id + XChaCha20-Poly1305
  src/attachments.rs        pictures and files stored next to the database
  src/backup.rs             backup archives (zip with a manifest and checksums)
  src/encrypted_backup.rs   encrypted backups (streamed in authenticated chunks)
crates/tuxnotes-gdrive/   Google sign-in (loopback + PKCE) and the Google Drive client
src-tauri/src/            The desktop app
  lib.rs                    start-up, windows, the automatic-backup timer
  commands.rs               the commands the interface calls (IPC)
  backup_service.rs         back up and restore, to a folder or Google Drive
  backup_folder.rs          backups in a folder (USB drive, Nextcloud, …)
  files.rs                  the Files window: reading and safely saving text files
  export.rs                 Markdown and PDF export, Markdown import
  spelling.rs, updates.rs   spell checking dictionaries, the new-version check
  settings.rs, credentials.rs  settings file, system keyring
  identity.rs, legacy_id.rs    TuxNotes vs TuxNotes Dev, moving data from the old app ID
src/                      The interface (Svelte 5, TipTap editor)
  App.svelte                the notes window; lib/components/ has its parts
  lib/stores/               app state (notes, folders, selection), preferences, layout
  lib/editor/               editor extensions: slash commands, code blocks, checklists, search
  lib/commands.ts           the command palette's actions
  lib/api.ts, lib/mock.ts   calls into Rust, and the browser mock that stands in for it
  files/                    the Files window: tabs, CodeMirror, Markdown as a page
  styles/                   colours and note styles shared by both windows
tests/e2e/                Browser tests (Puppeteer against the mock backend)
scripts/                  Releases, dev builds and screenshots
packaging/                The .desktop file and the app store description (AppStream)
```

The interface never touches files directly: everything goes through the commands in `commands.rs`, which call `tuxnotes-core`. That keeps the storage engine testable on its own.

## Rules that keep notes safe

People trust TuxNotes with their notes, so these matter more than anything else:

- **Never lose or damage data.** Writes are atomic (a new file replaces the old one only when it's complete), restores keep a safety copy first, and anything uncertain opens read-only rather than risking an overwrite.
- **Database changes are migrations.** Add a new step to `crates/tuxnotes-core/src/migrations.rs`; never change an old one. A newer schema can't be opened by older TuxNotes builds, so mention it under *Compatibility* in the changelog.
- **Notes must keep opening.** A note containing something this version can't show opens read-only with its text visible. New kinds of content need the same care.
- **Backups are a contract.** Old backups must keep restoring. Restoring checks sizes, checksums and paths, and an encrypted backup must still be encrypted when restored.
- **Secrets stay secret.** Passwords and keys are wiped from memory after use and never logged. Never commit secrets (Google client files, `.env`), real notes or personal data, also not in tests or screenshots.
- **Plain language.** Buttons, messages and docs say what happens in words anyone understands, without technical terms.

## Checks

Run these before you push. GitHub runs the same ones (**Checks**) on every push and pull request.

```bash
cargo fmt --all                                         # format Rust code
cargo clippy --workspace --all-targets -- -D warnings   # Rust lints
cargo test --workspace                                  # storage, Drive client and app tests
npm run check && npm test                               # type checks and interface unit tests
npm run test:e2e                                        # browser tests
```

The browser tests drive the app in Chrome or Chromium with the mock backend. Set `CHROME=/path/to/chrome` if it isn't found; `npm run test:e2e -- backup` runs only the matching test files. When you add a feature, add a test for it: Rust tests for storage and file handling, a browser test (`tests/e2e/*.test.mjs`) for what people click and type.

## Making a change

1. Branch from `dev`, and keep each pull request to one feature or fix.
2. Add a line under **## Unreleased** in [CHANGELOG.md](CHANGELOG.md) for anything users will notice. Those lines become the release notes.
3. If the look changed, run `npm run screenshots` and commit the new `docs/screenshots/` (they're used here and in software centres).
4. Open the pull request against `dev`; the template lists what to check.

## Releases

`main` only receives releases. A release is made from GitHub in a few clicks: **Actions → Prepare Release**, then merge the pull request it opens; the packages are built, signed and published automatically. The full playbook, including dev builds and what to do when something goes wrong, is in [docs/RELEASING.md](docs/RELEASING.md).

To build TuxNotes with Google Drive backup, you need your own Google client: see [docs/google-setup.md](docs/google-setup.md).
