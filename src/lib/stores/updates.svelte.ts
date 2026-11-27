// "A new version is out": once a day (Settings → General → Updates) TuxNotes asks GitHub
// for the latest release; a card in the sidebar shows a newer one until it's dismissed.
// The last answer is kept, so the card shows right away at the next start.
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, errorText, isTauri } from "../api";
import type { UpdateInfo } from "../types";
import { identity } from "./identity.svelte";
import { prefs } from "./prefs.svelte";

const KEY = "tuxnotes-update-v1";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Wait a little after starting before asking (startup stays quick). */
const FIRST_CHECK_DELAY = 10_000;

interface Saved {
  lastCheck: number;
  info: UpdateInfo | null;
  /** The version whose notice was closed. */
  dismissed: string | null;
}

/** "0.1.0-dev.84" → [0, 1, 0]: dev builds count as their base version (they come after it). */
function parts(v: string): number[] | null {
  // Text after the version is ignored ("0.1.0 (browser preview)").
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-(\S+))?/.exec(v.trim());
  if (!m) return null;
  if (m[4] && !m[4].startsWith("dev")) return null; // other pre-releases aren't offered
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** A release page TuxNotes may open (GitHub's answer is only trusted for its own repo). */
export function isReleasePage(url: string): boolean {
  return url.startsWith("https://github.com/Rick8509/TuxNotes/releases/");
}

/** Whether `latest` is newer than `current` (the same rule as updates.rs). */
export function isNewer(latest: string, current: string): boolean {
  const [l, c] = [parts(latest), parts(current)];
  if (!l || !c) return false;
  for (let i = 0; i < 3; i++) if (l[i] !== c[i]) return l[i] > c[i];
  return false;
}

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Saved> | null;
    return { lastCheck: Number(s?.lastCheck) || 0, info: s?.info ?? null, dismissed: s?.dismissed ?? null };
  } catch {
    return { lastCheck: 0, info: null, dismissed: null };
  }
}

class Updates {
  info = $state<UpdateInfo | null>(null);
  lastCheck = $state(0);
  dismissed = $state<string | null>(null);
  checking = $state(false);
  error = $state<string | null>(null);

  constructor() {
    if (typeof localStorage !== "undefined") Object.assign(this, load());
  }

  /** A newer version than this app (after updating, an old notice goes away by itself). */
  get newer(): UpdateInfo | null {
    const info = this.info;
    return info && identity.version && isNewer(info.latest, identity.version) ? info : null;
  }

  /** What the sidebar card shows: a newer version, not dismissed, with checks on. */
  get notice(): UpdateInfo | null {
    const info = this.newer;
    return info && prefs.checkUpdates && info.latest !== this.dismissed ? info : null;
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ lastCheck: this.lastCheck, info: this.info, dismissed: this.dismissed }));
    } catch {
      /* not remembered */
    }
  }

  async check() {
    if (this.checking) return;
    this.checking = true;
    this.error = null;
    try {
      this.info = await api.checkForUpdate();
      this.lastCheck = Date.now();
      this.save();
    } catch (e) {
      this.error = errorText(e);
    } finally {
      this.checking = false;
    }
  }

  /** Open the release page (downloads and what's new) in the web browser. */
  async openReleasePage() {
    const url = this.info?.url;
    if (!url || !isReleasePage(url)) return;
    if (isTauri) await openUrl(url);
    else window.open(url, "_blank", "noopener");
  }

  dismiss() {
    this.dismissed = this.info?.latest ?? null;
    this.save();
  }

  /** Background checks: a while after starting, then whenever a day has passed. Not in
   *  TuxNotes Dev (its versions are ahead of the latest release anyway). */
  start() {
    const due = () => prefs.checkUpdates && !identity.dev && Date.now() - this.lastCheck >= DAY;
    setTimeout(() => due() && void this.check(), FIRST_CHECK_DELAY);
    setInterval(() => due() && void this.check(), 3 * HOUR);
  }
}

export const updates = new Updates();
