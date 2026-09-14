import fs from 'node:fs';
import path from 'node:path';
import { resolveInside, toRel } from './paths.js';

export interface SessionMeta {
  sessionId: string;
  startedAtMs: number;
  cwd: string | null;
  transcriptPath: string | null;
}

export interface TouchedFile {
  rel: string;
  abs: string;
  /** How many times the session referenced this file. */
  hits: number;
  firstMs: number;
  lastMs: number;
  /** `tool` = the agent read or wrote it; `text` = it was only mentioned in the reply. */
  via: 'tool' | 'text';
}

const MAX_TRANSCRIPT_BYTES = 24 * 1024 * 1024;
const PATHISH = /^(?:\.{0,2}\/|~\/|\/)|[\\/]/;

function unescapeToken(token: string): string {
  return token.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Find `pi/sessions/<workspace>/<timestamp>_<sessionId>.jsonl` for a session. */
export function findTranscript(dataRoot: string | null, sessionId: string): string | null {
  if (!dataRoot || !sessionId) return null;
  const sessionsDir = path.join(dataRoot, 'pi', 'sessions');
  let workspaces: string[];
  try {
    workspaces = fs.readdirSync(sessionsDir);
  } catch {
    return null;
  }
  const suffix = `_${sessionId}.jsonl`;
  let newest: { file: string; mtime: number } | null = null;
  for (const workspace of workspaces) {
    const dir = path.join(sessionsDir, workspace);
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(suffix)) continue;
      const full = path.join(dir, file);
      try {
        const stat = fs.statSync(full);
        if (!newest || stat.mtimeMs > newest.mtime) newest = { file: full, mtime: stat.mtimeMs };
      } catch {
        /* ignore */
      }
    }
  }
  return newest?.file ?? null;
}

export function readSessionMeta(transcriptPath: string | null, sessionId: string): SessionMeta {
  const meta: SessionMeta = { sessionId, startedAtMs: 0, cwd: null, transcriptPath };
  if (!transcriptPath) return meta;
  let fd: number | null = null;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const buffer = Buffer.alloc(8192);
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, read).toString('utf8').split('\n')[0];
    const parsed = JSON.parse(firstLine) as { type?: string; timestamp?: string; cwd?: string };
    if (parsed.type === 'session') {
      if (parsed.timestamp) meta.startedAtMs = Date.parse(parsed.timestamp) || 0;
      if (parsed.cwd) meta.cwd = parsed.cwd;
    }
  } catch {
    /* transcript unreadable — callers fall back */
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
  return meta;
}

function walkStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) walkStrings(item, out);
  }
}

/** Pull path-ish tokens out of free-form reply text. */
function tokensFromText(text: string, out: string[]): void {
  const slices = text.split(/[\s,;，；、。！？!?()[\]{}<>"'`]+/);
  for (const slice of slices) {
    const token = slice.replace(/[，。；：、！？）》”’]+$/u, '').trim();
    if (!token || token.length > 300) continue;
    if (!PATHISH.test(token)) continue;
    if (!/\.[A-Za-z0-9]{1,8}$/.test(token)) continue;
    out.push(token);
  }
}

/**
 * Read the session transcript and collect every file under `root` that the
 * conversation touched — tool call targets first, then files merely mentioned
 * in assistant replies. Everything is validated against the filesystem, so a
 * stale mention never produces a phantom entry.
 */
export function collectTouchedFiles(root: string, transcriptPath: string | null): TouchedFile[] {
  if (!transcriptPath) return [];
  let raw: string;
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size > MAX_TRANSCRIPT_BYTES) return [];
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }

  const ordered = new Map<string, TouchedFile>();
  const register = (candidate: string, when: number, via: 'tool' | 'text') => {
    const value = unescapeToken(candidate).trim();
    if (!value || value.length > 400 || value.includes('\n')) return;
    const abs = path.isAbsolute(value) ? path.normalize(value) : resolveInside(root, value);
    if (!abs) return;
    const guarded = resolveInside(root, path.relative(root, abs));
    if (!guarded) return;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(guarded);
    } catch {
      return;
    }
    if (!stat.isFile()) return;
    const rel = toRel(root, guarded);
    const existing = ordered.get(rel);
    if (existing) {
      existing.hits += 1;
      existing.lastMs = Math.max(existing.lastMs, when);
      if (via === 'tool') existing.via = 'tool';
      return;
    }
    ordered.set(rel, { rel, abs: guarded, hits: 1, firstMs: when, lastMs: when, via });
  };

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let record: { type?: string; timestamp?: string; message?: { role?: string; content?: unknown } };
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.type !== 'message' || !record.message) continue;
    const when = Date.parse(record.timestamp ?? '') || 0;
    const content = record.message.content;
    if (!Array.isArray(content)) continue;

    for (const block of content as Array<Record<string, unknown>>) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'toolCall' && block.arguments) {
        const strings: string[] = [];
        walkStrings(block.arguments, strings);
        for (const candidate of strings) register(candidate, when, 'tool');
      } else if (block.type === 'text' && block.text) {
        const tokens: string[] = [];
        tokensFromText(String(block.text), tokens);
        for (const candidate of tokens) register(candidate, when, 'text');
      }
    }
  }

  return [...ordered.values()].sort((a, b) => b.lastMs - a.lastMs);
}
