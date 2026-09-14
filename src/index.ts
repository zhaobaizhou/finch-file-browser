import type * as finch from 'finch';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  classify,
  DEFAULT_LIST_OPTIONS,
  findFinchDataRoot,
  isIgnoredFolder,
  readDirEntries,
  resolveInside,
  toRel,
  type DirEntry,
  type ListOptions,
} from './paths.js';
import { collectTouchedFiles, findTranscript, readSessionMeta, type TouchedFile } from './session.js';

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const SCAN_TTL_MS = 4000;
const TOUCHED_TTL_MS = 3000;
const WATCH_DEBOUNCE_MS = 350;

export interface ResolvedSettings {
  showHidden: boolean;
  textOnly: boolean;
  hideIgnoredFolders: boolean;
  ignoreFolders: string;
  sortOrder: 'name' | 'recent';
  showModTime: boolean;
  scanLimit: number;
  scanDepth: number;
  markdownView: 'preview' | 'source';
  codeFontSize: number;
  wrapLongLines: boolean;
  showLineNumbers: boolean;
  externalChange: 'auto' | 'ask';
}

/**
 * Manifest `finch.settings.fields`. Finch only persists a value once the user
 * saves the settings form, so `ctx.settings.get()` stays `undefined` until then
 * — these defaults are the single fallback used everywhere.
 */
const SETTING_DEFAULTS: ResolvedSettings = {
  showHidden: false,
  textOnly: false,
  hideIgnoredFolders: false,
  ignoreFolders: 'node_modules\ndist\nbuild\nout\ntarget\ncoverage\n__pycache__\n.venv',
  sortOrder: 'name',
  showModTime: false,
  scanLimit: 8000,
  scanDepth: 10,
  markdownView: 'preview',
  codeFontSize: 0,
  wrapLongLines: false,
  showLineNumbers: false,
  externalChange: 'auto',
};

type SettingsKey = keyof typeof SETTING_DEFAULTS;

/** Settings the panel can flip instantly; everything else needs the native form. */
const OVERRIDABLE_KEYS: SettingsKey[] = [
  'showHidden',
  'textOnly',
  'hideIgnoredFolders',
  'sortOrder',
  'showModTime',
];

/** Changing these invalidates the directory listings and the scan cache. */
const LISTING_KEYS: SettingsKey[] = [
  'showHidden',
  'textOnly',
  'hideIgnoredFolders',
  'sortOrder',
  'showModTime',
  'scanLimit',
  'scanDepth',
  'ignoreFolders',
];

const OVERRIDES_STORAGE_KEY = 'panelOverrides';

const TEXT = {
  'zh-CN': {
    noWorkspace: '这个对话还没有绑定文件夹',
    notFound: '文件不存在',
    denied: '路径不在当前文件夹内',
    tooLarge: '文件太大，已交给系统程序打开',
    conflict: '文件已被其他程序修改',
    saved: '已保存',
    restored: '已撤销上一次保存',
    noUndo: '没有可撤销的保存记录',
    failed: '操作失败',
    externalOpened: '已用系统程序打开',
  },
  'en-US': {
    noWorkspace: 'This conversation has no folder bound to it',
    notFound: 'File not found',
    denied: 'That path is outside this folder',
    tooLarge: 'File is too large — opened with the system app instead',
    conflict: 'The file changed on disk',
    saved: 'Saved',
    restored: 'Reverted the last save',
    noUndo: 'Nothing to undo',
    failed: 'Something went wrong',
    externalOpened: 'Opened with the system app',
  },
} as const;

type Locale = keyof typeof TEXT;

interface ScanCache {
  at: number;
  files: { rel: string; mtimeMs: number; size: number }[];
}

interface SessionState {
  sessionId: string;
  root: string;
  startedAtMs: number;
  transcriptPath: string | null;
  touchedAt: number;
  touched: TouchedFile[];
  scan: ScanCache | null;
  watcher: fs.FSWatcher | null;
  pendingPaths: Set<string>;
  flushTimer: NodeJS.Timeout | null;
  panels: Set<finch.AppPanel>;
}

export function activate(ctx: finch.MiniToolContext): void {
  const storageRoot = ctx.storagePath;
  const dataRoot = findFinchDataRoot(storageRoot);
  const undoDir = path.join(storageRoot, 'undo');
  try {
    fs.mkdirSync(undoDir, { recursive: true });
  } catch {
    /* best effort */
  }

  const sessions = new Map<string, SessionState>();

  let appLocale: Locale = 'en-US';
  void ctx.app
    .getInfo()
    .then((info) => {
      appLocale = info.locale === 'zh-CN' ? 'zh-CN' : 'en-US';
    })
    .catch(() => undefined);

  const locale = (): Locale => appLocale;
  const t = (key: keyof typeof TEXT['en-US']): string => TEXT[locale()][key];

  /* ── settings ──────────────────────────────────────────────────────────── */

  /**
   * `ctx.storage` is async, but `settings()` is read on every listing and every
   * panel message. So the override layer is loaded once at activation, kept in
   * memory, and mirrored back to storage on change.
   */
  let overrideCache: Partial<Record<SettingsKey, unknown>> = {};

  function sanitizeOverrides(raw: unknown): Partial<Record<SettingsKey, unknown>> {
    if (!raw || typeof raw !== 'object') return {};
    const out: Partial<Record<SettingsKey, unknown>> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key in SETTING_DEFAULTS) out[key as SettingsKey] = value;
    }
    return out;
  }

  void ctx.storage
    .get<unknown>(OVERRIDES_STORAGE_KEY)
    .then((raw) => {
      overrideCache = sanitizeOverrides(raw);
    })
    .catch(() => undefined);

  function persistOverrides(): void {
    void ctx.storage.set(OVERRIDES_STORAGE_KEY, overrideCache).catch(() => undefined);
  }

  /**
   * Precedence: panel quick-toggle override → native settings form → built-in
   * default. The override layer exists because saving the native form reloads
   * the mini tool, which is too heavy for something flipped mid-browse.
   */
  function settings(): ResolvedSettings {
    const manifest = ctx.settings.all() ?? {};
    const resolved = { ...SETTING_DEFAULTS };
    for (const key of Object.keys(SETTING_DEFAULTS) as SettingsKey[]) {
      const pick = overrideCache[key] ?? manifest[key] ?? SETTING_DEFAULTS[key];
      (resolved as unknown as Record<string, unknown>)[key] = pick ?? SETTING_DEFAULTS[key];
    }
    return resolved;
  }

  function settingsPayload(): Record<string, unknown> {
    return {
      settings: settings(),
      overridableKeys: OVERRIDABLE_KEYS,
      overrides: Object.keys(overrideCache),
    };
  }

  function ignoreFolderSet(current: ResolvedSettings): Set<string> {
    const set = new Set<string>();
    for (const line of String(current.ignoreFolders ?? '').split('\n')) {
      const name = line.trim();
      if (name) set.add(name);
    }
    return set;
  }

  function listOptions(current: ResolvedSettings): ListOptions {
    return {
      ...DEFAULT_LIST_OPTIONS,
      showHidden: Boolean(current.showHidden),
      textOnly: Boolean(current.textOnly),
      hideIgnoredFolders: Boolean(current.hideIgnoredFolders),
      ignoreFolders: ignoreFolderSet(current),
      sortOrder: current.sortOrder === 'recent' ? 'recent' : 'name',
      maxTextBytes: MAX_TEXT_BYTES,
    };
  }

  function normalizeSetting(key: SettingsKey, value: unknown): unknown {
    const fallback = SETTING_DEFAULTS[key];
    if (typeof fallback === 'boolean') return Boolean(value);
    if (typeof fallback === 'number') {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    }
    if (key === 'sortOrder') return value === 'recent' ? 'recent' : 'name';
    if (key === 'markdownView') return value === 'source' ? 'source' : 'preview';
    if (key === 'externalChange') return value === 'ask' ? 'ask' : 'auto';
    return typeof value === 'string' ? value : fallback;
  }

  /* ── session state ─────────────────────────────────────────────────────── */

  function keyOf(panel: finch.AppPanel): string {
    return panel.sessionId ?? `scope:${panel.id}`;
  }

  function resolveRoot(panel: finch.AppPanel, sessionId: string | undefined): string | null {
    const current = ctx.session;
    if (sessionId) {
      const transcriptPath = findTranscript(dataRoot, sessionId);
      const meta = readSessionMeta(transcriptPath, sessionId);
      if (meta.cwd && fs.existsSync(meta.cwd)) return meta.cwd;
      if (current.id === sessionId && current.cwd) return current.cwd;
    }
    if (current.cwd) return current.cwd;
    return ctx.workspace.directoryPath ?? ctx.workspace.projectPath ?? null;
  }

  function stateFor(panel: finch.AppPanel): SessionState | null {
    const key = keyOf(panel);
    const existing = sessions.get(key);
    if (existing && fs.existsSync(existing.root)) return existing;

    const sessionId = panel.sessionId ?? ctx.session.id ?? '';
    const root = resolveRoot(panel, panel.sessionId ?? undefined);
    if (!root) return null;

    const transcriptPath = findTranscript(dataRoot, sessionId);
    const meta = readSessionMeta(transcriptPath, sessionId);
    const state: SessionState = {
      sessionId,
      root,
      startedAtMs: meta.startedAtMs,
      transcriptPath,
      touchedAt: 0,
      touched: [],
      scan: null,
      watcher: null,
      pendingPaths: new Set(),
      flushTimer: null,
      panels: new Set(),
    };
    sessions.set(key, state);
    return state;
  }

  function touchedFor(state: SessionState): TouchedFile[] {
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

  function changedSet(state: SessionState): Set<string> {
    if (!state.startedAtMs) return new Set();
    return new Set(scanOf(state).filter((f) => f.mtimeMs >= state.startedAtMs).map((f) => f.rel));
  }

  /* ── shallow scan (search + changed highlight) ─────────────────────────── */

  function scanOf(state: SessionState, force = false): ScanCache['files'] {
    const now = Date.now();
    if (!force && state.scan && now - state.scan.at < SCAN_TTL_MS) return state.scan.files;

    const current = settings();
    const options = listOptions(current);
    const limit = Math.max(100, Number(current.scanLimit) || SETTING_DEFAULTS.scanLimit);
    const maxDepth = Math.max(1, Number(current.scanDepth) || SETTING_DEFAULTS.scanDepth);

    const files: ScanCache['files'] = [];
    const stack: { abs: string; depth: number }[] = [{ abs: state.root, depth: 0 }];
    while (stack.length && files.length < limit) {
      const { abs, depth } = stack.pop()!;
      if (depth > maxDepth) continue;
      let entries: DirEntry[];
      try {
        entries = readDirEntries(state.root, toRel(state.root, abs), options);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.dir) {
          if (isIgnoredFolder(entry.name, options)) continue;
          stack.push({ abs: path.join(abs, entry.name), depth: depth + 1 });
        } else {
          files.push({ rel: entry.rel, mtimeMs: entry.mtimeMs, size: entry.size });
        }
      }
    }
    state.scan = { at: now, files };
    return files;
  }

  /* ── watcher ───────────────────────────────────────────────────────────── */

  function broadcast(state: SessionState, message: unknown): void {
    for (const panel of state.panels) {
      void panel.postMessage(message).catch(() => undefined);
    }
  }

  function ensureWatcher(state: SessionState): void {
    if (state.watcher) return;
    try {
      state.watcher = fs.watch(state.root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = String(filename).split(path.sep).join('/');
        const options = listOptions(settings());
        if (rel.split('/').some((part) => isIgnoredFolder(part, options))) return;
        state.pendingPaths.add(rel);
        if (state.flushTimer) clearTimeout(state.flushTimer);
        state.flushTimer = setTimeout(() => {
          state.flushTimer = null;
          const paths = [...state.pendingPaths];
          state.pendingPaths.clear();
          state.scan = null;
          broadcast(state, { type: 'fsChange', paths });
        }, WATCH_DEBOUNCE_MS);
      });
    } catch {
      state.watcher = null;
    }
  }

  function releasePanel(state: SessionState, panel: finch.AppPanel): void {
    state.panels.delete(panel);
    if (state.panels.size === 0) {
      try {
        state.watcher?.close();
      } catch {
        /* ignore */
      }
      state.watcher = null;
      if (state.flushTimer) clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
  }

  /* ── file operations ───────────────────────────────────────────────────── */

  function finchFileUrl(abs: string): string {
    return `finch-file://local?path=${encodeURIComponent(abs)}`;
  }

  function undoSlot(state: SessionState, rel: string): string {
    const safe = Buffer.from(`${state.sessionId}::${rel}`).toString('base64url').slice(0, 120);
    return path.join(undoDir, `${safe}.txt`);
  }

  function openFile(state: SessionState, rel: string) {
    const abs = resolveInside(state.root, rel);
    if (!abs) return { type: 'error', message: t('denied') };
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return { type: 'error', message: t('notFound') };
    }
    if (!stat.isFile()) return { type: 'error', message: t('notFound') };

    const classification = classify(abs, stat.size, MAX_TEXT_BYTES);
    const changed = changedSet(state).has(toRel(state.root, abs));
    const base = {
      type: 'file',
      rel: toRel(state.root, abs),
      name: path.basename(abs),
      absPath: abs,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      changed,
      hasUndo: fs.existsSync(undoSlot(state, toRel(state.root, abs))),
    };

    if (classification.kind === 'text') {
      let content = '';
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch {
        return { type: 'error', message: t('failed') };
      }
      return {
        ...base,
        kind: 'text',
        flavor: classification.flavor,
        editable: classification.editable,
        content,
        lineCount: content.split('\n').length,
      };
    }
    if (classification.kind === 'image') {
      return { ...base, kind: 'image', flavor: 'image', editable: false, url: finchFileUrl(abs) };
    }
    return {
      ...base,
      kind: classification.kind,
      flavor: classification.flavor,
      editable: false,
    };
  }

  function saveFile(state: SessionState, rel: string, content: string, baseMtimeMs: number) {
    const abs = resolveInside(state.root, rel);
    if (!abs) return { type: 'error', message: t('denied') };
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return { type: 'error', message: t('notFound') };
    }
    if (baseMtimeMs && Math.abs(stat.mtimeMs - baseMtimeMs) > 1) {
      return { type: 'saveConflict', rel, mtimeMs: stat.mtimeMs, size: stat.size };
    }
    const classification = classify(abs, stat.size, MAX_TEXT_BYTES);
    if (!classification.editable) return { type: 'error', message: t('denied') };

    try {
      fs.writeFileSync(undoSlot(state, rel), fs.readFileSync(abs));
      fs.writeFileSync(abs, content, 'utf8');
    } catch {
      return { type: 'error', message: t('failed') };
    }
    state.scan = null;
    const next = fs.statSync(abs);
    return {
      type: 'saved',
      rel,
      reason: 'save',
      mtimeMs: next.mtimeMs,
      size: next.size,
      hasUndo: true,
      message: t('saved'),
    };
  }

  /** Roll the file back to the snapshot taken right before the last save. */
  function undoFile(state: SessionState, rel: string) {
    const slot = undoSlot(state, rel);
    const abs = resolveInside(state.root, rel);
    if (!abs) return { type: 'error', message: t('denied') };
    if (!fs.existsSync(slot)) return { type: 'error', message: t('noUndo') };
    try {
      fs.writeFileSync(abs, fs.readFileSync(slot));
      fs.rmSync(slot, { force: true });
    } catch {
      return { type: 'error', message: t('failed') };
    }
    state.scan = null;
    const next = fs.statSync(abs);
    return {
      type: 'saved',
      rel,
      reason: 'undo',
      mtimeMs: next.mtimeMs,
      size: next.size,
      hasUndo: false,
      message: t('restored'),
    };
  }

  function openExternally(state: SessionState, rel: string, reveal: boolean) {
    const abs = resolveInside(state.root, rel);
    if (!abs) return { type: 'error', message: t('denied') };
    if (!fs.existsSync(abs)) return { type: 'error', message: t('notFound') };
    const platform = process.platform;
    const isDir = fs.statSync(abs).isDirectory();
    try {
      if (platform === 'darwin') {
        execFile('open', reveal ? ['-R', abs] : [abs], () => undefined);
      } else if (platform === 'win32') {
        if (reveal) execFile('explorer', [`/select,${abs}`], () => undefined);
        else execFile('cmd', ['/c', 'start', '', abs], { windowsHide: true }, () => undefined);
      } else {
        execFile('xdg-open', [reveal && !isDir ? path.dirname(abs) : abs], () => undefined);
      }
    } catch {
      return { type: 'error', message: t('failed') };
    }
    return { type: 'toast', message: t('externalOpened') };
  }

  /* ── page protocol ─────────────────────────────────────────────────────── */

  function snapshot(state: SessionState, panel: finch.AppPanel) {
    return {
      type: 'snapshot',
      root: state.root,
      rootLabel: path.basename(state.root) || state.root,
      sessionId: state.sessionId,
      view: panel.view ?? '',
      spaceName: panel.spaceName ?? ctx.workspace.spaceName ?? '',
      locale: locale(),
      canEdit: true,
      sessionStartedAtMs: state.startedAtMs,
      ...settingsPayload(),
    };
  }

  function listDir(state: SessionState, rel: string) {
    const current = settings();
    const entries = readDirEntries(state.root, rel, listOptions(current));
    const changed = changedSet(state);
    const touched = touchedFor(state);
    const touchMap = new Map(touched.map((item) => [item.rel, item]));
    return {
      type: 'dir',
      rel,
      entries: entries.map((entry) => ({
        ...entry,
        changed: !entry.dir && changed.has(entry.rel),
        touched: entry.dir ? false : touchMap.has(entry.rel),
        hits: touchMap.get(entry.rel)?.hits ?? 0,
      })),
      changed: [...changed],
      touched: touched.map((item) => [item.rel, item.hits]),
    };
  }

  function scanFor(state: SessionState, query: string, onlyTouched: boolean) {
    const needle = query.trim().toLowerCase();
    const changed = changedSet(state);
    const touchMap = new Map(touchedFor(state).map((item) => [item.rel, item.hits]));
    const items: { rel: string; mtimeMs: number; size: number; hits: number }[] = onlyTouched
      ? touchedFor(state).map((item) => ({ rel: item.rel, mtimeMs: item.lastMs, size: 0, hits: item.hits }))
      : scanOf(state).map((item) => ({ ...item, hits: touchMap.get(item.rel) ?? 0 }));
    const filtered = needle ? items.filter((item) => item.rel.toLowerCase().includes(needle)) : items;
    return {
      type: 'scan',
      query,
      onlyTouched,
      total: filtered.length,
      changed: [...changed],
      files: filtered
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 400)
        .map((item) => ({
          rel: item.rel,
          name: path.basename(item.rel),
          dir: false,
          size: item.size,
          mtimeMs: item.mtimeMs,
          changed: changed.has(item.rel),
          touched: item.hits > 0,
          hits: item.hits,
        })),
    };
  }

  async function handleMessage(state: SessionState, panel: finch.AppPanel, raw: unknown) {
    const message = (raw ?? {}) as Record<string, unknown>;
    const kind = String(message.type ?? '');
    switch (kind) {
      case 'ready':
        await panel.postMessage(snapshot(state, panel));
        await panel.postMessage(listDir(state, ''));
        return;
      case 'listDir':
        await panel.postMessage(listDir(state, String(message.rel ?? '')));
        return;
      case 'open':
        await panel.postMessage(openFile(state, String(message.rel ?? '')));
        return;
      case 'save':
        await panel.postMessage(
          saveFile(state, String(message.rel ?? ''), String(message.content ?? ''), Number(message.baseMtimeMs ?? 0)),
        );
        return;
      case 'undo':
        await panel.postMessage(undoFile(state, String(message.rel ?? '')));
        return;
      case 'openExternal':
        await panel.postMessage(openExternally(state, String(message.rel ?? ''), false));
        return;
      case 'reveal':
        await panel.postMessage(openExternally(state, String(message.rel ?? ''), true));
        return;
      case 'scan':
        await panel.postMessage(scanFor(state, String(message.query ?? ''), Boolean(message.onlyTouched)));
        return;
      case 'touched': {
        const files = touchedFor(state).map((item) => ({
          rel: item.rel,
          abs: item.abs,
          hits: item.hits,
          lastMs: item.lastMs,
          via: item.via,
          changed: changedSet(state).has(item.rel),
        }));
        await panel.postMessage({ type: 'touched', sessionStartedAtMs: state.startedAtMs, files });
        return;
      }
      case 'refresh':
        state.scan = null;
        state.touchedAt = 0;
        await panel.postMessage(snapshot(state, panel));
        await panel.postMessage(listDir(state, String(message.rel ?? '')));
        return;
      case 'setSetting': {
        const key = String(message.key ?? '') as SettingsKey;
        if (!(key in SETTING_DEFAULTS) || !OVERRIDABLE_KEYS.includes(key)) {
          await panel.postMessage({ type: 'error', message: t('failed') });
          return;
        }
        const overrides = overrideCache;
        overrides[key] = normalizeSetting(key, message.value);
        persistOverrides();
        if (LISTING_KEYS.includes(key)) state.scan = null;
        await panel.postMessage({ type: 'settings', ...settingsPayload() });
        await panel.postMessage(listDir(state, String(message.rel ?? '')));
        if (String(message.rel ?? '') !== '') await panel.postMessage(listDir(state, ''));
        return;
      }
      case 'resetSettings': {
        overrideCache = {};
        persistOverrides();
        state.scan = null;
        await panel.postMessage({ type: 'settings', ...settingsPayload(), reset: true });
        await panel.postMessage(listDir(state, ''));
        return;
      }
      default:
        return;
    }
  }

  function attach(panel: finch.AppPanel): void {
    const state = stateFor(panel);
    if (!state) {
      ctx.subscriptions.push(
        panel.onDidReceiveMessage(async (raw) => {
          const message = (raw ?? {}) as Record<string, unknown>;
          if (message.type === 'ready') {
            await panel.postMessage({ type: 'noWorkspace', message: t('noWorkspace'), locale: locale() });
          }
        }),
      );
      return;
    }
    state.panels.add(panel);
    ensureWatcher(state);
    const key = keyOf(panel);
    ctx.logger.info(`panel attached: ${panel.id} → ${state.root}`);

    ctx.subscriptions.push(
      panel.onDidReceiveMessage((raw) => handleMessage(state, panel, raw)),
      panel.onDidDispose(() => {
        releasePanel(state, panel);
        if (state.panels.size === 0 && sessions.get(key) === state) sessions.delete(key);
      }),
    );
  }

  ctx.subscriptions.push(ctx.ui.onDidOpenPanel((panel) => attach(panel)));

  /* ── composer entry point ──────────────────────────────────────────────── */

  ctx.subscriptions.push(
    ctx.composerActions.register('open-file-browser', {
      async onClick() {
        // onDidOpenPanel() attaches the message handler for this instance.
        ctx.ui.createPanel({ instanceMode: 'single' });
      },
    }),
  );

  ctx.logger.info(`file browser ready (data root: ${dataRoot ?? 'unknown'})`);
}
