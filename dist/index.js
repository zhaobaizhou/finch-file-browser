// src/index.ts
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs3 from "node:fs";
import os2 from "node:os";
import path3 from "node:path";

// src/paths.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var TEXT_EXTENSIONS = /* @__PURE__ */ new Set([
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".text",
  ".log",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".json5",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".vue",
  ".svelte",
  ".astro",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".php",
  ".lua",
  ".pl",
  ".r",
  ".jl",
  ".dart",
  ".scala",
  ".clj",
  ".ex",
  ".exs",
  ".erl",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".cmd",
  ".html",
  ".htm",
  ".xml",
  ".svg",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".styl",
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".tf",
  ".hcl",
  ".dockerfile",
  ".gitignore",
  ".npmrc",
  ".makefile",
  ".mk",
  ".cmake",
  ".gradle",
  ".patch",
  ".diff",
  ".rst",
  ".adoc",
  ".tex"
]);
var IMAGE_EXTENSIONS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif", ".svg"]);
var IGNORED_DIRS = /* @__PURE__ */ new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".pytest_cache",
  ".mypy_cache",
  ".idea",
  ".vscode",
  "dist",
  "build",
  "out",
  ".output",
  "target",
  "coverage",
  ".DS_Store",
  "$RECYCLE.BIN",
  "System Volume Information",
  ".Trash"
]);
var IGNORED_FILES = /* @__PURE__ */ new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
function extOf(filePath) {
  return path.extname(filePath).toLowerCase();
}
function classify(filePath, size, maxTextBytes) {
  const ext = extOf(filePath);
  const base = path.basename(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext) && ext !== ".svg") {
    return { kind: "image", editable: false, flavor: "image" };
  }
  if (ext === ".svg") return { kind: "text", editable: true, flavor: "svg" };
  const looksText = TEXT_EXTENSIONS.has(ext) || base.startsWith(".") || base === "makefile" || base === "dockerfile" || base === "license" || base === "readme";
  if (!looksText) return { kind: "binary", editable: false, flavor: "binary" };
  if (size > maxTextBytes) return { kind: "too-large", editable: false, flavor: "plain" };
  let flavor = "code";
  if (ext === ".md" || ext === ".markdown" || ext === ".mdx") flavor = "markdown";
  else if ([".txt", ".text", ".log", ".csv", ".tsv", ".rst", ".adoc"].includes(ext)) flavor = "plain";
  return { kind: "text", editable: true, flavor };
}
function resolveInside(root, rel) {
  const cleaned = String(rel ?? "").replace(/^[/\\]+/, "");
  const abs = path.resolve(root, cleaned);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) return null;
  if (abs.includes("\0")) return null;
  return abs;
}
function toRel(root, abs) {
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join("/");
}
var DEFAULT_LIST_OPTIONS = {
  showHidden: false,
  ignoreFolders: /* @__PURE__ */ new Set(),
  hideIgnoredFolders: false,
  textOnly: false,
  sortOrder: "name",
  maxTextBytes: 2 * 1024 * 1024
};
function isIgnoredFolder(name, options) {
  return IGNORED_DIRS.has(name) || options.ignoreFolders.has(name);
}
function readDirEntries(root, relDir, options = DEFAULT_LIST_OPTIONS) {
  const absDir = resolveInside(root, relDir);
  if (!absDir) return [];
  let names;
  try {
    names = fs.readdirSync(absDir);
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names) {
    if (IGNORED_FILES.has(name)) continue;
    if (!options.showHidden && name.startsWith(".")) continue;
    const abs = path.join(absDir, name);
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      continue;
    }
    const dir = stat.isDirectory();
    if (!dir && !stat.isFile() && !stat.isSymbolicLink()) continue;
    const ignored = dir && isIgnoredFolder(name, options);
    if (ignored && options.hideIgnoredFolders) continue;
    if (!dir && options.textOnly) {
      const classification = classify(abs, stat.size, options.maxTextBytes);
      if (classification.kind === "image" || classification.kind === "binary") continue;
    }
    const rel = toRel(root, abs);
    entries.push({
      name,
      rel,
      dir,
      size: dir ? 0 : stat.size,
      mtimeMs: stat.mtimeMs,
      ignored
    });
  }
  const byName = (a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
  entries.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    if (!a.dir && options.sortOrder === "recent" && a.mtimeMs !== b.mtimeMs) {
      return b.mtimeMs - a.mtimeMs;
    }
    return byName(a, b);
  });
  return entries;
}
function findFinchDataRoot(storagePath) {
  const candidates = [];
  const marker = `${path.sep}extension-data${path.sep}`;
  const idx = storagePath.indexOf(marker);
  if (idx > 0) candidates.push(storagePath.slice(0, idx));
  candidates.push(path.join(os.homedir(), ".finch"));
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, "pi"))) return candidate;
    } catch {
    }
  }
  return null;
}

// src/session.ts
import fs2 from "node:fs";
import path2 from "node:path";
var MAX_TRANSCRIPT_BYTES = 24 * 1024 * 1024;
var PATHISH = /^(?:\.{0,2}\/|~\/|\/)|[\\/]/;
function unescapeToken(token) {
  return token.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
function findTranscript(dataRoot, sessionId) {
  if (!dataRoot || !sessionId) return null;
  const sessionsDir = path2.join(dataRoot, "pi", "sessions");
  let workspaces;
  try {
    workspaces = fs2.readdirSync(sessionsDir);
  } catch {
    return null;
  }
  const suffix = `_${sessionId}.jsonl`;
  let newest = null;
  for (const workspace of workspaces) {
    const dir = path2.join(sessionsDir, workspace);
    let files;
    try {
      files = fs2.readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(suffix)) continue;
      const full = path2.join(dir, file);
      try {
        const stat = fs2.statSync(full);
        if (!newest || stat.mtimeMs > newest.mtime) newest = { file: full, mtime: stat.mtimeMs };
      } catch {
      }
    }
  }
  return newest?.file ?? null;
}
function readSessionMeta(transcriptPath, sessionId) {
  const meta = { sessionId, startedAtMs: 0, cwd: null, transcriptPath };
  if (!transcriptPath) return meta;
  let fd = null;
  try {
    fd = fs2.openSync(transcriptPath, "r");
    const buffer = Buffer.alloc(8192);
    const read = fs2.readSync(fd, buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, read).toString("utf8").split("\n")[0];
    const parsed = JSON.parse(firstLine);
    if (parsed.type === "session") {
      if (parsed.timestamp) meta.startedAtMs = Date.parse(parsed.timestamp) || 0;
      if (parsed.cwd) meta.cwd = parsed.cwd;
    }
  } catch {
  } finally {
    if (fd !== null) {
      try {
        fs2.closeSync(fd);
      } catch {
      }
    }
  }
  return meta;
}
function walkStrings(value, out) {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) walkStrings(item, out);
  }
}
function tokensFromText(text, out) {
  const slices = text.split(/[\s,;，；、。！？!?()[\]{}<>"'`]+/);
  for (const slice of slices) {
    const token = slice.replace(/[，。；：、！？）》”’]+$/u, "").trim();
    if (!token || token.length > 300) continue;
    if (!PATHISH.test(token)) continue;
    if (!/\.[A-Za-z0-9]{1,8}$/.test(token)) continue;
    out.push(token);
  }
}
function collectTouchedFiles(root, transcriptPath) {
  if (!transcriptPath) return [];
  let raw;
  try {
    const stat = fs2.statSync(transcriptPath);
    if (stat.size > MAX_TRANSCRIPT_BYTES) return [];
    raw = fs2.readFileSync(transcriptPath, "utf8");
  } catch {
    return [];
  }
  const ordered = /* @__PURE__ */ new Map();
  const register = (candidate, when, via) => {
    const value = unescapeToken(candidate).trim();
    if (!value || value.length > 400 || value.includes("\n")) return;
    const abs = path2.isAbsolute(value) ? path2.normalize(value) : resolveInside(root, value);
    if (!abs) return;
    const guarded = resolveInside(root, path2.relative(root, abs));
    if (!guarded) return;
    let stat;
    try {
      stat = fs2.statSync(guarded);
    } catch {
      return;
    }
    if (!stat.isFile()) return;
    const rel = toRel(root, guarded);
    const existing = ordered.get(rel);
    if (existing) {
      existing.hits += 1;
      existing.lastMs = Math.max(existing.lastMs, when);
      if (via === "tool") existing.via = "tool";
      return;
    }
    ordered.set(rel, { rel, abs: guarded, hits: 1, firstMs: when, lastMs: when, via });
  };
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.type !== "message" || !record.message) continue;
    const when = Date.parse(record.timestamp ?? "") || 0;
    const content = record.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "toolCall" && block.arguments) {
        const strings = [];
        walkStrings(block.arguments, strings);
        for (const candidate of strings) register(candidate, when, "tool");
      } else if (block.type === "text" && block.text) {
        const tokens = [];
        tokensFromText(String(block.text), tokens);
        for (const candidate of tokens) register(candidate, when, "text");
      }
    }
  }
  return [...ordered.values()].sort((a, b) => b.lastMs - a.lastMs);
}

// src/index.ts
var MAX_TEXT_BYTES = 2 * 1024 * 1024;
var SCAN_TTL_MS = 4e3;
var TOUCHED_TTL_MS = 3e3;
var WATCH_DEBOUNCE_MS = 350;
var SELF_WRITE_GRACE_MS = 4e3;
var SETTING_DEFAULTS = {
  showHidden: false,
  textOnly: false,
  hideIgnoredFolders: false,
  ignoreFolders: "node_modules\ndist\nbuild\nout\ntarget\ncoverage\n__pycache__\n.venv",
  sortOrder: "name",
  showModTime: false,
  scanLimit: 8e3,
  scanDepth: 10,
  markdownView: "preview",
  codeFontSize: 0,
  wrapLongLines: false,
  showLineNumbers: false,
  externalChange: "auto",
  keepHistory: true
};
function formatClock(ms) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
var OVERRIDABLE_KEYS = [
  "showHidden",
  "textOnly",
  "hideIgnoredFolders",
  "sortOrder",
  "showModTime"
];
var LISTING_KEYS = [
  "showHidden",
  "textOnly",
  "hideIgnoredFolders",
  "sortOrder",
  "showModTime",
  "scanLimit",
  "scanDepth",
  "ignoreFolders"
];
var OVERRIDES_STORAGE_KEY = "panelOverrides";
var TEXT = {
  "zh-CN": {
    noWorkspace: "\u8FD9\u4E2A\u5BF9\u8BDD\u8FD8\u6CA1\u6709\u7ED1\u5B9A\u6587\u4EF6\u5939",
    notFound: "\u6587\u4EF6\u4E0D\u5B58\u5728",
    denied: "\u8DEF\u5F84\u4E0D\u5728\u5F53\u524D\u6587\u4EF6\u5939\u5185",
    tooLarge: "\u6587\u4EF6\u592A\u5927\uFF0C\u5DF2\u4EA4\u7ED9\u7CFB\u7EDF\u7A0B\u5E8F\u6253\u5F00",
    conflict: "\u6587\u4EF6\u5DF2\u88AB\u5176\u4ED6\u7A0B\u5E8F\u4FEE\u6539",
    saved: "\u5DF2\u4FDD\u5B58",
    historyGone: "\u8FD9\u4E2A\u7248\u672C\u5DF2\u7ECF\u4E0D\u5728\u4E86",
    historyRestored: "\u5DF2\u6062\u590D\u5230\u8FD9\u4E2A\u7248\u672C",
    newFile: "\u65B0\u5EFA\u6587\u4EF6",
    newFolder: "\u65B0\u5EFA\u6587\u4EF6\u5939",
    nameLabel: "\u540D\u79F0",
    namePlaceholderFile: "\u4F8B\u5982\uFF1A\u7B14\u8BB0.md",
    namePlaceholderFolder: "\u6587\u4EF6\u5939\u540D\u79F0",
    createAction: "\u521B\u5EFA",
    renameAction: "\u91CD\u547D\u540D",
    cancelAction: "\u53D6\u6D88",
    inFolder: "\u4F4D\u7F6E",
    invalidName: "\u540D\u79F0\u4E0D\u5408\u6CD5\uFF1A\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u4E5F\u4E0D\u80FD\u5305\u542B / \u6216 \\",
    nameExists: "\u8FD9\u91CC\u5DF2\u7ECF\u6709\u540C\u540D\u7684\u6587\u4EF6\u6216\u6587\u4EF6\u5939\u4E86",
    created: "\u5DF2\u521B\u5EFA",
    renamed: "\u5DF2\u91CD\u547D\u540D",
    trashTitle: "\u79FB\u5230\u5E9F\u7EB8\u7BD3\uFF1F",
    trashBody: "\u6587\u4EF6\u4F1A\u8FDB\u5165\u7CFB\u7EDF\u5E9F\u7EB8\u7BD3\uFF0C\u968F\u65F6\u53EF\u4EE5\u6062\u590D\u3002",
    trashAction: "\u79FB\u5230\u5E9F\u7EB8\u7BD3",
    trashed: "\u5DF2\u79FB\u5230\u5E9F\u7EB8\u7BD3",
    trashFailed: "\u79FB\u5165\u5E9F\u7EB8\u7BD3\u5931\u8D25\uFF0C\u672A\u505A\u4EFB\u4F55\u6539\u52A8",
    failed: "\u64CD\u4F5C\u5931\u8D25",
    externalOpened: "\u5DF2\u7528\u7CFB\u7EDF\u7A0B\u5E8F\u6253\u5F00"
  },
  "en-US": {
    noWorkspace: "This conversation has no folder bound to it",
    notFound: "File not found",
    denied: "That path is outside this folder",
    tooLarge: "File is too large \u2014 opened with the system app instead",
    conflict: "The file changed on disk",
    saved: "Saved",
    historyGone: "That version is gone",
    historyRestored: "Restored that version",
    newFile: "New file",
    newFolder: "New folder",
    nameLabel: "Name",
    namePlaceholderFile: "e.g. notes.md",
    namePlaceholderFolder: "Folder name",
    createAction: "Create",
    renameAction: "Rename",
    cancelAction: "Cancel",
    inFolder: "In",
    invalidName: "That name is not valid: it cannot be empty or contain / or \\",
    nameExists: "Something with that name is already here",
    created: "Created",
    renamed: "Renamed",
    trashTitle: "Move to Trash?",
    trashBody: "It goes to the system Trash and can be recovered from there.",
    trashAction: "Move to Trash",
    trashed: "Moved to Trash",
    trashFailed: "Could not move it to the Trash \u2014 nothing was changed",
    failed: "Something went wrong",
    externalOpened: "Opened with the system app"
  }
};
function activate(ctx) {
  const storageRoot = ctx.storagePath;
  const dataRoot = findFinchDataRoot(storageRoot);
  const historyRoot = path3.join(storageRoot, "history");
  try {
    fs3.mkdirSync(historyRoot, { recursive: true });
  } catch {
  }
  const sessions = /* @__PURE__ */ new Map();
  let appLocale = "en-US";
  void ctx.app.getInfo().then((info) => {
    appLocale = info.locale === "zh-CN" ? "zh-CN" : "en-US";
  }).catch(() => void 0);
  const locale = () => appLocale;
  const t = (key) => TEXT[locale()][key];
  let overrideCache = {};
  function sanitizeOverrides(raw) {
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key in SETTING_DEFAULTS) out[key] = value;
    }
    return out;
  }
  void ctx.storage.get(OVERRIDES_STORAGE_KEY).then((raw) => {
    overrideCache = sanitizeOverrides(raw);
  }).catch(() => void 0);
  function persistOverrides() {
    void ctx.storage.set(OVERRIDES_STORAGE_KEY, overrideCache).catch(() => void 0);
  }
  function settings() {
    const manifest = ctx.settings.all() ?? {};
    const resolved = { ...SETTING_DEFAULTS };
    for (const key of Object.keys(SETTING_DEFAULTS)) {
      const pick = overrideCache[key] ?? manifest[key] ?? SETTING_DEFAULTS[key];
      resolved[key] = pick ?? SETTING_DEFAULTS[key];
    }
    return resolved;
  }
  function settingsPayload() {
    return {
      settings: settings(),
      overridableKeys: OVERRIDABLE_KEYS,
      overrides: Object.keys(overrideCache)
    };
  }
  function ignoreFolderSet(current) {
    const set = /* @__PURE__ */ new Set();
    for (const line of String(current.ignoreFolders ?? "").split("\n")) {
      const name = line.trim();
      if (name) set.add(name);
    }
    return set;
  }
  function listOptions(current) {
    return {
      ...DEFAULT_LIST_OPTIONS,
      showHidden: Boolean(current.showHidden),
      textOnly: Boolean(current.textOnly),
      hideIgnoredFolders: Boolean(current.hideIgnoredFolders),
      ignoreFolders: ignoreFolderSet(current),
      sortOrder: current.sortOrder === "recent" ? "recent" : "name",
      maxTextBytes: MAX_TEXT_BYTES
    };
  }
  function normalizeSetting(key, value) {
    const fallback = SETTING_DEFAULTS[key];
    if (typeof fallback === "boolean") return Boolean(value);
    if (typeof fallback === "number") {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    }
    if (key === "sortOrder") return value === "recent" ? "recent" : "name";
    if (key === "markdownView") return value === "source" ? "source" : "preview";
    if (key === "externalChange") return value === "ask" ? "ask" : "auto";
    return typeof value === "string" ? value : fallback;
  }
  function keyOf(panel) {
    return panel.sessionId ?? `scope:${panel.id}`;
  }
  function resolveRoot(panel, sessionId) {
    const current = ctx.session;
    if (sessionId) {
      const transcriptPath = findTranscript(dataRoot, sessionId);
      const meta = readSessionMeta(transcriptPath, sessionId);
      if (meta.cwd && fs3.existsSync(meta.cwd)) return meta.cwd;
      if (current.id === sessionId && current.cwd) return current.cwd;
    }
    if (current.cwd) return current.cwd;
    return ctx.workspace.directoryPath ?? ctx.workspace.projectPath ?? null;
  }
  function stateFor(panel) {
    const key = keyOf(panel);
    const existing = sessions.get(key);
    if (existing && fs3.existsSync(existing.root)) return existing;
    const sessionId = panel.sessionId ?? ctx.session.id ?? "";
    const root = resolveRoot(panel, panel.sessionId ?? void 0);
    if (!root) return null;
    const transcriptPath = findTranscript(dataRoot, sessionId);
    const meta = readSessionMeta(transcriptPath, sessionId);
    const state = {
      sessionId,
      root,
      startedAtMs: meta.startedAtMs,
      transcriptPath,
      touchedAt: 0,
      touched: [],
      scan: null,
      watcher: null,
      pendingPaths: /* @__PURE__ */ new Set(),
      selfWrites: /* @__PURE__ */ new Map(),
      flushTimer: null,
      panels: /* @__PURE__ */ new Set()
    };
    sessions.set(key, state);
    return state;
  }
  function touchedFor(state) {
    const now = Date.now();
    if (now - state.touchedAt < TOUCHED_TTL_MS) return state.touched;
    state.touchedAt = now;
    try {
      state.touched = collectTouchedFiles(state.root, state.transcriptPath);
    } catch {
      state.touched = [];
    }
    return state.touched;
  }
  function changedSet(state) {
    if (!state.startedAtMs) return /* @__PURE__ */ new Set();
    return new Set(scanOf(state).filter((f) => f.mtimeMs >= state.startedAtMs).map((f) => f.rel));
  }
  function scanOf(state, force = false) {
    const now = Date.now();
    if (!force && state.scan && now - state.scan.at < SCAN_TTL_MS) return state.scan.files;
    const current = settings();
    const options = listOptions(current);
    const limit = Math.max(100, Number(current.scanLimit) || SETTING_DEFAULTS.scanLimit);
    const maxDepth = Math.max(1, Number(current.scanDepth) || SETTING_DEFAULTS.scanDepth);
    const files = [];
    const stack = [{ abs: state.root, depth: 0 }];
    while (stack.length && files.length < limit) {
      const { abs, depth } = stack.pop();
      if (depth > maxDepth) continue;
      let entries;
      try {
        entries = readDirEntries(state.root, toRel(state.root, abs), options);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.dir) {
          if (isIgnoredFolder(entry.name, options)) continue;
          stack.push({ abs: path3.join(abs, entry.name), depth: depth + 1 });
        } else {
          files.push({ rel: entry.rel, mtimeMs: entry.mtimeMs, size: entry.size });
        }
      }
    }
    state.scan = { at: now, files };
    return files;
  }
  function broadcast(state, message) {
    for (const panel of state.panels) {
      void panel.postMessage(message).catch(() => void 0);
    }
  }
  function markSelfWrite(state, rel) {
    state.selfWrites.set(rel, Date.now() + SELF_WRITE_GRACE_MS);
  }
  function ensureWatcher(state) {
    if (state.watcher) return;
    try {
      state.watcher = fs3.watch(state.root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = String(filename).split(path3.sep).join("/");
        const options = listOptions(settings());
        if (rel.split("/").some((part) => isIgnoredFolder(part, options))) return;
        state.pendingPaths.add(rel);
        if (state.flushTimer) clearTimeout(state.flushTimer);
        state.flushTimer = setTimeout(() => {
          state.flushTimer = null;
          const all = [...state.pendingPaths];
          state.pendingPaths.clear();
          const now = Date.now();
          const paths = all.filter((item) => {
            const until = state.selfWrites.get(item) ?? 0;
            return until < now;
          });
          for (const [item, until] of state.selfWrites) {
            if (until < now) state.selfWrites.delete(item);
          }
          state.scan = null;
          if (paths.length) broadcast(state, { type: "fsChange", paths });
        }, WATCH_DEBOUNCE_MS);
      });
    } catch {
      state.watcher = null;
    }
  }
  function releasePanel(state, panel) {
    state.panels.delete(panel);
    if (state.panels.size === 0) {
      try {
        state.watcher?.close();
      } catch {
      }
      state.watcher = null;
      if (state.flushTimer) clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
  }
  function finchFileUrl(abs) {
    return `finch-file://local?path=${encodeURIComponent(abs)}`;
  }
  function lineCount(text) {
    return text.split("\n").length;
  }
  const HISTORY_MAX_ENTRIES = 30;
  const HISTORY_MAX_BYTES = 3 * 1024 * 1024;
  const HISTORY_MAX_SNAPSHOT_BYTES = 512 * 1024;
  const HISTORY_GAP_SAVE_MS = 45e3;
  const HISTORY_GAP_OPEN_MS = 5 * 6e4;
  function historyDirFor(abs) {
    const hash = crypto.createHash("sha1").update(abs).digest("hex").slice(0, 16);
    return path3.join(historyRoot, hash);
  }
  function snapshotPathFor(dir, id) {
    return path3.join(dir, `${id}.txt`);
  }
  function readHistoryIndex(dir) {
    const indexFile = path3.join(dir, "index.json");
    try {
      const parsed = JSON.parse(fs3.readFileSync(indexFile, "utf8"));
      return { path: parsed.path ?? "", name: parsed.name ?? "", entries: parsed.entries ?? [] };
    } catch {
      return { path: "", name: "", entries: [] };
    }
  }
  function writeHistoryIndex(dir, index) {
    fs3.writeFileSync(path3.join(dir, "index.json"), JSON.stringify(index), "utf8");
  }
  function snapshotHistory(abs, content, reason) {
    if (!settings().keepHistory) return;
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > HISTORY_MAX_SNAPSHOT_BYTES) return;
    const dir = historyDirFor(abs);
    const index = readHistoryIndex(dir);
    const newest = index.entries[0];
    if (newest) {
      try {
        if (fs3.readFileSync(snapshotPathFor(dir, newest.id), "utf8") === content) return;
      } catch {
      }
      const gap = reason === "open" ? HISTORY_GAP_OPEN_MS : HISTORY_GAP_SAVE_MS;
      if (Date.now() - newest.at < gap) return;
    }
    try {
      fs3.mkdirSync(dir, { recursive: true });
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      fs3.writeFileSync(snapshotPathFor(dir, id), content, "utf8");
      index.path = abs;
      index.name = path3.basename(abs);
      index.entries.unshift({ id, at: Date.now(), bytes, lines: lineCount(content), reason });
      while (index.entries.length > HISTORY_MAX_ENTRIES) {
        const dropped = index.entries.pop();
        if (dropped) fs3.rmSync(snapshotPathFor(dir, dropped.id), { force: true });
      }
      let total = index.entries.reduce((sum, entry) => sum + entry.bytes, 0);
      while (index.entries.length > 1 && total > HISTORY_MAX_BYTES) {
        const dropped = index.entries.pop();
        if (dropped) {
          total -= dropped.bytes;
          fs3.rmSync(snapshotPathFor(dir, dropped.id), { force: true });
        }
      }
      writeHistoryIndex(dir, index);
    } catch {
    }
  }
  function historyCount(abs) {
    if (!settings().keepHistory) return 0;
    return readHistoryIndex(historyDirFor(abs)).entries.length;
  }
  function listHistory(abs) {
    if (!settings().keepHistory) return [];
    return readHistoryIndex(historyDirFor(abs)).entries;
  }
  async function openHistoryDiff(panel, abs, id) {
    const dir = historyDirFor(abs);
    const entry = listHistory(abs).find((item) => item.id === id);
    if (!entry) {
      await panel.postMessage({ type: "error", message: t("historyGone") });
      return;
    }
    const base = path3.basename(abs);
    const beforeDir = path3.join(dir, "compare", entry.id, "before");
    const afterDir = path3.join(dir, "compare", entry.id, "after");
    const beforePath = path3.join(beforeDir, base);
    const afterPath = path3.join(afterDir, base);
    try {
      fs3.mkdirSync(beforeDir, { recursive: true });
      fs3.mkdirSync(afterDir, { recursive: true });
      fs3.copyFileSync(snapshotPathFor(dir, entry.id), beforePath);
      fs3.copyFileSync(abs, afterPath);
    } catch {
      await panel.postMessage({ type: "error", message: t("failed") });
      return;
    }
    await ctx.ui.openDiff({
      type: "files",
      leftPath: beforePath,
      rightPath: afterPath,
      title: `${base} \xB7 ${formatClock(entry.at)} \u7684\u7248\u672C \u2192 \u5F53\u524D`
    });
  }
  function restoreHistory(state, abs, id) {
    const dir = historyDirFor(abs);
    const entry = listHistory(abs).find((item) => item.id === id);
    if (!entry) return { type: "error", message: t("historyGone") };
    let content = "";
    try {
      content = fs3.readFileSync(snapshotPathFor(dir, entry.id), "utf8");
    } catch {
      return { type: "error", message: t("historyGone") };
    }
    try {
      snapshotHistory(abs, fs3.readFileSync(abs, "utf8"), "restore");
    } catch {
    }
    try {
      markSelfWrite(state, toRel(state.root, abs));
      fs3.writeFileSync(abs, content, "utf8");
    } catch {
      return { type: "error", message: t("failed") };
    }
    state.scan = null;
    const next = fs3.statSync(abs);
    return {
      type: "saved",
      rel: toRel(state.root, abs),
      reason: "restore",
      mtimeMs: next.mtimeMs,
      size: next.size,
      message: t("historyRestored")
    };
  }
  function openFile(state, rel) {
    const abs = resolveInside(state.root, rel);
    if (!abs) return { type: "error", message: t("denied") };
    let stat;
    try {
      stat = fs3.statSync(abs);
    } catch {
      return { type: "error", message: t("notFound") };
    }
    if (!stat.isFile()) return { type: "error", message: t("notFound") };
    const classification = classify(abs, stat.size, MAX_TEXT_BYTES);
    const changed = changedSet(state).has(toRel(state.root, abs));
    const base = {
      type: "file",
      rel: toRel(state.root, abs),
      name: path3.basename(abs),
      absPath: abs,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      changed
    };
    if (classification.kind === "text") {
      let content = "";
      try {
        content = fs3.readFileSync(abs, "utf8");
      } catch {
        return { type: "error", message: t("failed") };
      }
      if (classification.editable) snapshotHistory(abs, content, "open");
      return {
        ...base,
        kind: "text",
        flavor: classification.flavor,
        editable: classification.editable,
        content,
        lineCount: lineCount(content),
        historyCount: historyCount(abs)
      };
    }
    if (classification.kind === "image") {
      return { ...base, kind: "image", flavor: "image", editable: false, url: finchFileUrl(abs) };
    }
    return {
      ...base,
      kind: classification.kind,
      flavor: classification.flavor,
      editable: false
    };
  }
  function saveFile(state, rel, content, baseMtimeMs) {
    const abs = resolveInside(state.root, rel);
    if (!abs) return { type: "error", message: t("denied") };
    let stat;
    try {
      stat = fs3.statSync(abs);
    } catch {
      return { type: "error", message: t("notFound") };
    }
    if (baseMtimeMs && Math.abs(stat.mtimeMs - baseMtimeMs) > 1) {
      return { type: "saveConflict", rel, mtimeMs: stat.mtimeMs, size: stat.size };
    }
    const classification = classify(abs, stat.size, MAX_TEXT_BYTES);
    if (!classification.editable) return { type: "error", message: t("denied") };
    try {
      snapshotHistory(abs, fs3.readFileSync(abs, "utf8"), "save");
    } catch {
    }
    try {
      markSelfWrite(state, rel);
      fs3.writeFileSync(abs, content, "utf8");
    } catch {
      return { type: "error", message: t("failed") };
    }
    state.scan = null;
    const next = fs3.statSync(abs);
    return {
      type: "saved",
      rel,
      reason: "save",
      mtimeMs: next.mtimeMs,
      size: next.size,
      historyCount: historyCount(abs),
      message: t("saved")
    };
  }
  const INVALID_NAME_CHARS = /[/\\\u0000]/;
  function validateEntryName(raw) {
    const name = String(raw ?? "").trim();
    if (!name || name === "." || name === ".." || INVALID_NAME_CHARS.test(name)) return null;
    return name;
  }
  async function createEntry(state, dirRel, kind) {
    const dirAbs = resolveInside(state.root, dirRel);
    if (!dirAbs) return { type: "error", message: t("denied") };
    const result = await ctx.ui.showModalDialog({
      title: kind === "folder" ? t("newFolder") : t("newFile"),
      description: `${t("inFolder")}: ${dirRel || "."}`,
      fields: [
        {
          key: "name",
          label: t("nameLabel"),
          type: "text",
          required: true,
          placeholder: kind === "folder" ? t("namePlaceholderFolder") : t("namePlaceholderFile")
        }
      ],
      actions: [
        { id: "cancel", label: t("cancelAction") },
        { id: "create", label: t("createAction"), variant: "primary" }
      ]
    });
    if (result.action !== "create") return null;
    const name = validateEntryName(result.values?.name);
    if (!name) return { type: "error", message: t("invalidName") };
    const abs = path3.join(dirAbs, name);
    if (fs3.existsSync(abs)) return { type: "error", message: t("nameExists") };
    try {
      markSelfWrite(state, toRel(state.root, abs));
      if (kind === "folder") fs3.mkdirSync(abs);
      else fs3.writeFileSync(abs, "", "utf8");
    } catch {
      return { type: "error", message: t("failed") };
    }
    state.scan = null;
    const rel = toRel(state.root, abs);
    return {
      type: "treeChanged",
      dir: dirRel,
      created: kind === "file" ? rel : void 0,
      message: `${t("created")} \xB7 ${rel}`
    };
  }
  async function renameEntry(state, rel) {
    const abs = resolveInside(state.root, rel);
    if (!abs || abs === state.root) return { type: "error", message: t("denied") };
    if (!fs3.existsSync(abs)) return { type: "error", message: t("notFound") };
    const parentRel = toRel(state.root, path3.dirname(abs));
    const current = path3.basename(abs);
    const result = await ctx.ui.showModalDialog({
      title: t("renameAction"),
      description: rel,
      fields: [{ key: "name", label: t("nameLabel"), type: "text", required: true, default: current }],
      actions: [
        { id: "cancel", label: t("cancelAction") },
        { id: "rename", label: t("renameAction"), variant: "primary" }
      ]
    });
    if (result.action !== "rename") return null;
    const name = validateEntryName(result.values?.name);
    if (!name) return { type: "error", message: t("invalidName") };
    if (name === current) return null;
    const target = path3.join(path3.dirname(abs), name);
    if (fs3.existsSync(target)) return { type: "error", message: t("nameExists") };
    try {
      fs3.renameSync(abs, target);
    } catch {
      return { type: "error", message: t("failed") };
    }
    state.scan = null;
    return {
      type: "treeChanged",
      dir: parentRel,
      renamed: { from: rel, to: toRel(state.root, target) },
      message: `${t("renamed")} \xB7 ${name}`
    };
  }
  function renameIntoTrash(abs, trashDir) {
    try {
      fs3.mkdirSync(trashDir, { recursive: true });
      let target = path3.join(trashDir, path3.basename(abs));
      if (fs3.existsSync(target)) target = `${target}.${Date.now()}`;
      fs3.renameSync(abs, target);
      return true;
    } catch {
      return false;
    }
  }
  function runQuiet(command, args) {
    return new Promise((resolve) => {
      try {
        execFile(command, args, (error) => resolve(!error));
      } catch {
        resolve(false);
      }
    });
  }
  async function trashEntry(state, rel) {
    const abs = resolveInside(state.root, rel);
    if (!abs || abs === state.root) return { type: "error", message: t("denied") };
    if (!fs3.existsSync(abs)) return { type: "error", message: t("notFound") };
    const confirmed = await ctx.ui.showConfirmDialog({
      title: t("trashTitle"),
      description: rel,
      message: t("trashBody"),
      confirmLabel: t("trashAction"),
      cancelLabel: t("cancelAction"),
      variant: "danger"
    });
    if (!confirmed.confirmed) return null;
    let ok = false;
    const platform = process.platform;
    if (platform === "darwin") {
      ok = await runQuiet("osascript", ["-e", `tell application "Finder" to delete (POSIX file ${JSON.stringify(abs)})`]);
      if (!ok) ok = renameIntoTrash(abs, path3.join(os2.homedir(), ".Trash"));
    } else if (platform === "linux") {
      ok = await runQuiet("gio", ["trash", abs]);
      if (!ok) ok = renameIntoTrash(abs, path3.join(os2.homedir(), ".local", "share", "Trash", "files"));
    } else if (platform === "win32") {
      const escaped = abs.replace(/'/g, "''");
      ok = await runQuiet("powershell", [
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}','OnlyErrorDialogs','SendToRecycleBin')`
      ]);
    }
    if (!ok || fs3.existsSync(abs)) return { type: "error", message: t("trashFailed") };
    state.scan = null;
    return {
      type: "treeChanged",
      dir: toRel(state.root, path3.dirname(abs)),
      removed: rel,
      message: `${t("trashed")} \xB7 ${path3.basename(abs)}`
    };
  }
  function openExternally(state, rel, reveal) {
    const abs = resolveInside(state.root, rel);
    if (!abs) return { type: "error", message: t("denied") };
    if (!fs3.existsSync(abs)) return { type: "error", message: t("notFound") };
    const platform = process.platform;
    const isDir = fs3.statSync(abs).isDirectory();
    try {
      if (platform === "darwin") {
        execFile("open", reveal ? ["-R", abs] : [abs], () => void 0);
      } else if (platform === "win32") {
        if (reveal) execFile("explorer", [`/select,${abs}`], () => void 0);
        else execFile("cmd", ["/c", "start", "", abs], { windowsHide: true }, () => void 0);
      } else {
        execFile("xdg-open", [reveal && !isDir ? path3.dirname(abs) : abs], () => void 0);
      }
    } catch {
      return { type: "error", message: t("failed") };
    }
    return { type: "toast", message: t("externalOpened") };
  }
  function snapshot(state, panel) {
    return {
      type: "snapshot",
      root: state.root,
      rootLabel: path3.basename(state.root) || state.root,
      sessionId: state.sessionId,
      view: panel.view ?? "",
      spaceName: panel.spaceName ?? ctx.workspace.spaceName ?? "",
      locale: locale(),
      canEdit: true,
      sessionStartedAtMs: state.startedAtMs,
      ...settingsPayload()
    };
  }
  function listDir(state, rel) {
    const current = settings();
    const entries = readDirEntries(state.root, rel, listOptions(current));
    const changed = changedSet(state);
    const touched = touchedFor(state);
    const touchMap = new Map(touched.map((item) => [item.rel, item]));
    return {
      type: "dir",
      rel,
      entries: entries.map((entry) => ({
        ...entry,
        changed: !entry.dir && changed.has(entry.rel),
        touched: entry.dir ? false : touchMap.has(entry.rel),
        hits: touchMap.get(entry.rel)?.hits ?? 0
      })),
      changed: [...changed],
      touched: touched.map((item) => [item.rel, item.hits])
    };
  }
  function scanFor(state, query, onlyTouched) {
    const needle = query.trim().toLowerCase();
    const changed = changedSet(state);
    const touchMap = new Map(touchedFor(state).map((item) => [item.rel, item.hits]));
    const items = onlyTouched ? touchedFor(state).map((item) => ({ rel: item.rel, mtimeMs: item.lastMs, size: 0, hits: item.hits })) : scanOf(state).map((item) => ({ ...item, hits: touchMap.get(item.rel) ?? 0 }));
    const filtered = needle ? items.filter((item) => item.rel.toLowerCase().includes(needle)) : items;
    return {
      type: "scan",
      query,
      onlyTouched,
      total: filtered.length,
      changed: [...changed],
      files: filtered.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 400).map((item) => ({
        rel: item.rel,
        name: path3.basename(item.rel),
        dir: false,
        size: item.size,
        mtimeMs: item.mtimeMs,
        changed: changed.has(item.rel),
        touched: item.hits > 0,
        hits: item.hits
      }))
    };
  }
  async function handleMessage(state, panel, raw) {
    const message = raw ?? {};
    const kind = String(message.type ?? "");
    switch (kind) {
      case "ready":
        await panel.postMessage(snapshot(state, panel));
        await panel.postMessage(listDir(state, ""));
        return;
      case "listDir":
        await panel.postMessage(listDir(state, String(message.rel ?? "")));
        return;
      case "open":
        await panel.postMessage(openFile(state, String(message.rel ?? "")));
        return;
      case "save":
        await panel.postMessage(
          saveFile(state, String(message.rel ?? ""), String(message.content ?? ""), Number(message.baseMtimeMs ?? 0))
        );
        return;
      case "history": {
        const abs = resolveInside(state.root, String(message.rel ?? ""));
        await panel.postMessage({
          type: "history",
          rel: String(message.rel ?? ""),
          entries: abs ? listHistory(abs).map((entry) => ({ id: entry.id, at: entry.at, bytes: entry.bytes, lines: entry.lines, reason: entry.reason })) : []
        });
        return;
      }
      case "historyDiff": {
        const abs = resolveInside(state.root, String(message.rel ?? ""));
        if (abs) await openHistoryDiff(panel, abs, String(message.id ?? ""));
        return;
      }
      case "historyRestore": {
        const abs = resolveInside(state.root, String(message.rel ?? ""));
        if (!abs) {
          await panel.postMessage({ type: "error", message: t("denied") });
          return;
        }
        await panel.postMessage(restoreHistory(state, abs, String(message.id ?? "")));
        return;
      }
      case "newFile": {
        const reply = await createEntry(state, String(message.dir ?? ""), "file");
        if (reply) await panel.postMessage(reply);
        return;
      }
      case "newFolder": {
        const reply = await createEntry(state, String(message.dir ?? ""), "folder");
        if (reply) await panel.postMessage(reply);
        return;
      }
      case "rename": {
        const reply = await renameEntry(state, String(message.rel ?? ""));
        if (reply) await panel.postMessage(reply);
        return;
      }
      case "trash": {
        const reply = await trashEntry(state, String(message.rel ?? ""));
        if (reply) await panel.postMessage(reply);
        return;
      }
      case "openExternal":
        await panel.postMessage(openExternally(state, String(message.rel ?? ""), false));
        return;
      case "reveal":
        await panel.postMessage(openExternally(state, String(message.rel ?? ""), true));
        return;
      case "scan":
        await panel.postMessage(scanFor(state, String(message.query ?? ""), Boolean(message.onlyTouched)));
        return;
      case "touched": {
        const files = touchedFor(state).map((item) => ({
          rel: item.rel,
          abs: item.abs,
          hits: item.hits,
          lastMs: item.lastMs,
          via: item.via,
          changed: changedSet(state).has(item.rel)
        }));
        await panel.postMessage({ type: "touched", sessionStartedAtMs: state.startedAtMs, files });
        return;
      }
      case "refresh":
        state.scan = null;
        state.touchedAt = 0;
        await panel.postMessage(snapshot(state, panel));
        await panel.postMessage(listDir(state, String(message.rel ?? "")));
        return;
      case "setSetting": {
        const key = String(message.key ?? "");
        if (!(key in SETTING_DEFAULTS) || !OVERRIDABLE_KEYS.includes(key)) {
          await panel.postMessage({ type: "error", message: t("failed") });
          return;
        }
        const overrides = overrideCache;
        overrides[key] = normalizeSetting(key, message.value);
        persistOverrides();
        if (LISTING_KEYS.includes(key)) state.scan = null;
        await panel.postMessage({ type: "settings", ...settingsPayload() });
        await panel.postMessage(listDir(state, String(message.rel ?? "")));
        if (String(message.rel ?? "") !== "") await panel.postMessage(listDir(state, ""));
        return;
      }
      case "resetSettings": {
        overrideCache = {};
        persistOverrides();
        state.scan = null;
        await panel.postMessage({ type: "settings", ...settingsPayload(), reset: true });
        await panel.postMessage(listDir(state, ""));
        return;
      }
      default:
        return;
    }
  }
  function attach(panel) {
    const state = stateFor(panel);
    if (!state) {
      ctx.subscriptions.push(
        panel.onDidReceiveMessage(async (raw) => {
          const message = raw ?? {};
          if (message.type === "ready") {
            await panel.postMessage({ type: "noWorkspace", message: t("noWorkspace"), locale: locale() });
          }
        })
      );
      return;
    }
    state.panels.add(panel);
    ensureWatcher(state);
    const key = keyOf(panel);
    ctx.logger.info(`panel attached: ${panel.id} \u2192 ${state.root}`);
    ctx.subscriptions.push(
      panel.onDidReceiveMessage((raw) => handleMessage(state, panel, raw)),
      panel.onDidDispose(() => {
        releasePanel(state, panel);
        if (state.panels.size === 0 && sessions.get(key) === state) sessions.delete(key);
      })
    );
  }
  ctx.subscriptions.push(ctx.ui.onDidOpenPanel((panel) => attach(panel)));
  ctx.subscriptions.push(
    ctx.composerActions.register("open-file-browser", {
      async onClick() {
        ctx.ui.createPanel({ instanceMode: "single" });
      }
    })
  );
  ctx.logger.info(`file browser ready (data root: ${dataRoot ?? "unknown"})`);
}
export {
  activate
};
