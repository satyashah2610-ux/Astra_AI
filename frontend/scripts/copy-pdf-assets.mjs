import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const target = resolve(root, 'public/pdf-assets', directory);
  mkdirSync(target, { recursive: true });
  cpSync(resolve(root, 'node_modules/pdfjs-dist', directory), target, { recursive: true });
}
