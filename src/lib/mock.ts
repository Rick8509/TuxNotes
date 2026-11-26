// In-memory stand-in for the Rust backend, used only when running in a plain browser.
// It mirrors the main rules of tuxnotes-core closely enough for UI work; the Rust
// crate remains the source of truth (and is what the tests cover).

import { extractText, isBlank } from "./text";
import { registerPreviewUrl } from "./attachmentUrls";
import type { AttachResult, Attachment, MarkdownFile, BackupInfo, BackupStatus, DocJSON, Folder, LockStatus, Note, NoteFilter, NoteSummary } from "./types";
import { BACKUP_PASSWORD_NEEDED, IMAGE_MIMES, MAX_ATTACHMENT_BYTES } from "./types";

const STORAGE_KEY = "tuxnotes-mock-v1";

interface MockNote extends Note {
  snippet: string;
  plain: string;
}

interface MockDb {
  folders: Omit<Folder, "noteCount">[];
  notes: MockNote[];
  /** Locked-notes password (the mock keeps it in plain text; the real app never does). */
  lock?: { password: string; hint: string };
}

/** Like the real app's in-memory key: forgotten on reload. */
let mockUnlocked = false;

let lastTs = 0;
const now = () => (lastTs = Math.max(Date.now(), lastTs + 1));
const uid = () => crypto.randomUUID();
const emptyDoc = (): DocJSON => ({ type: "doc", content: [{ type: "paragraph" }] });

function load(): MockDb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as MockDb;
  } catch {
    /* ignore corrupt mock data */
  }
  const t = now();
  return {
    folders: [{ id: uid(), name: "Notes", isDefault: true, parentId: null, sortOrder: 0, createdAt: t, updatedAt: t }],
    notes: [],
  };
}

let db = load();
const persist = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(db));

const fail = (msg: string): never => {
  throw msg;
};
const defaultFolder = () => db.folders.find((f) => f.isDefault)!;
const folderById = (id: string) => db.folders.find((f) => f.id === id) ?? fail(`folder not found: ${id}`);
const noteById = (id: string) => db.notes.find((n) => n.id === id) ?? fail(`note not found: ${id}`);
const active = (id: string) => {
  const n = noteById(id);
  if (n.deletedAt !== null) fail("This note is in Recently Deleted. Restore it to make changes.");
  return n;
};

function withCount(f: Omit<Folder, "noteCount">): Folder {
  return { ...f, noteCount: db.notes.filter((n) => n.folderId === f.id && n.deletedAt === null).length };
}

function summary(n: MockNote): NoteSummary {
  const { id, folderId, title, snippet, isPinned, createdAt, updatedAt, deletedAt } = n;
  return { id, folderId, title, snippet, isPinned, createdAt, updatedAt, deletedAt, isLocked: !!n.isLocked };
}

function note(n: MockNote): Note {
  const { snippet: _s, plain: _p, ...rest } = n;
  const copy = structuredClone(rest);
  copy.isLocked = !!n.isLocked;
  if (copy.isLocked && !mockUnlocked) copy.content = null;
  return copy;
}

function lockStatus(): LockStatus {
  return {
    passwordSet: !!db.lock,
    unlocked: mockUnlocked,
    hint: db.lock?.hint ?? "",
    lockedNotes: db.notes.filter((n) => n.isLocked).length,
  };
}

function checkNewPassword(password: string, hint: string): string {
  if ([...password].length < 4) fail("Use a password of at least 4 characters.");
  const h = hint.trim();
  if (h && h.toLowerCase().includes(password.toLowerCase())) fail("The hint can't contain the password.");
  return h;
}

function requireUnlocked() {
  if (!db.lock) fail("Set a password for locked notes first.");
  if (!mockUnlocked) fail("This note is locked. Enter the password to open it.");
}

function checkFolderName(name: string, parentId: string | null, existingId?: string): string {
  const trimmed = name.trim();
  if (!trimmed) fail("Folder name can't be empty.");
  if ([...trimmed].length > 100) fail("Folder name can't be longer than 100 characters.");
  const lower = trimmed.toLowerCase();
  if (db.folders.some((f) => f.id !== existingId && (f.parentId ?? null) === parentId && f.name.toLowerCase() === lower)) {
    fail(`A folder named "${trimmed}" already exists here.`);
  }
  return trimmed;
}

function mockDescendants(id: string): string[] {
  const out: string[] = [];
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const f of db.folders.filter((x) => x.parentId === cur)) {
      if (!out.includes(f.id)) {
        out.push(f.id);
        queue.push(f.id);
      }
    }
  }
  return out;
}

const byListOrder = (a: MockNote, b: MockNote) =>
  Number(b.isPinned) - Number(a.isPinned) || b.updatedAt - a.updatedAt;

type Args = Record<string, any>;

const handlers: Record<string, (a: Args) => unknown> = {
  list_folders: () =>
    [...db.folders]
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.sortOrder - b.sortOrder)
      .map(withCount),
  create_folder: ({ name, parentId }) => {
    const t = now();
    if (parentId) folderById(parentId);
    const f = {
      id: uid(),
      name: checkFolderName(name, parentId ?? null),
      isDefault: false,
      parentId: parentId ?? null,
      sortOrder: Math.max(...db.folders.map((x) => x.sortOrder)) + 1,
      createdAt: t,
      updatedAt: t,
    };
    db.folders.push(f);
    return withCount(f);
  },
  rename_folder: ({ id, name }) => {
    const f = folderById(id);
    if (f.isDefault) fail("The default folder can't be renamed.");
    f.name = checkFolderName(name, f.parentId ?? null, id);
    f.updatedAt = now();
    return withCount(f);
  },
  move_folder: ({ id, parentId, index }) => {
    const f = folderById(id);
    if (f.isDefault) fail("The default folder can't be moved.");
    if (parentId && (parentId === id || mockDescendants(id).includes(parentId))) fail("A folder can't be moved into itself.");
    checkFolderName(f.name, parentId ?? null, id);
    const siblings = db.folders
      .filter((x) => (x.parentId ?? null) === (parentId ?? null) && x.id !== id && !x.isDefault)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    siblings.splice(Math.min(index, siblings.length), 0, f);
    f.parentId = parentId ?? null;
    siblings.forEach((x, i) => (x.sortOrder = i + 1));
    return withCount(f);
  },
  delete_folder: ({ id }) => {
    const f = folderById(id);
    if (f.isDefault) fail("The default folder can't be deleted.");
    const doomed = [id, ...mockDescendants(id)];
    const t = now();
    let moved = 0;
    for (const n of db.notes.filter((n) => doomed.includes(n.folderId))) {
      n.folderId = defaultFolder().id;
      n.deletedAt ??= t;
      n.isPinned = false;
      moved++;
    }
    db.folders = db.folders.filter((x) => !doomed.includes(x.id));
    return moved;
  },
  list_notes: ({ filter }) => {
    filter = filter as NoteFilter;
    if (filter.kind === "trash") {
      return db.notes
        .filter((n) => n.deletedAt !== null)
        .sort((a, b) => b.deletedAt! - a.deletedAt!)
        .map(summary);
    }
    if (filter.kind === "folder") folderById(filter.folderId);
    return db.notes
      .filter((n) => n.deletedAt === null && (filter.kind === "all" || n.folderId === filter.folderId))
      .sort(byListOrder)
      .map(summary);
  },
  get_note: ({ id }) => note(noteById(id)),
  create_note: ({ folderId }) => {
    const t = now();
    const n: MockNote = {
      id: uid(),
      folderId: folderId ? folderById(folderId).id : defaultFolder().id,
      title: "",
      snippet: "",
      plain: "",
      content: emptyDoc(),
      isPinned: false,
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
      isLocked: false,
    };
    db.notes.push(n);
    return note(n);
  },
  update_note_content: ({ id, content }) => {
    // Browser tests can make saves fail, like a full disk would.
    if (localStorage.getItem("tuxnotes-mock-fail-saves")) fail("No space left on device (simulated).");
    if (content?.type !== "doc") fail("Note content must be a document.");
    const n = active(id);
    if (n.isLocked) requireUnlocked();
    const text = extractText(content);
    Object.assign(n, { content: structuredClone(content), ...text, updatedAt: now() });
    if (n.isLocked) Object.assign(n, { snippet: "", plain: "" });
    return summary(n);
  },
  lock_status: () => lockStatus(),
  set_lock_password: ({ password, hint }) => {
    if (db.lock) fail("A password for locked notes is already set.");
    db.lock = { password, hint: checkNewPassword(password, hint) };
    mockUnlocked = true;
    return lockStatus();
  },
  change_lock_password: ({ oldPassword, newPassword, hint }) => {
    if (!db.lock) fail("No password has been set for locked notes.");
    if (oldPassword !== db.lock!.password) fail("Wrong password.");
    db.lock = { password: newPassword, hint: checkNewPassword(newPassword, hint) };
    mockUnlocked = true;
    return lockStatus();
  },
  unlock_notes: ({ password }) => {
    if (!db.lock) fail("No password has been set for locked notes.");
    if (password !== db.lock!.password) fail("Wrong password.");
    mockUnlocked = true;
    return lockStatus();
  },
  lock_notes: () => {
    mockUnlocked = false;
    return lockStatus();
  },
  lock_note: ({ id }) => {
    const n = active(id);
    requireUnlocked();
    Object.assign(n, { isLocked: true, snippet: "", plain: "" });
    return summary(n);
  },
  remove_note_lock: ({ id }) => {
    const n = active(id);
    if (!n.isLocked) return summary(n);
    requireUnlocked();
    Object.assign(n, { isLocked: false, ...extractText(n.content!) });
    return summary(n);
  },
  duplicate_note: ({ id }) => {
    const src = active(id);
    if (src.isLocked) fail("Locked notes can't be duplicated. Remove the lock first.");
    const t = now();
    const copy: MockNote = { ...structuredClone(src), id: uid(), isPinned: false, createdAt: t, updatedAt: t, deletedAt: null };
    db.notes.push(copy);
    return note(copy);
  },
  set_note_pinned: ({ id, pinned }) => {
    const n = active(id);
    n.isPinned = pinned;
    return summary(n);
  },
  move_note: ({ id, folderId }) => {
    const n = active(id);
    n.folderId = folderById(folderId).id;
    return summary(n);
  },
  trash_note: ({ id }) => {
    const n = active(id);
    n.deletedAt = now();
    n.isPinned = false;
    return summary(n);
  },
  restore_note: ({ id }) => {
    const n = noteById(id);
    if (n.deletedAt === null) fail("This note isn't in Recently Deleted.");
    n.deletedAt = null;
    return summary(n);
  },
  delete_note_permanently: ({ id }) => {
    if (noteById(id).deletedAt === null) {
      fail("Move the note to Recently Deleted before deleting it permanently.");
    }
    db.notes = db.notes.filter((n) => n.id !== id);
  },
  empty_trash: () => {
    const before = db.notes.length;
    db.notes = db.notes.filter((n) => n.deletedAt === null);
    return before - db.notes.length;
  },
  trash_count: () => db.notes.filter((n) => n.deletedAt !== null).length,
  data_version: () => 0, // nothing else writes to the browser preview's notes
  discard_note_if_blank: ({ id }) => {
    const n = db.notes.find((x) => x.id === id);
    if (!n || n.deletedAt !== null || n.isLocked || !isBlank(n.content!)) return false;
    db.notes = db.notes.filter((x) => x.id !== id);
    return true;
  },
  search_notes: ({ query }) => {
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    return db.notes
      .filter((n) => n.deletedAt === null)
      .filter((n) => {
        const text = fold(`${n.title}\n${n.plain}`);
        const tokens = text.split(/[^\p{L}\p{N}]+/u);
        // Like the app: words in scripts written without spaces (CJK, Thai…) match anywhere.
        const unspaced = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\u0E00-\u0EFF\u1000-\u109F\u1780-\u17FF]/u;
        return words.every((w) => (unspaced.test(w) ? text.includes(fold(w)) : tokens.some((t) => t.startsWith(fold(w)))));
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(summary);
  },
};

// --------------------------------------------------------- fake Google Drive

type MockBackupFile = { info: BackupInfo; data: string; password: string | null };
const backup: BackupStatus & { files: MockBackupFile[]; cancel?: () => void; password: string | null } = {
  clientSource: "builtIn",
  signedIn: false,
  account: null,
  busy: null,
  autoBackup: "daily",
  keepBackups: 10,
  lastBackupAt: null,
  lastBackupError: null,
  encrypted: false,
  backupOnClose: true,
  files: [],
  password: null,
};
const status = (): BackupStatus => {
  const { files: _f, cancel: _c, password: _p, ...rest } = backup;
  return { ...rest, encrypted: backup.password !== null };
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const signedIn = () => backup.signedIn || fail("You're not signed in to Google Drive.");

// Files window: files come from localStorage "tuxnotes-mock-files" ([{ path, text }]);
// "Open File…" adds an example. Names ending in .bin behave like binary files, paths
// under /etc/ are read-only, and Save As saves to /home/you/Documents/. Tests can
// change or delete a file "outside TuxNotes" with __mockFileChange(path, text | null).
type MockFile = { path: string; name: string; text: string; modified: number; exists: boolean; encoding: string };
const mockFiles = new Map<string, MockFile>();
let mockPendingFiles: string[] = [];
let mockFilesSeeded = false;
let mockClock = Date.now();
const mockTick = () => (mockClock += 1000);
function mockRegisterFile(path: string, text: string, encoding = "UTF-8"): string {
  let id = [...mockFiles].find(([, f]) => f.path === path)?.[0];
  if (!id) {
    id = `f${mockFiles.size + 1}`;
    mockFiles.set(id, { path, name: path.split("/").pop() ?? path, text, modified: mockTick(), exists: true, encoding });
  }
  return id;
}
function mockQueueFile(path: string, text: string, encoding?: string) {
  const id = mockRegisterFile(path, text, encoding);
  if (!mockPendingFiles.includes(id)) mockPendingFiles.push(id);
}
function seedMockFiles() {
  if (mockFilesSeeded) return;
  mockFilesSeeded = true;
  try {
    const seed = JSON.parse(localStorage.getItem("tuxnotes-mock-files") ?? "[]") as { path: string; text: string; encoding?: string }[];
    for (const f of seed) mockQueueFile(f.path, f.text, f.encoding);
  } catch {
    /* no seed */
  }
}
function mockTextFile(id: string) {
  const f = mockFiles.get(id) ?? fail("That file isn't open.");
  if (!f.exists) fail(`Couldn't open “${f.name}”: it no longer exists`);
  if (f.name.endsWith(".bin")) fail(`“${f.name}” isn't a text file, so TuxNotes can't show it.`);
  return {
    id,
    path: f.path,
    name: f.name,
    text: f.text,
    encoding: f.encoding,
    lineEnding: f.text.includes("\r\n") ? "CRLF" : "LF",
    readOnly: f.path.startsWith("/etc/"),
    size: f.text.length,
    modified: f.modified,
  };
}
(globalThis as { __mockFileChange?: unknown }).__mockFileChange = (path: string, text: string | null) => {
  const f = [...mockFiles.values()].find((x) => x.path === path);
  if (!f) return;
  if (text === null) f.exists = false;
  else Object.assign(f, { text, exists: true, modified: mockTick() });
};
(globalThis as { __mockFileText?: unknown }).__mockFileText = (path: string) =>
  [...mockFiles.values()].find((x) => x.path === path)?.text ?? null;

// Spelling: pretend these dictionaries are installed; tests read the calls.
const MOCK_DICTIONARIES = ["de_DE", "en_GB", "en_US", "fr_FR"];
const spellingCalls: { enabled: boolean; languages: string[] }[] = [];
(globalThis as { __spellingCalls?: typeof spellingCalls }).__spellingCalls = spellingCalls;

Object.assign(handlers, {
  take_pending_files: () => {
    seedMockFiles();
    const ids = mockPendingFiles;
    mockPendingFiles = [];
    return ids.map((id) => ({ id, path: mockFiles.get(id)!.path, name: mockFiles.get(id)!.name }));
  },
  read_text_file: ({ id }: Args) => mockTextFile(id as string),
  file_status: ({ id }: Args) => {
    const f = mockFiles.get(id as string) ?? fail("That file isn't open.");
    return { exists: f.exists, modified: f.exists ? f.modified : 0, size: f.exists ? f.text.length : 0 };
  },
  save_text_file: ({ id, text, encoding, lineEnding, expectedModified, force }: Args) => {
    const f = mockFiles.get(id as string) ?? fail("That file isn't open.");
    if (f.path.startsWith("/etc/")) fail(`Couldn't save “${f.name}”: you don't have permission to change it`);
    if (!force && f.exists && expectedModified != null && f.modified !== expectedModified) fail("CHANGED_ON_DISK");
    if (encoding === "Windows-1252" && /[^\u0000-\u00ff]/.test(text as string)) fail("UNMAPPABLE");
    // Like the app: the editor's "\n" line breaks are saved as the file's own.
    const saved = lineEnding === "CRLF" ? (text as string).replace(/\r?\n/g, "\r\n") : text;
    Object.assign(f, { text: saved, encoding, exists: true, modified: mockTick() });
    return mockTextFile(id as string);
  },
  save_text_file_as: ({ id, text, encoding }: Args) => {
    const f = mockFiles.get(id as string) ?? fail("That file isn't open.");
    const newId = mockRegisterFile(`/home/you/Documents/copy of ${f.name}`, "");
    Object.assign(mockFiles.get(newId)!, { text, encoding, exists: true, modified: mockTick() });
    return mockTextFile(newId);
  },
  open_file_dialog: () => {
    mockQueueFile("/home/you/Documents/example.py", 'def greet(name):\n    print(f"Hello, {name}!")\n\ngreet("TuxNotes")\n');
    return 1;
  },
  spelling_info: () => ({ available: MOCK_DICTIONARIES, systemDefault: ["en_US"] }),
  set_spelling: ({ enabled, languages }: Args) => {
    const langs = (languages as string[]).length ? (languages as string[]) : ["en_US"];
    spellingCalls.push({ enabled: enabled as boolean, languages: languages as string[] });
    return enabled ? langs.filter((l) => MOCK_DICTIONARIES.includes(l)) : [];
  },
  backup_status: status,
  app_info: () => ({
    name: "TuxNotes",
    dev: false,
    version: "0.1.0 (browser preview)",
    dataDir: "~/.local/share/io.github.Rick8509.TuxNotes",
    database: "~/.local/share/io.github.Rick8509.TuxNotes/notes.db",
    configDir: "~/.config/io.github.Rick8509.TuxNotes",
  }),
  set_backup_preferences: ({ autoBackup, keepBackups, backupOnClose }: Args) => {
    Object.assign(backup, { autoBackup, keepBackups: Math.min(100, Math.max(1, keepBackups)), backupOnClose });
    return status();
  },
  set_backup_password: async ({ password }: Args) => {
    if (password !== null && [...String(password)].length < 8) fail("Use a backup password of at least 8 characters.");
    await wait(300);
    backup.password = password;
    return status();
  },
  backup_on_close_needed: () => false,
  backup_before_exit: () => false,
  google_sign_in: async () => {
    backup.busy = "signingIn";
    const cancelled = await Promise.race([
      wait(900).then(() => false),
      new Promise<boolean>((r) => (backup.cancel = () => r(true))),
    ]);
    backup.busy = null;
    if (cancelled) fail("Sign-in cancelled.");
    Object.assign(backup, { signedIn: true, account: "you@example.com" });
    return status();
  },
  google_cancel_sign_in: () => backup.cancel?.(),
  google_sign_out: () => {
    Object.assign(backup, { signedIn: false, account: null });
    return status();
  },
  backup_now: async () => {
    signedIn();
    backup.busy = "backingUp";
    await wait(600);
    const t = now();
    const data = JSON.stringify(db);
    const encrypted = backup.password !== null;
    const info: BackupInfo = {
      id: uid(),
      name: `tuxnotes-backup-${t}.zip${encrypted ? ".enc" : ""}`,
      createdAt: t,
      size: data.length,
      noteCount: encrypted ? null : db.notes.length,
      appVersion: "0.1.0",
      encrypted,
      needsPassword: false,
    };
    backup.files.unshift({ info, data, password: backup.password });
    backup.files = backup.files.slice(0, backup.keepBackups);
    Object.assign(backup, { busy: null, lastBackupAt: t, lastBackupError: null });
    return info;
  },
  list_backups: async () => {
    signedIn();
    await wait(300);
    return backup.files.map((f) => ({ ...f.info, needsPassword: f.password !== null && f.password !== backup.password }));
  },
  restore_backup: async ({ id, password }: Args) => {
    signedIn();
    const file = backup.files.find((f) => f.info.id === id) ?? fail("Backup not found.");
    if (file.password !== null) {
      if (password == null && file.password !== backup.password) fail(BACKUP_PASSWORD_NEEDED);
      if (password != null && password !== file.password) fail("Wrong password.");
      // Like the app: restoring with a typed password turns on encryption with it.
      if (password != null && backup.password === null) backup.password = password;
    }
    backup.busy = "restoring";
    await wait(600);
    db = JSON.parse(file.data);
    backup.busy = null;
    const info = file.info;
    return { noteCount: info.noteCount, folderCount: db.folders.length, backupCreatedAt: info.createdAt, safetyCopy: "(browser mock)" };
  },
});

export async function mockInvoke<T>(cmd: string, args: Args = {}): Promise<T> {
  const handler = handlers[cmd] ?? fail(`unknown command: ${cmd}`);
  const result = await handler(args);
  persist();
  return structuredClone(result) as T;
}

// --------------------------------------------------------------- attachments
// Kept in memory only (object URLs), which is enough for UI work in the browser.

const attachments = new Map<string, { attachment: Attachment; url: string }>();

export async function mockAddAttachment(noteId: string, file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`“${file.name}” is too large to attach (the limit is 50 MB).`);
  const name = (file.name || "pasted-image.png").split(/[\\/]/).pop() || "attachment";
  const attachment: Attachment = {
    id: uid(),
    noteId,
    filename: name,
    mime: IMAGE_MIMES.includes(file.type) ? file.type : file.type && !file.type.startsWith("image/") ? file.type : "application/octet-stream",
    size: file.size,
    sha256: "",
    createdAt: now(),
  };
  const url = URL.createObjectURL(file);
  attachments.set(attachment.id, { attachment, url });
  registerPreviewUrl(attachment.id, url);
  return attachment;
}

export function mockAttachFiles(noteId: string): Promise<AttachResult> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";
    input.onchange = async () => {
      const result: AttachResult = { attachments: [], errors: [] };
      for (const file of input.files ?? []) {
        try {
          result.attachments.push(await mockAddAttachment(noteId, file));
        } catch (e) {
          result.errors.push(String((e as Error).message ?? e));
        }
      }
      input.remove();
      resolve(result);
    };
    document.body.appendChild(input);
    input.click();
  });
}

export async function mockOpenAttachment(id: string) {
  const entry = attachments.get(id) ?? fail("attachment not found");
  window.open(entry.url, "_blank", "noopener");
}

export async function mockSaveAttachment(id: string): Promise<boolean> {
  const entry = attachments.get(id) ?? fail("attachment not found");
  const a = document.createElement("a");
  a.href = entry.url;
  a.download = entry.attachment.filename;
  a.click();
  return true;
}

// ------------------------------------------------------------ export / import

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

export async function mockExportMarkdown(title: string, markdown: string): Promise<string> {
  const name = `${(title || "Note").replace(/[\\/:*?"<>|]/g, "-")}.md`;
  download(name, new Blob([markdown], { type: "text/markdown" }));
  return name;
}

export async function mockPrint(): Promise<null> {
  window.print();
  return null;
}

export function mockPickMarkdownFiles(): Promise<MarkdownFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".md,.markdown,.txt";
    input.style.display = "none";
    input.onchange = async () => {
      const out: MarkdownFile[] = [];
      for (const f of input.files ?? []) out.push({ path: f.name, name: f.name.replace(/\.[^.]+$/, ""), text: await f.text() });
      input.remove();
      resolve(out);
    };
    document.body.appendChild(input);
    input.click();
  });
}
