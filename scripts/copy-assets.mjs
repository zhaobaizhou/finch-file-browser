import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'dist'), { recursive: true });

for (const file of ['panel.html', 'panel.css']) {
  copyFileSync(resolve(root, 'src', file), resolve(root, 'dist', file));
  console.log(`copied src/${file} → dist/${file}`);
}
