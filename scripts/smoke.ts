import os from 'node:os';
import path from 'node:path';
import { classify, findFinchDataRoot, readDirEntries, resolveInside } from '../src/paths.js';
import { collectTouchedFiles, findTranscript, readSessionMeta } from '../src/session.js';

const root = '/Users/baizhou/finchnest';
const storagePath = path.join(os.homedir(), '.finch', 'extension-data', 'finch-file-browser');
const dataRoot = findFinchDataRoot(storagePath);
console.log('storagePath :', storagePath);
console.log('dataRoot    :', dataRoot);

console.log('\n── root entries ──');
for (const entry of readDirEntries(root, '').slice(0, 14)) {
  console.log(
    `${entry.dir ? 'DIR ' : 'FILE'} ${entry.rel.padEnd(28)} ${String(entry.size).padStart(8)}  ignored=${entry.ignored}`,
  );
}

console.log('\n── classify ──');
const samples = [
  ['README.md', 4200],
  ['src/index.ts', 18000],
  ['assets/logo.png', 90000],
  ['assets/logo.svg', 2400],
  ['docs/报告.docx', 30000],
  ['huge.md', 5 * 1024 * 1024],
] as const;
for (const [rel, size] of samples) {
  console.log(rel.padEnd(20), JSON.stringify(classify(rel, size, 2 * 1024 * 1024)));
}

console.log('\n── path guard ──');
for (const rel of ['src/index.ts', '../etc/passwd', '/etc/passwd', 'src/../../x']) {
  console.log(String(rel).padEnd(18), String(resolveInside(root, rel)));
}

console.log('\n── session transcript ──');
for (const sessionId of [
  'dd43fceb-1760-4397-8b07-354ba172a815',
  '437ce68b-a7cc-4b82-900d-378ef0a8c6f4',
  'no-such-session',
]) {
  const transcript = findTranscript(dataRoot, sessionId);
  const meta = readSessionMeta(transcript, sessionId);
  console.log(sessionId.slice(0, 12), '→', transcript ? path.basename(transcript) : 'NOT FOUND');
  console.log('   started:', meta.startedAtMs ? new Date(meta.startedAtMs).toISOString() : '-', 'cwd:', meta.cwd);
  if (!transcript) continue;
  const touched = collectTouchedFiles(meta.cwd ?? root, transcript);
  console.log(`   touched files: ${touched.length}`);
  for (const file of touched.slice(0, 12)) {
    console.log(`     [${file.via}] ${file.rel} ×${file.hits}`);
  }
}
