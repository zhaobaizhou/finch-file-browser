import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { marked } from 'marked';

/**
 * Falls back to an offline demo bridge when the page is opened outside Finch
 * (plain browser, `file://`), so the layout can be reviewed without the host.
 * Inside Finch `window.finch` always exists and this never runs.
 */
function createDemoBridge() {
  const listeners = [];
  const sample = `# APK 证据与还原依据

检查更新：2026-09-08。分析目标是本地已下载的 0.21.1。

## 包身份

- 来源：APKPure 下载页
- 包名：\`com.ecffri.arrows\`；versionName: 0.21.1
- 主 Activity：\`com.unity3d.player.UnityPlayerActivity\`

## 已读出的配置

| 证据 | 提取事实 / 用途 |
| --- | --- |
| \`ThemesConfig_ThemeConfig.json\` | 三套主题：Light_0、Dark_0、Brown |
| \`GameConfig.json\` | 箭头退出加权曲线 |
| \`LevelProgressionConfig-V1.json\` | 40 个 onboarding 关卡 ID |

\`\`\`json
{ "theme": "Light_0", "hardMode": false, "arrows": 42 }
\`\`\`
`;
  const tree = {
    '': [
      { name: 'docs', rel: 'docs', dir: true, size: 0, mtimeMs: 0, ignored: false },
      { name: 'reference', rel: 'reference', dir: true, size: 0, mtimeMs: 0, ignored: false },
      { name: 'node_modules', rel: 'node_modules', dir: true, size: 0, mtimeMs: 0, ignored: true },
      { name: '.git', rel: '.git', dir: true, size: 0, mtimeMs: 0, ignored: true },
      { name: 'README.md', rel: 'README.md', dir: false, size: 1120, mtimeMs: Date.now(), ignored: false, changed: true },
      { name: '.gitignore', rel: '.gitignore', dir: false, size: 180, mtimeMs: Date.now(), ignored: false },
      { name: 'package.json', rel: 'package.json', dir: false, size: 890, mtimeMs: Date.now() - 86400_000 * 3, ignored: false },
      { name: 'capacitor.config.json', rel: 'capacitor.config.json', dir: false, size: 320, mtimeMs: Date.now() - 86400_000 * 40, ignored: false },
    ],
    docs: [
      { name: 'APK-EVIDENCE.md', rel: 'docs/APK-EVIDENCE.md', dir: false, size: 3120, mtimeMs: Date.now(), ignored: false, changed: true, hits: 4 },
      { name: 'BACKUP-RESTORE.md', rel: 'docs/BACKUP-RESTORE.md', dir: false, size: 2048, mtimeMs: Date.now() - 3600_000, ignored: false },
      { name: 'PRODUCT-ROADMAP.md', rel: 'docs/PRODUCT-ROADMAP.md', dir: false, size: 4096, mtimeMs: Date.now() - 86400_000, ignored: false, hits: 2 },
      { name: 'REFERENCE.md', rel: 'docs/REFERENCE.md', dir: false, size: 1536, mtimeMs: Date.now() - 86400_000 * 12, ignored: false },
    ],
    reference: [
      { name: 'apk-identity.json', rel: 'reference/apk-identity.json', dir: false, size: 640, mtimeMs: Date.now() - 86400_000 * 2, ignored: false },
      { name: 'logo.svg', rel: 'reference/logo.svg', dir: false, size: 520, mtimeMs: Date.now() - 86400_000 * 4, ignored: false },
    ],
  };
  const demoState = {
    showHidden: false,
    textOnly: false,
    hideIgnoredFolders: false,
    showModTime: false,
    sortOrder: 'name',
    markdownView: 'preview',
    codeFontSize: 0,
    wrapLongLines: false,
    showLineNumbers: false,
    externalChange: 'auto',
    keepHistory: true,
  };
  const DEMO_OVERRIDABLE = ['showHidden', 'textOnly', 'hideIgnoredFolders', 'sortOrder', 'showModTime', 'keepHistory'];
  const overrides = [];
  const demoHistory = {};
  const messageLog = [];
  const logMessage = (direction, payload) => {
    const type = payload && typeof payload === 'object' ? payload.type : typeof payload;
    messageLog.push(`${direction} ${type}${payload && payload.rel ? ` ${payload.rel}` : ''}${payload && payload.renamed ? ` ${payload.renamed.from}→${payload.renamed.to}` : ''}`);
    if (messageLog.length > 60) messageLog.shift();
  };
  const visibleEntries = (rel) => {
    const entries = (tree[rel] ?? []).filter((entry) => {
      if (!demoState.showHidden && entry.name.startsWith('.')) return false;
      if (entry.dir && entry.ignored && demoState.hideIgnoredFolders) return false;
      return true;
    });
    if (demoState.sortOrder === 'recent') {
      return entries.slice().sort((a, b) => {
        if (a.dir !== b.dir) return a.dir ? -1 : 1;
        if (a.dir) return a.name.localeCompare(b.name);
        return b.mtimeMs - a.mtimeMs;
      });
    }
    return entries;
  };
  const settingsPayload = (reset) => ({
    type: 'settings',
    settings: demoState,
    overridableKeys: DEMO_OVERRIDABLE,
    overrides,
    ...(reset ? { reset: true } : {}),
  });
  // Standalone-review helper: only ever defined when the page runs outside
  // Finch, so a developer can push settings without a host.
  window.__fbDemo = {
    pushSettings(patch) {
      Object.assign(demoState, patch);
      listeners.forEach((listener) => listener(settingsPayload()));
    },
    /** Standalone-review introspection: what the page currently believes. */
    state() {
      return {
        current: S.current ? S.current.rel : null,
        mode: S.mode,
        dirty: S.dirty,
        dirs: Object.fromEntries([...S.dirs.entries()].map(([key, list]) => [key, list.map((entry) => entry.rel)])),
      };
    },
    log() {
      return [...messageLog];
    },
  };

  const reply = (message) => {
    const emit = (payload) => {
      logMessage('←', payload);
      listeners.forEach((listener) => listener(payload));
    };
    if (message.type === 'ready') {
      emit({
        type: 'snapshot',
        root: '/Users/baizhou/Demo/ArrowsPuzzle',
        rootLabel: 'ArrowsPuzzle',
        locale: 'zh-CN',
        sessionStartedAtMs: Date.now() - 3600_000,
        settings: demoState,
        overridableKeys: DEMO_OVERRIDABLE,
        overrides,
      });
      emit({ type: 'dir', rel: '', entries: visibleEntries(''), changed: ['README.md', 'docs/APK-EVIDENCE.md'], touched: [['docs/APK-EVIDENCE.md', 4]] });
    } else if (message.type === 'listDir') {
      emit({ type: 'dir', rel: message.rel, entries: visibleEntries(message.rel) });
    } else if (message.type === 'save') {
      emit({
        type: 'saved',
        rel: message.rel,
        reason: 'save',
        mtimeMs: Date.now(),
        size: String(message.content ?? '').length,
        historyCount: Math.max(3, (demoHistory[message.rel] ?? []).length),
        message: '已保存',
      });
    } else if (message.type === 'history') {
      const entries = demoHistory[message.rel] ?? [
        { id: 'h3', at: Date.now() - 90_000, bytes: 512, lines: sample.split('\n').length - 6, reason: 'save' },
        { id: 'h2', at: Date.now() - 26 * 60_000, bytes: 480, lines: sample.split('\n').length - 12, reason: 'save' },
        { id: 'h1', at: Date.now() - 3 * 3600_000, bytes: 300, lines: 12, reason: 'open' },
      ];
      demoHistory[message.rel] = entries;
      emit({ type: 'history', rel: message.rel, entries });
    } else if (message.type === 'historyDiff') {
      emit({ type: 'toast', message: '演示模式下不打开原生 Diff' });
    } else if (message.type === 'historyRestore') {
      emit({
        type: 'saved',
        rel: message.rel,
        reason: 'restore',
        mtimeMs: Date.now(),
        size: sample.length,
        historyCount: (demoHistory[message.rel] ?? []).length,
        message: '已恢复到这个版本',
      });
    } else if (message.type === 'setSetting') {
      demoState[message.key] = message.value;
      if (!overrides.includes(message.key)) overrides.push(message.key);
      emit(settingsPayload());
      emit({ type: 'dir', rel: '', entries: visibleEntries('') });
    } else if (message.type === 'resetSettings') {
      Object.assign(demoState, {
        showHidden: false,
        textOnly: false,
        hideIgnoredFolders: false,
        showModTime: false,
        sortOrder: 'name',
      });
      overrides.length = 0;
      emit(settingsPayload(true));
      emit({ type: 'dir', rel: '', entries: visibleEntries('') });
    } else if (message.type === 'open') {
      const name = message.rel.split('/').pop();
      const isSvg = name.endsWith('.svg');
      const text = isSvg
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n  <rect width="18" height="16" x="3" y="4" rx="2.5"/>\n  <path d="M10 4v16"/>\n  <path d="M13.5 8.75h4"/>\n  <path d="M13.5 12h4"/>\n  <path d="M13.5 15.25h2.5"/>\n</svg>\n'
        : name.endsWith('.md')
          ? sample
          : '{\n  "demo": true\n}';
      emit({
        type: 'file',
        rel: message.rel,
        name,
        size: text.length,
        mtimeMs: Date.now(),
        changed: true,
        kind: 'text',
        flavor: isSvg ? 'svg' : name.endsWith('.md') ? 'markdown' : 'code',
        editable: true,
        content: text,
        lineCount: text.split('\n').length,
        historyCount: name.endsWith('.md') ? 3 : 0,
        absPath: `/Users/baizhou/Demo/ArrowsPuzzle/${message.rel}`,
      });
    } else if (message.type === 'newFile' || message.type === 'newFolder') {
      // Mirrors the host protocol: create, then report the tree change.
      const dir = message.dir ?? '';
      const isFolder = message.type === 'newFolder';
      const name = isFolder ? '新建文件夹' : '新建文件.md';
      const rel = dir ? `${dir}/${name}` : name;
      tree[dir] = tree[dir] ?? [];
      if (!tree[dir].some((entry) => entry.rel === rel)) {
        tree[dir].push({ name, rel, dir: isFolder, size: 0, mtimeMs: Date.now(), ignored: false });
      }
      emit({ type: 'treeChanged', dir, created: isFolder ? undefined : rel, message: `已创建 · ${rel}` });
    } else if (message.type === 'rename') {
      const from = message.rel;
      const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
      const list = tree[dir] ?? [];
      const entry = list.find((item) => item.rel === from);
      if (entry) {
        entry.name = `${entry.name.replace(/(\.[^.]+)?$/, '')}-renamed${entry.dir ? '' : (entry.name.match(/\.[^.]+$/) ?? [''])[0]}`;
        entry.rel = dir ? `${dir}/${entry.name}` : entry.name;
        emit({ type: 'treeChanged', dir, renamed: { from, to: entry.rel }, message: `已重命名 · ${entry.name}` });
      }
    } else if (message.type === 'trash') {
      const rel = message.rel;
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const list = tree[dir] ?? [];
      const index = list.findIndex((item) => item.rel === rel);
      if (index >= 0) list.splice(index, 1);
      emit({ type: 'treeChanged', dir, removed: rel, message: `已移到废纸篓 · ${rel}` });
    } else if (message.type === 'scan') {
      const all = Object.values(tree).flat();
      const needle = String(message.query ?? '').toLowerCase();
      const files = all.filter((entry) => !entry.dir && entry.rel.toLowerCase().includes(needle));
      emit({
        type: 'scan',
        query: message.query,
        changed: ['README.md', 'docs/APK-EVIDENCE.md'],
        files: files.map((entry) => ({ ...entry, hits: entry.hits ?? 0 })),
      });
    } else if (message.type === 'touched') {
      emit({
        type: 'touched',
        sessionStartedAtMs: Date.now() - 3600_000,
        files: [
          { rel: 'docs/APK-EVIDENCE.md', abs: '', hits: 4, via: 'tool', changed: true },
          { rel: 'docs/PRODUCT-ROADMAP.md', abs: '', hits: 2, via: 'text', changed: false },
          { rel: 'reference/apk-identity.json', abs: '', hits: 1, via: 'tool', changed: false },
        ],
      });
    }
  };
  return {
    postMessage: (message) => {
      logMessage('→', message);
      setTimeout(() => reply(message), 10);
    },
    onMessage: (listener) => {
      listeners.push(listener);
      return () => undefined;
    },
    composer: { addContexts: async () => ({ added: 1 }) },
    ui: { toast: async () => ({}), confirm: async () => ({ confirmed: false }) },
    panel: { setTitle: async () => undefined, setIcon: async () => undefined },
  };
}

const bridge = window.finch ?? createDemoBridge();

/* ── state ───────────────────────────────────────────────────────────────── */

const S = {
  root: '',
  rootLabel: '',
  locale: 'zh-CN',
  sessionStartedAtMs: 0,
  current: null,
  dirty: false,
  mode: 'preview',
  dirs: new Map(), // rel -> entries[]
  open: new Set(), // expanded directory rels
  pendingDirs: new Set(),
  changed: new Set(),
  touched: new Map(), // rel -> hits
  tab: 'tree',
  searchResults: null,
  searchQuery: '',
  diskConflict: null,
  settings: {
    showHidden: false,
    textOnly: false,
    hideIgnoredFolders: false,
    sortOrder: 'name',
    showModTime: false,
    markdownView: 'preview',
    codeFontSize: 0,
    wrapLongLines: false,
    showLineNumbers: false,
    externalChange: 'auto',
    keepBackups: true,
  },
  overridable: [],
  overrides: [],
  autoSavePaused: false,
  autoSaveTimer: null,
  savedFlashTimer: null,
  saveStatus: '',
  popView: 'settings',
  history: [],
  historyRel: '',
};

const QUICK_SETTINGS = [
  { group: '显示与排序' },
  { key: 'showHidden', label: '显示以「.」开头的文件' },
  { key: 'textOnly', label: '只显示文本类文件' },
  { key: 'showModTime', label: '显示修改时间' },
  { key: 'hideIgnoredFolders', label: '隐藏被忽略的目录' },
  { key: 'sortOrder', label: '最近修改在前', cycle: ['name', 'recent'] },
];

const AUTO_SAVE_DELAY_MS = 900;

const el = (id) => document.getElementById(id);
const ui = {
  crumb: el('crumb'),
  modeBtn: el('btn-mode'),
  external: el('btn-external'),
  viewer: el('viewer'),
  empty: el('empty'),
  preview: el('preview'),
  editorWrap: el('editor-wrap'),
  editor: el('editor'),
  media: el('media'),
  banner: el('banner'),
  bannerText: el('banner-text'),
  bannerAction: el('banner-action'),
  bannerClose: el('banner-close'),
  search: el('search'),
  tabs: el('tabs'),
  tree: el('tree'),
  sessionList: el('session-list'),
  touchedCount: el('touched-count'),
  foot: el('foot'),
  ctxmenu: el('ctxmenu'),
  toast: el('toast'),
  splitter: el('splitter'),
  sidebar: document.querySelector('.sidebar'),
  app: el('app'),
  gutter: el('gutter'),
  settingsBtn: el('btn-settings'),
  settingsPop: el('settings-pop'),
  settingsRows: el('settings-rows'),
  settingsReset: el('settings-reset'),
  fileActions: el('file-actions'),
  historyView: el('history-view'),
  popoverFoot: el('popover-foot'),
  saveStatus: el('save-status'),
};

/* ── helpers ─────────────────────────────────────────────────────────────── */

function send(message) {
  bridge.postMessage(message);
}

let toastTimer = null;
function toast(text) {
  ui.toast.textContent = text;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, 2200);
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)}${units[unit]}`;
}

function baseName(rel) {
  const parts = rel.split('/');
  return parts[parts.length - 1];
}

const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

/** Compact mtime: today → HH:MM, this year → MM-DD, older → YYYY-MM. */
function fmtTime(ms) {
  if (!ms) return '';
  const date = new Date(ms);
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  if (date.toDateString() === now.toDateString()) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.getFullYear() === now.getFullYear()) return `${MONTHS[date.getMonth()]}-${pad(date.getDate())}`;
  return `${date.getFullYear()}-${MONTHS[date.getMonth()]}`;
}

const ICON_FOLDER =
  '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.4 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
const ICON_FILE =
  '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>';
const ICON_MD =
  '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M8 17v-4l1.6 2L11 13v4M14.5 13v4M13 15.5l1.5 1.5 1.5-1.5"/></svg>';

function iconFor(entry) {
  if (entry.dir) return ICON_FOLDER;
  const lower = entry.name.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return ICON_MD;
  return ICON_FILE;
}

/* ── crumb ───────────────────────────────────────────────────────────────── */

function renderCrumb() {
  const file = S.current;
  const segs = S.rootLabel ? [S.rootLabel] : [];
  if (file) segs.push(...file.rel.split('/'));
  ui.crumb.innerHTML = '';
  segs.forEach((seg, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '›';
      ui.crumb.appendChild(sep);
    }
    const span = document.createElement('span');
    span.className = index === segs.length - 1 ? 'seg-item here' : 'seg-item';
    span.textContent = seg;
    ui.crumb.appendChild(span);
  });
  if (S.dirty) {
    const dot = document.createElement('span');
    dot.className = 'sep dirty';
    dot.textContent = '●';
    dot.title = '有未保存的修改';
    ui.crumb.appendChild(dot);
  }
  ui.crumb.title = S.root + (file ? `/${file.rel}` : '');
}

/* ── tree ────────────────────────────────────────────────────────────────── */

function rowEl({ rel, name, dir, size, mtimeMs, changed, touched, hits, ignored }, options = {}) {
  const row = document.createElement('div');
  row.className = 'row';
  if (dir && ignored) row.classList.add('dim');
  if (dir && S.open.has(rel)) row.classList.add('open');
  if (S.current && S.current.rel === rel) row.classList.add('sel');
  row.dataset.rel = rel;
  row.dataset.dir = dir ? '1' : '0';

  if (dir) {
    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '▶';
    row.appendChild(chev);
  } else {
    const pad = document.createElement('span');
    pad.className = 'chev';
    row.appendChild(pad);
  }

  const ico = document.createElement('span');
  ico.className = 'ico';
  ico.innerHTML = iconFor({ dir, name });
  row.appendChild(ico);

  const label = document.createElement('span');
  label.className = 'name grow';
  label.textContent = name;
  row.appendChild(label);

  if (hits > 1) {
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = `${hits}×`;
    row.appendChild(sub);
  } else if (!dir && S.settings.showModTime) {
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = fmtTime(mtimeMs);
    row.appendChild(sub);
  } else if (!dir && size) {
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = fmtSize(size);
    row.appendChild(sub);
  }

  if (changed) {
    const dot = document.createElement('span');
    dot.className = 'dot changed';
    dot.title = '本会话期间新增或改动';
    row.appendChild(dot);
  } else if (touched || hits > 0) {
    const dot = document.createElement('span');
    dot.className = 'dot touched';
    dot.title = '出现在本次对话中';
    row.appendChild(dot);
  }

  row.title = rel;
  if (options.onClick) row.addEventListener('click', options.onClick);
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openContextMenu(event.clientX, event.clientY, { rel, name, dir });
  });
  return row;
}

function renderTree() {
  ui.tree.innerHTML = '';
  const roots = S.dirs.get('') ?? [];
  if (!roots.length) {
    if (S.pendingDirs.has('')) {
      const loading = document.createElement('div');
      loading.className = 'group';
      loading.textContent = '读取中…';
      ui.tree.appendChild(loading);
    }
    return;
  }
  const walk = (parent, entries) => {
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const enriched = {
        ...entry,
        changed: !entry.dir && S.changed.has(entry.rel),
        touched: S.touched.has(entry.rel),
        hits: S.touched.get(entry.rel) ?? 0,
      };
      fragment.appendChild(
        rowEl(enriched, {
          onClick: () => {
            if (entry.dir) toggleDir(entry.rel);
            else openFile(entry.rel);
          },
        }),
      );
      if (entry.dir && S.open.has(entry.rel)) {
        const children = S.dirs.get(entry.rel);
        if (children) {
          const wrap = document.createElement('div');
          wrap.className = 'children';
          wrap.style.marginLeft = `${9}px`;
          wrap.appendChild(walk(entry.rel, children));
          fragment.appendChild(wrap);
        } else {
          const loading = document.createElement('div');
          loading.className = 'row';
          loading.style.paddingLeft = '22px';
          loading.innerHTML = '<span class="name">读取中…</span>';
          fragment.appendChild(loading);
        }
      }
    }
    return fragment;
  };
  ui.tree.appendChild(walk('', roots));
  renderFoot();
}

function renderFoot() {
  const total = [...S.dirs.values()].reduce((sum, list) => sum + list.length, 0);
  ui.foot.innerHTML =
    `<span><span class="legend-dot" style="background:var(--fb-accent)"></span>本会话改动 ${S.changed.size}</span>` +
    `<span><span class="legend-dot" style="background:var(--fb-warning)"></span>对话涉及 ${S.touched.size}</span>` +
    `<span class="grow"></span><span>已列出 ${total}</span>`;
}

function toggleDir(rel) {
  if (S.open.has(rel)) {
    S.open.delete(rel);
    renderTree();
    return;
  }
  S.open.add(rel);
  if (!S.dirs.has(rel)) {
    S.pendingDirs.add(rel);
    send({ type: 'listDir', rel });
  }
  renderTree();
}

function expandTo(rel) {
  const parts = rel.split('/');
  parts.pop();
  let prefix = '';
  for (const part of parts) {
    prefix = prefix ? `${prefix}/${part}` : part;
    S.open.add(prefix);
    if (!S.dirs.has(prefix)) {
      S.pendingDirs.add(prefix);
      send({ type: 'listDir', rel: prefix });
    }
  }
}

/* ── viewer ──────────────────────────────────────────────────────────────── */

function setPanels({ empty = false, preview = false, editor = false, media = false }) {
  ui.empty.hidden = !empty;
  ui.preview.hidden = !preview;
  ui.editorWrap.hidden = !editor;
  ui.media.hidden = !media;
}

const EMPTY_MARKUP =
  '<div class="empty-title">选择一个文件开始</div>' +
  '<div class="empty-sub">右侧是这个对话绑定文件夹里的全部文件</div>';

function resetEmpty() {
  ui.empty.innerHTML = EMPTY_MARKUP;
}

/** Show a picture in the media pane (checkerboard background, centred). */
function showMedia(src, name, { scalable = false } = {}) {
  setPanels({ media: true });
  ui.media.classList.toggle('scalable', scalable);
  ui.media.innerHTML = '';
  const img = document.createElement('img');
  img.src = src;
  img.alt = name;
  ui.media.appendChild(img);
}

/**
 * Render an SVG from its source text. A data URL is used rather than
 * finch-file:// so the preview always matches what is in the editor, even
 * before it has been saved. SVG loaded as an <img> cannot run scripts.
 *
 * `scalable` lets a small icon (say 24×24) fill the pane — lossless for vector art.
 */
function showSvg(source, name) {
  showMedia(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`, name, { scalable: true });
}

function renderPreview(file) {
  if (file.flavor === 'markdown') {
    const html = marked.parse(file.content, { gfm: true, breaks: false, async: false });
    ui.preview.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
    ui.preview.querySelectorAll('pre code').forEach((block) => {
      try {
        hljs.highlightElement(block);
      } catch {
        /* keep plain text */
      }
    });
  } else {
    ui.preview.innerHTML = '';
    const pre = document.createElement('pre');
    pre.className = 'code-standalone';
    const code = document.createElement('code');
    code.textContent = file.content;
    if (file.flavor === 'code') {
      try {
        code.innerHTML = hljs.highlightAuto(file.content).value;
        code.classList.add('hljs');
      } catch {
        /* keep plain text */
      }
    }
    pre.appendChild(code);
    ui.preview.appendChild(pre);
  }
  ui.preview.scrollTop = 0;
}

function showBinaryCard(file) {
  setPanels({ empty: true });
  ui.empty.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'binary-card';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = file.rel;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${file.kind === 'too-large' ? '文件过大' : '二进制文件'} · ${fmtSize(file.size)}`;
  const button = document.createElement('button');
  button.className = 'btn';
  button.type = 'button';
  button.textContent = '用系统程序打开';
  button.addEventListener('click', () => send({ type: 'openExternal', rel: file.rel }));
  card.append(name, meta, button);
  ui.empty.appendChild(card);
}

function updateModeButton() {
  const file = S.current;
  const isText = Boolean(file && file.kind === 'text');
  ui.modeBtn.hidden = !isText;
  if (!isText) return;
  // The label names the action, not the current state — like GitHub's Code/Preview.
  ui.modeBtn.textContent = S.mode === 'source' ? '查看预览' : '查看源码';
  ui.modeBtn.title = S.mode === 'source' ? '切回渲染后的预览' : '查看并编辑 Markdown 源码';
}

function applyMode() {
  const file = S.current;
  if (!file || file.kind !== 'text') {
    updateModeButton();
    return;
  }
  updateModeButton();
  if (S.mode === 'source') {
    setPanels({ editor: true });
    if (!S.dirty && ui.editor.value !== file.content) ui.editor.value = file.content;
  } else if (file.flavor === 'svg') {
    showSvg(S.dirty ? ui.editor.value : file.content, file.name);
  } else {
    setPanels({ preview: true });
    renderPreview({ ...file, content: S.dirty ? ui.editor.value : file.content });
  }
}

function openFile(rel) {
  // Auto-save is always on, so a file switch flushes instead of prompting.
  if (S.dirty && S.current && S.current.rel !== rel) flushAutoSave();
  clearTimeout(S.autoSaveTimer);
  S.dirty = false;
  ui.external.disabled = true;
  S.diskConflict = null;
  hideBanner();
  send({ type: 'open', rel });
  renderTree();
}

function showFile(file) {
  const previous = S.current;
  const sameFile = Boolean(previous && previous.rel === file.rel);
  // Re-opening the file we already have open (a refresh, or an external change we
  // reloaded) must not yank the view mode or the caret out from under the user.
  const keepMode = sameFile ? S.mode : null;
  const caret = sameFile
    ? { start: ui.editor.selectionStart, end: ui.editor.selectionEnd, top: ui.editor.scrollTop }
    : null;

  S.current = file;
  S.diskConflict = null;
  S.dirty = false;
  resetEmpty();
  ui.editor.value = file.kind === 'text' ? file.content : '';
  if (caret) {
    const max = ui.editor.value.length;
    ui.editor.selectionStart = Math.min(caret.start, max);
    ui.editor.selectionEnd = Math.min(caret.end, max);
    ui.editor.scrollTop = caret.top;
  }
  renderGutter();
  S.mode = keepMode ?? (file.flavor === 'markdown' && S.settings.markdownView === 'source' ? 'source' : 'preview');
  updateModeButton();

  if (file.kind === 'image') {
    showMedia(file.url, file.name);
  } else if (file.kind === 'text') {
    applyMode();
  } else {
    showBinaryCard(file);
  }
  ui.external.disabled = false;
  S.autoSavePaused = false;
  setSaveStatus('');
  renderFileActions();
  renderCrumb();
  renderTree();
}

/** Clear the viewer when the open file is gone — renamed away, trashed, … */
function closeFile() {
  S.current = null;
  S.dirty = false;
  S.history = [];
  resetEmpty();
  setPanels({ empty: true });
  ui.modeBtn.hidden = true;
  ui.external.disabled = true;
  setSaveStatus('');
  renderFileActions();
  renderCrumb();
  renderTree();
}

/* ── banner ──────────────────────────────────────────────────────────────── */

function showBanner(text, actionLabel, action) {
  ui.bannerText.textContent = text;
  ui.banner.hidden = false;
  if (actionLabel && action) {
    ui.bannerAction.hidden = false;
    ui.bannerAction.textContent = actionLabel;
    ui.bannerAction.onclick = action;
  } else {
    ui.bannerAction.hidden = true;
  }
}

function hideBanner() {
  ui.banner.hidden = true;
}

/* ── saving ──────────────────────────────────────────────────────────────── */

function save({ silent = true } = {}) {
  const file = S.current;
  if (!file || !file.editable) return;
  clearTimeout(S.autoSaveTimer);
  if (silent) setSaveStatus('saving');
  const content = ui.editor.value;
  send({ type: 'save', rel: file.rel, content, baseMtimeMs: file.mtimeMs });
}

ui.editor.addEventListener('input', () => {
  const file = S.current;
  if (!file) return;
  S.dirty = ui.editor.value !== file.content;
  if (!S.autoSavePaused) setSaveStatus('dirty');
  scheduleAutoSave();
  renderGutter();
  renderCrumb();
});

ui.editor.addEventListener('scroll', () => {
  ui.gutter.scrollTop = ui.editor.scrollTop;
});

document.addEventListener('keydown', (event) => {
  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key.toLowerCase() === 's') {
    // Save is automatic; the shortcut just forces it now instead of in 0.9s.
    event.preventDefault();
    if (S.current && S.current.editable && S.dirty) save();
  }
  if (meta && event.key.toLowerCase() === 'r' && event.shiftKey) {
    event.preventDefault();
    send({ type: 'refresh', rel: '' });
  }
  if (event.key === 'Escape') hideCtxMenu();
});

ui.external.addEventListener('click', () => {
  if (!S.current) return;
  send({ type: 'openExternal', rel: S.current.rel });
});

ui.bannerClose.addEventListener('click', hideBanner);

ui.modeBtn.addEventListener('click', () => {
  S.mode = S.mode === 'source' ? 'preview' : 'source';
  applyMode();
});

/* ── context menu ────────────────────────────────────────────────────────── */

function openContextMenu(x, y, target) {
  ui.ctxmenu.innerHTML = '';
  const add = (label, handler, className) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (className) button.className = className;
    button.addEventListener('click', () => {
      hideCtxMenu();
      handler();
    });
    ui.ctxmenu.appendChild(button);
  };
  const addSeparator = () => ui.ctxmenu.appendChild(document.createElement('hr'));

  if (target.dir && target.rel === '') {
    // The folder root: it can hold new entries but cannot be renamed or removed.
    add('新建文件…', () => send({ type: 'newFile', dir: '' }));
    add('新建文件夹…', () => send({ type: 'newFolder', dir: '' }));
    addSeparator();
    add('刷新', () => send({ type: 'refresh', rel: '' }));
    add('在访达中显示', () => send({ type: 'reveal', rel: '' }));
  } else if (target.dir) {
    add('展开 / 折叠', () => toggleDir(target.rel));
    addSeparator();
    add('新建文件…', () => send({ type: 'newFile', dir: target.rel }));
    add('新建文件夹…', () => send({ type: 'newFolder', dir: target.rel }));
    addSeparator();
    add('在此处重命名…', () => send({ type: 'rename', rel: target.rel }));
    add('在访达中显示', () => send({ type: 'reveal', rel: target.rel }));
    addSeparator();
    add('移到废纸篓', () => send({ type: 'trash', rel: target.rel }), 'danger');
  } else {
    add('打开', () => openFile(target.rel));
    add('用系统程序打开', () => send({ type: 'openExternal', rel: target.rel }));
    add('在访达中显示', () => send({ type: 'reveal', rel: target.rel }));
    addSeparator();
    add('重命名…', () => send({ type: 'rename', rel: target.rel }));
    add('复制路径', async () => {
      try {
        await navigator.clipboard.writeText(`${S.root}/${target.rel}`);
        toast('已复制绝对路径');
      } catch {
        toast('复制失败');
      }
    });
    add('复制相对路径', async () => {
      try {
        await navigator.clipboard.writeText(target.rel);
        toast('已复制相对路径');
      } catch {
        toast('复制失败');
      }
    });
    addSeparator();
    add('插入到对话', () => addToComposer(target.rel));
    addSeparator();
    add('移到废纸篓', () => send({ type: 'trash', rel: target.rel }), 'danger');
  }

  ui.ctxmenu.hidden = false;
  const rect = ui.ctxmenu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  ui.ctxmenu.style.left = `${Math.max(4, left)}px`;
  ui.ctxmenu.style.top = `${Math.max(4, top)}px`;
}

function hideCtxMenu() {
  ui.ctxmenu.hidden = true;
}

document.addEventListener('click', (event) => {
  if (!ui.ctxmenu.contains(event.target)) hideCtxMenu();
  if (!ui.settingsPop.contains(event.target) && event.target !== ui.settingsBtn) toggleSettingsPop(false);
});
document.addEventListener('scroll', hideCtxMenu, true);

// Right-clicking the empty area of the tree targets the folder root itself.
ui.tree.addEventListener('contextmenu', (event) => {
  if (event.target.closest('.row')) return;
  event.preventDefault();
  openContextMenu(event.clientX, event.clientY, { rel: '', name: '', dir: true });
});

async function addToComposer(rel) {
  const lines = S.current && S.current.rel === rel && typeof S.current.lineCount === 'number' ? S.current.lineCount : 1;
  try {
    await bridge.composer.addContexts([
      {
        type: 'file-range',
        path: `${S.root}/${rel}`,
        ranges: [{ startLine: 1, endLine: Math.max(1, lines) }],
        displayName: rel,
      },
    ]);
    toast('已插入到对话输入框');
  } catch {
    try {
      await bridge.composer.addContexts([{ type: 'annotation', label: rel, path: `${S.root}/${rel}` }]);
      toast('已插入到对话输入框');
    } catch {
      toast('插入失败，请在对话里直接 @ 该文件');
    }
  }
}

/* ── settings ────────────────────────────────────────────────────────────── */

function settingValue(key) {
  return S.settings[key];
}

function isOverridden(key) {
  return S.overrides.includes(key);
}

function applySettings() {
  const { codeFontSize, wrapLongLines, showLineNumbers } = S.settings;
  ui.editor.style.fontSize = codeFontSize > 0 ? `${codeFontSize}px` : '';
  ui.gutter.style.fontSize = codeFontSize > 0 ? `${codeFontSize}px` : '';
  ui.editor.classList.toggle('wrap', Boolean(wrapLongLines));
  ui.gutter.hidden = !showLineNumbers;
  if (showLineNumbers) renderGutter();

  renderSettingsRows();
  renderFileActions();
  renderFoot();
}

function setSaveStatus(kind, text) {
  clearTimeout(S.savedFlashTimer);
  ui.saveStatus.classList.remove('dirty', 'saving', 'saved', 'failed');
  if (kind) ui.saveStatus.classList.add(kind);
  const labels = { dirty: '未保存', saving: '保存中…', saved: '已保存', failed: '保存失败' };
  ui.saveStatus.textContent = text ?? labels[kind] ?? '';
  // Idle with nothing to say: hide the chip rather than showing a bare dot.
  ui.saveStatus.hidden = !kind;
  if (kind === 'saved') {
    S.savedFlashTimer = setTimeout(() => {
      ui.saveStatus.classList.remove('saved');
      ui.saveStatus.textContent = '';
      ui.saveStatus.hidden = true;
    }, 2200);
  }
}

function scheduleAutoSave() {
  if (S.autoSavePaused) return;
  clearTimeout(S.autoSaveTimer);
  S.autoSaveTimer = setTimeout(() => {
    if (!S.current || !S.current.editable || !S.dirty) return;
    save();
  }, AUTO_SAVE_DELAY_MS);
}

/** Auto-save flushes before anything that would otherwise drop unsaved edits. */
function flushAutoSave() {
  clearTimeout(S.autoSaveTimer);
  if (S.autoSavePaused) return;
  if (S.current && S.current.editable && S.dirty) save();
}

/**
 * "This file" group: the version history entry point. Real history rather than a
 * one-step revert — each entry can be compared in Finch's native diff viewer or
 * restored (which snapshots the current content first, so it stays reversible).
 */
function renderFileActions() {
  ui.fileActions.innerHTML = '';
  const file = S.current;
  if (!file || !file.editable) return;

  const count = file.historyCount ?? 0;
  const row = document.createElement('div');
  row.className = `prow action${count ? '' : ' disabled'}`;
  const box = document.createElement('span');
  box.className = 'box action';
  box.textContent = '⧉';
  const label = document.createElement('span');
  label.className = 'prow-label';
  label.textContent = '版本历史';
  const value = document.createElement('span');
  value.className = 'prow-value';
  value.textContent = count ? `${count} 个版本` : '无';
  row.append(box, label, value);
  row.title = count ? '查看历史版本、对比差异或恢复' : '还没有历史版本（编辑保存后会出现）';
  if (count) {
    row.addEventListener('click', () => {
      S.historyRel = file.rel;
      send({ type: 'history', rel: file.rel });
    });
  }

  const header = document.createElement('div');
  header.className = 'popover-group';
  header.textContent = '这个文件';
  ui.fileActions.append(header, row);
}

function setPopoverView(view) {
  S.popView = view;
  const history = view === 'history';
  ui.settingsRows.hidden = history;
  ui.fileActions.hidden = history;
  ui.historyView.hidden = !history;
  ui.popoverFoot.hidden = history;
  if (history) renderHistoryView();
}

function renderHistoryView() {
  ui.historyView.innerHTML = '';
  const back = document.createElement('div');
  back.className = 'prow action';
  const arrow = document.createElement('span');
  arrow.className = 'box action';
  arrow.textContent = '‹';
  const backLabel = document.createElement('span');
  backLabel.className = 'prow-label';
  backLabel.textContent = '版本历史';
  const name = document.createElement('span');
  name.className = 'prow-value';
  name.textContent = baseName(S.historyRel ?? '');
  back.append(arrow, backLabel, name);
  back.addEventListener('click', () => setPopoverView('settings'));
  ui.historyView.appendChild(back);

  const entries = S.history ?? [];
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'popover-group';
    empty.textContent = '还没有历史版本';
    ui.historyView.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'prow history';
    const label = document.createElement('span');
    label.className = 'prow-label';
    label.textContent = `${fmtTime(entry.at)} · ${entry.lines} 行`;
    label.title = `${new Date(entry.at).toLocaleString()} 的版本 · 点一下与当前对比`;
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'prow-btn';
    restore.textContent = '↺';
    restore.title = '恢复到这个版本（当前内容会先存入历史，可再撤销）';
    restore.addEventListener('click', (event) => {
      event.stopPropagation();
      flushAutoSave();
      send({ type: 'historyRestore', rel: S.historyRel, id: entry.id });
      setPopoverView('settings');
      toggleSettingsPop(false);
    });
    row.append(label, restore);
    row.addEventListener('click', () => {
      send({ type: 'historyDiff', rel: S.historyRel, id: entry.id });
      toggleSettingsPop(false);
    });
    ui.historyView.appendChild(row);
  }

  const hint = document.createElement('div');
  hint.className = 'popover-group';
  hint.textContent = '点一行在 Finch 的 Diff 里与当前对比，↺ 恢复到该版本';
  ui.historyView.appendChild(hint);
}

function renderGutter() {
  if (ui.gutter.hidden) return;
  const lines = ui.editor.value.split('\n').length;
  const width = String(lines).length;
  let out = '';
  for (let index = 1; index <= lines; index += 1) {
    out += `${String(index).padStart(width, ' ')}\n`;
  }
  ui.gutter.textContent = out;
  ui.gutter.scrollTop = ui.editor.scrollTop;
}

function renderSettingsRows() {
  ui.settingsRows.innerHTML = '';
  for (const item of QUICK_SETTINGS) {
    if (item.group) {
      const header = document.createElement('div');
      header.className = 'popover-group';
      header.textContent = item.group;
      ui.settingsRows.appendChild(header);
      continue;
    }
    const on = item.cycle ? settingValue(item.key) === item.cycle[1] : Boolean(settingValue(item.key));
    const row = document.createElement('div');
    row.className = `prow${on ? ' on' : ''}`;
    row.dataset.key = item.key;

    const box = document.createElement('span');
    box.className = 'box';
    box.textContent = on ? '✓' : '';

    const label = document.createElement('span');
    label.className = 'prow-label';
    label.textContent = item.label;

    row.append(box, label);

    if (item.cycle) {
      const value = document.createElement('span');
      value.className = 'prow-value';
      value.textContent = settingValue(item.key) === 'recent' ? '开' : '关';
      row.appendChild(value);
    }

    if (isOverridden(item.key)) {
      const dot = document.createElement('span');
      dot.className = 'prow-dot';
      dot.title = '已在面板里改过（覆盖了设置页的值）';
      row.appendChild(dot);
    }

    row.addEventListener('click', () => {
      const next = item.cycle
        ? (settingValue(item.key) === item.cycle[1] ? item.cycle[0] : item.cycle[1])
        : !settingValue(item.key);
      send({ type: 'setSetting', key: item.key, value: next, rel: '' });
    });
    ui.settingsRows.appendChild(row);
  }
}

function toggleSettingsPop(force) {
  const open = typeof force === 'boolean' ? force : ui.settingsPop.hidden;
  ui.settingsPop.hidden = !open;
  ui.settingsBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    setPopoverView('settings');
    renderSettingsRows();
    renderFileActions();
  }
}

ui.settingsBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleSettingsPop();
});

ui.settingsPop.addEventListener('click', (event) => event.stopPropagation());

ui.settingsReset.addEventListener('click', () => {
  send({ type: 'resetSettings' });
});

/* ── sidebar tabs / search ───────────────────────────────────────────────── */

ui.tabs.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  S.tab = button.dataset.tab;
  [...ui.tabs.children].forEach((child) => child.classList.toggle('on', child === button));
  showList(S.tab);
  if (S.searchQuery) {
    send({ type: 'scan', query: S.searchQuery, onlyTouched: S.tab === 'session' });
    return;
  }
  if (S.tab === 'session') send({ type: 'touched' });
  else renderTree();
});

let searchTimer = null;
ui.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const query = ui.search.value.trim();
    S.searchQuery = query;
    if (!query) {
      S.searchResults = null;
      showList(S.tab);
      if (S.tab === 'session') send({ type: 'touched' });
      else renderTree();
      return;
    }
    send({ type: 'scan', query, onlyTouched: S.tab === 'session' });
  }, 180);
});

function activeList() {
  return S.tab === 'session' ? ui.sessionList : ui.tree;
}

function showList(tab) {
  ui.tree.hidden = tab !== 'tree';
  ui.sessionList.hidden = tab !== 'session';
}

function renderSearchResults(message) {
  if (Array.isArray(message.changed)) S.changed = new Set(message.changed);
  S.searchResults = message.files ?? [];
  const container = activeList();
  showList(S.tab);
  container.hidden = false;
  container.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'group';
  head.textContent = `${S.searchResults.length} 个匹配 · “${message.query}”`;
  container.appendChild(head);
  for (const file of S.searchResults) {
    container.appendChild(
      rowEl(
        { ...file, dir: false, ignored: false, hits: file.hits ?? 0 },
        {
          onClick: () => {
            S.searchResults = null;
            S.searchQuery = '';
            ui.search.value = '';
            expandTo(file.rel);
            showList('tree');
            S.tab = 'tree';
            [...ui.tabs.children].forEach((child) => child.classList.toggle('on', child.dataset.tab === 'tree'));
            for (const rel of ['', ...ancestorsOf(file.rel)]) send({ type: 'listDir', rel });
            openFile(file.rel);
          },
        },
      ),
    );
  }
}

function ancestorsOf(rel) {
  const parts = rel.split('/');
  parts.pop();
  const out = [];
  let prefix = '';
  for (const part of parts) {
    prefix = prefix ? `${prefix}/${part}` : part;
    out.push(prefix);
  }
  return out;
}

function syncBadge() {
  const count = S.touched.size;
  ui.touchedCount.textContent = String(count);
  ui.touchedCount.hidden = count === 0;
  renderFoot();
}

function renderTouched(message) {
  S.sessionStartedAtMs = message.sessionStartedAtMs ?? S.sessionStartedAtMs;
  S.touched = new Map((message.files ?? []).map((file) => [file.rel, file.hits]));
  syncBadge();

  if (S.tab !== 'session' || S.searchQuery) return;
  ui.sessionList.innerHTML = '';
  const files = message.files ?? [];
  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'group';
    empty.textContent = '这次对话还没有碰到任何文件';
    ui.sessionList.appendChild(empty);
    return;
  }
  const head = document.createElement('div');
  head.className = 'group';
  head.textContent = `本次对话涉及 ${files.length} 个文件`;
  ui.sessionList.appendChild(head);
  for (const file of files) {
    ui.sessionList.appendChild(
      rowEl(
        {
          rel: file.rel,
          name: baseName(file.rel),
          dir: false,
          ignored: false,
          changed: file.changed,
          touched: true,
          hits: file.hits,
        },
        {
          onClick: () => {
            expandTo(file.rel);
            openFile(file.rel);
          },
        },
      ),
    );
  }
}

/* ── splitter ────────────────────────────────────────────────────────────── */

ui.splitter.addEventListener('mousedown', (event) => {
  event.preventDefault();
  ui.splitter.classList.add('dragging');
  const move = (moveEvent) => {
    const width = window.innerWidth - moveEvent.clientX;
    ui.sidebar.style.width = `${Math.min(Math.max(width, 180), window.innerWidth - 260)}px`;
  };
  const up = () => {
    ui.splitter.classList.remove('dragging');
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
});

/* ── host messages ───────────────────────────────────────────────────────── */

function handle(message) {
  if (!message || typeof message !== 'object') return;
  switch (message.type) {
    case 'snapshot': {
      S.root = message.root;
      S.rootLabel = message.rootLabel;
      S.locale = message.locale ?? S.locale;
      S.sessionStartedAtMs = message.sessionStartedAtMs ?? 0;
      document.documentElement.lang = S.locale === 'zh-CN' ? 'zh-CN' : 'en';
      renderCrumb();
      renderFoot();
      break;
    }
    case 'dir': {
      S.dirs.set(message.rel, message.entries ?? []);
      S.pendingDirs.delete(message.rel);
      if (Array.isArray(message.changed)) S.changed = new Set(message.changed);
      if (Array.isArray(message.touched)) S.touched = new Map(message.touched);
      syncBadge();
      if (S.searchQuery) {
        send({ type: 'scan', query: S.searchQuery, onlyTouched: S.tab === 'session' });
      } else {
        renderTree();
      }
      break;
    }
    case 'file':
      showFile(message);
      break;
    case 'saved': {
      if (S.current && S.current.rel === message.rel) {
        S.current.mtimeMs = message.mtimeMs;
        S.current.size = message.size;
        if (typeof message.historyCount === 'number') S.current.historyCount = message.historyCount;
        S.dirty = false;
        setSaveStatus('saved');
        if (message.reason === 'restore') {
          // The disk now holds another version — reload it instead of trusting the buffer.
          send({ type: 'open', rel: message.rel });
        } else {
          S.current.content = ui.editor.value;
          S.current.lineCount = ui.editor.value.split('\n').length;
          renderCrumb();
          renderFileActions();
        }
      }
      S.changed.add(message.rel);
      hideBanner();
      if (message.reason === 'restore') toast(message.message ?? '已恢复');
      send({ type: 'listDir', rel: '' });
      break;
    }
    case 'saveConflict': {
      S.diskConflict = message;
      S.autoSavePaused = true;
      setSaveStatus('failed', '磁盘上有更新');
      showBanner('这个文件在磁盘上已被修改', '以我的版本覆盖', () => {
        if (!S.current) return;
        S.autoSavePaused = false;
        S.current.mtimeMs = message.mtimeMs;
        save();
      });
      break;
    }
    case 'scan':
      renderSearchResults(message);
      break;
    case 'touched':
      renderTouched(message);
      break;
    case 'fsChange': {
      const paths = message.paths ?? [];
      const dirsToRefresh = new Set(['']);
      for (const rel of paths) {
        const parts = rel.split('/');
        parts.pop();
        const dir = parts.join('/');
        if (S.open.has(dir) || dir === '') dirsToRefresh.add(dir);
      }
      for (const dir of dirsToRefresh) send({ type: 'listDir', rel: dir });
      if (S.current && paths.includes(S.current.rel)) {
        if (S.dirty || S.settings.externalChange === 'ask') {
          showBanner('磁盘上的版本已更新', '重新载入', () => {
            if (S.current) send({ type: 'open', rel: S.current.rel });
          });
        } else {
          send({ type: 'open', rel: S.current.rel });
        }
      }
      break;
    }
    case 'settings': {
      S.settings = { ...S.settings, ...(message.settings ?? {}) };
      if (Array.isArray(message.overridableKeys)) S.overridable = message.overridableKeys;
      if (Array.isArray(message.overrides)) S.overrides = message.overrides;
      applySettings();
      if (message.reset) toast('已恢复默认设置');
      break;
    }
    case 'treeChanged': {
      if (message.renamed) {
        S.dirs.delete(message.renamed.from);
        S.open.delete(message.renamed.from);
        if (S.current && S.current.rel === message.renamed.from) send({ type: 'open', rel: message.renamed.to });
      }
      if (message.removed && S.current && S.current.rel === message.removed) closeFile();
      if (message.created) {
        expandTo(message.created);
        openFile(message.created);
      }
      expandTo((message.dir ?? '') + '/x');
      send({ type: 'listDir', rel: message.dir ?? '' });
      if ((message.dir ?? '') !== '') send({ type: 'listDir', rel: '' });
      send({ type: 'touched' });
      if (message.message) toast(message.message);
      break;
    }
    case 'history': {
      S.history = message.entries ?? [];
      S.historyRel = message.rel ?? '';
      setPopoverView('history');
      break;
    }
    case 'toast':
      toast(message.message);
      break;
    case 'error':
      toast(message.message ?? '操作失败');
      break;
    case 'noWorkspace':
      ui.empty.innerHTML = '';
      const note = document.createElement('div');
      note.className = 'empty-title';
      note.textContent = '这个对话还没有绑定文件夹';
      const sub = document.createElement('div');
      sub.className = 'empty-sub';
      sub.textContent = '把对话放到一个 Space（绑定目录）里，或者直接告诉 Finch 目录路径';
      ui.empty.append(note, sub);
      setPanels({ empty: true });
      break;
    default:
      break;
  }
}

/* ── boot ────────────────────────────────────────────────────────────────── */

function syncThemeMode() {
  const mode = getComputedStyle(document.documentElement).getPropertyValue('--finch-theme-mode').trim();
  document.documentElement.dataset.theme =
    mode === 'dark' || mode === 'light'
      ? mode
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
}

syncThemeMode();
applySettings();
bridge.onMessage(handle);
send({ type: 'ready' });
send({ type: 'touched' });
