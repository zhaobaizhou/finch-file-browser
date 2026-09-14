import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Extensions we render as monospace editable text. */
const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.mdx', '.txt', '.text', '.log', '.csv', '.tsv',
  '.json', '.jsonl', '.json5', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.vue', '.svelte', '.astro',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.swift', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.php', '.lua', '.pl', '.r', '.jl', '.dart', '.scala', '.clj', '.ex', '.exs', '.erl',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.html', '.htm', '.xml', '.svg', '.css', '.scss', '.sass', '.less', '.styl',
  '.sql', '.graphql', '.gql', '.proto', '.tf', '.hcl', '.dockerfile', '.gitignore', '.npmrc',
  '.makefile', '.mk', '.cmake', '.gradle', '.patch', '.diff', '.rst', '.adoc', '.tex',
]);

/** Extensions we hand to the OS / native viewers instead of rendering in-panel. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif', '.svg']);

/** Directories that stay collapsed and are skipped by the deep scan. */
export const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', '__pycache__', '.venv', 'venv', 'env',
  '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache', '.pytest_cache', '.mypy_cache',
  '.idea', '.vscode', 'dist', 'build', 'out', '.output', 'target', 'coverage',
  '.DS_Store', '$RECYCLE.BIN', 'System Volume Information', '.Trash',
]);

/** Files that only add noise to the tree. */
export const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export type FileKind = 'text' | 'image' | 'binary' | 'too-large';

export interface FileClassification {
  kind: FileKind;
  /** True when the file can be saved back from the editor. */
  editable: boolean;
  /** Highlighting/rendering hint for the page. */
  flavor: 'markdown' | 'code' | 'plain' | 'image' | 'binary';
}

export function extOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

export function classify(filePath: string, size: number, maxTextBytes: number): FileClassification {
  const ext = extOf(filePath);
  const base = path.basename(filePath).toLowerCase();

  if (IMAGE_EXTENSIONS.has(ext) && ext !== '.svg') {
    return { kind: 'image', editable: false, flavor: 'image' };
  }
  if (ext === '.svg') return { kind: 'text', editable: true, flavor: 'code' };

  const looksText =
    TEXT_EXTENSIONS.has(ext) ||
    base.startsWith('.') ||
    base === 'makefile' ||
    base === 'dockerfile' ||
    base === 'license' ||
    base === 'readme';

  if (!looksText) return { kind: 'binary', editable: false, flavor: 'binary' };
  if (size > maxTextBytes) return { kind: 'too-large', editable: false, flavor: 'plain' };

  let flavor: FileClassification['flavor'] = 'code';
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') flavor = 'markdown';
  else if (['.txt', '.text', '.log', '.csv', '.tsv', '.rst', '.adoc'].includes(ext)) flavor = 'plain';
  return { kind: 'text', editable: true, flavor };
}

/** Resolve `rel` inside `root`, refusing anything that escapes it. */
export function resolveInside(root: string, rel: string): string | null {
  const cleaned = String(rel ?? '').replace(/^[/\\]+/, '');
  const abs = path.resolve(root, cleaned);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) return null;
  if (abs.includes('\0')) return null;
  return abs;
}

export function toRel(root: string, abs: string): string {
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join('/');
}

export interface DirEntry {
  name: string;
  rel: string;
  dir: boolean;
  size: number;
  mtimeMs: number;
  ignored: boolean;
  /** Files the current session created or modified. */
  changed?: boolean;
}

export function readDirEntries(root: string, relDir: string): DirEntry[] {
  const absDir = resolveInside(root, relDir);
  if (!absDir) return [];
  let names: string[];
  try {
    names = fs.readdirSync(absDir);
  } catch {
    return [];
  }

  const entries: DirEntry[] = [];
  for (const name of names) {
    if (IGNORED_FILES.has(name)) continue;
    const abs = path.join(absDir, name);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      continue;
    }
    const dir = stat.isDirectory();
    if (!dir && !stat.isFile() && !stat.isSymbolicLink()) continue;
    const rel = toRel(root, abs);
    entries.push({
      name,
      rel,
      dir,
      size: dir ? 0 : stat.size,
      mtimeMs: stat.mtimeMs,
      ignored: dir && IGNORED_DIRS.has(name),
    });
  }

  entries.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  });
  return entries;
}

/** Locate the Finch data root that holds `pi/sessions` (transcripts). */
export function findFinchDataRoot(storagePath: string): string | null {
  const candidates: string[] = [];
  const marker = `${path.sep}extension-data${path.sep}`;
  const idx = storagePath.indexOf(marker);
  if (idx > 0) candidates.push(storagePath.slice(0, idx));
  candidates.push(path.join(os.homedir(), '.finch'));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, 'pi'))) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}
