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
  };
  const overrides = [];
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
    overridableKeys: ['showHidden', 'textOnly', 'hideIgnoredFolders', 'sortOrder', 'showModTime'],
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
  };

  const reply = (message) => {
    const emit = (payload) => listeners.forEach((listener) => listener(payload));
    if (message.type === 'ready') {
      emit({
        type: 'snapshot',
        root: '/Users/baizhou/Demo/ArrowsPuzzle',
        rootLabel: 'ArrowsPuzzle',
        locale: 'zh-CN',
        sessionStartedAtMs: Date.now() - 3600_000,
        settings: demoState,
        overridableKeys: ['showHidden', 'textOnly', 'hideIgnoredFolders', 'sortOrder', 'showModTime'],
        overrides,
      });
      emit({ type: 'dir', rel: '', entries: visibleEntries(''), changed: ['README.md', 'docs/APK-EVIDENCE.md'], touched: [['docs/APK-EVIDENCE.md', 4]] });
    } else if (message.type === 'listDir') {
      emit({ type: 'dir', rel: message.rel, entries: visibleEntries(message.rel) });
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
      emit({
        type: 'file',
        rel: message.rel,
        name,
        size: sample.length,
        mtimeMs: Date.now(),
        changed: true,
        kind: 'text',
        flavor: name.endsWith('.md') ? 'markdown' : 'code',
        editable: true,
        content: name.endsWith('.md') ? sample : '{\n  "demo": true\n}',
        lineCount: sample.split('\n').length,
        hasUndo: name.endsWith('.md'),
        absPath: `/Users/baizhou/Demo/ArrowsPuzzle/${message.rel}`,
      });
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
    postMessage: (message) => setTimeout(() => reply(message), 10),
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
  },
  overridable: [],
  overrides: [],
};

const QUICK_SETTINGS = [
  { key: 'showHidden', label: '显示以「.」开头的文件' },
  { key: 'textOnly', label: '只显示文本类文件' },
  { key: 'showModTime', label: '显示修改时间' },
  { key: 'hideIgnoredFolders', label: '隐藏被忽略的目录' },
  { key: 'sortOrder', label: '最近修改在前', cycle: ['name', 'recent'] },
];

const el = (id) => document.getElementById(id);
const ui = {
  crumb: el('crumb'),
  modeSwitch: el('mode-switch'),
  save: el('btn-save'),
  undo: el('btn-undo'),
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

function applyMode() {
  const file = S.current;
  if (!file || file.kind !== 'text') return;
  [...ui.modeSwitch.children].forEach((child) => child.classList.toggle('on', child.dataset.mode === S.mode));
  if (S.mode === 'source') {
    setPanels({ editor: true });
    if (!S.dirty && ui.editor.value !== file.content) ui.editor.value = file.content;
  } else {
    setPanels({ preview: true });
    renderPreview({ ...file, content: S.dirty ? ui.editor.value : file.content });
  }
}

function openFile(rel) {
  if (S.dirty && S.current && S.current.rel !== rel) {
    const leave = window.confirm('当前文件有未保存的修改，放弃并切换吗？');
    if (!leave) return;
  }
  S.dirty = false;
  ui.save.disabled = true;
  ui.undo.disabled = true;
  ui.external.disabled = true;
  S.diskConflict = null;
  hideBanner();
  send({ type: 'open', rel });
  renderTree();
}

function showFile(file) {
  S.current = file;
  S.diskConflict = null;
  S.dirty = false;
  resetEmpty();
  ui.editor.value = file.kind === 'text' ? file.content : '';
  renderGutter();
  ui.save.disabled = true;
  ui.modeSwitch.hidden = file.kind !== 'text';
  S.mode = file.flavor === 'markdown' && S.settings.markdownView === 'source' ? 'source' : 'preview';

  if (file.kind === 'image') {
    setPanels({ media: true });
    ui.media.innerHTML = '';
    const img = document.createElement('img');
    img.src = file.url;
    img.alt = file.name;
    ui.media.appendChild(img);
  } else if (file.kind === 'text') {
    applyMode();
  } else {
    showBinaryCard(file);
  }
  ui.external.disabled = false;
  ui.undo.disabled = !file.hasUndo;
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

function save() {
  const file = S.current;
  if (!file || !file.editable) return;
  const content = ui.editor.value;
  send({ type: 'save', rel: file.rel, content, baseMtimeMs: file.mtimeMs });
}

ui.editor.addEventListener('input', () => {
  const file = S.current;
  if (!file) return;
  S.dirty = ui.editor.value !== file.content;
  ui.save.disabled = !S.dirty;
  renderGutter();
  renderCrumb();
});

ui.editor.addEventListener('scroll', () => {
  ui.gutter.scrollTop = ui.editor.scrollTop;
});

document.addEventListener('keydown', (event) => {
  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (!ui.save.disabled) save();
  }
  if (meta && event.key.toLowerCase() === 'r' && event.shiftKey) {
    event.preventDefault();
    send({ type: 'refresh', rel: '' });
  }
  if (event.key === 'Escape') hideCtxMenu();
});

ui.save.addEventListener('click', save);

ui.undo.addEventListener('click', () => {
  if (!S.current) return;
  send({ type: 'undo', rel: S.current.rel });
});

ui.external.addEventListener('click', () => {
  if (!S.current) return;
  send({ type: 'openExternal', rel: S.current.rel });
});

ui.bannerClose.addEventListener('click', hideBanner);

ui.modeSwitch.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  S.mode = button.dataset.mode;
  [...ui.modeSwitch.children].forEach((child) => child.classList.toggle('on', child === button));
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

  if (target.dir) {
    add('展开 / 折叠', () => toggleDir(target.rel));
    add('在访达中显示', () => send({ type: 'reveal', rel: target.rel }));
  } else {
    add('打开', () => openFile(target.rel));
    add('用系统程序打开', () => send({ type: 'openExternal', rel: target.rel }));
    add('在访达中显示', () => send({ type: 'reveal', rel: target.rel }));
    addSeparator();
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
  renderFoot();
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
  if (open) renderSettingsRows();
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
        S.current.hasUndo = Boolean(message.hasUndo);
        ui.undo.disabled = !S.current.hasUndo;
        S.dirty = false;
        ui.save.disabled = true;
        if (message.reason === 'undo') {
          // The disk now holds the older content — reload it instead of trusting the editor buffer.
          send({ type: 'open', rel: message.rel });
        } else {
          S.current.content = ui.editor.value;
          renderCrumb();
        }
      }
      S.changed.add(message.rel);
      hideBanner();
      toast(message.message ?? '已保存');
      send({ type: 'listDir', rel: '' });
      break;
    }
    case 'saveConflict': {
      S.diskConflict = message;
      showBanner('这个文件在磁盘上已被修改', '以我的版本覆盖', () => {
        if (!S.current) return;
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
