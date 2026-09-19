// Copies the Tesseract worker, WASM cores and English model into public/ocr so OCR runs
// fully offline — no CDN request ever carries (or reveals) a scanned document.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ocr');
const nm = join(root, 'node_modules');
const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];
mkdirSync(out, { recursive: true });
let copied = 0;
for (const [from, to] of files) {
  const src = join(nm, from);
  if (!existsSync(src)) {
    console.warn(`[ocr-assets] missing ${from} — OCR will be unavailable`);
    continue;
  }
  cpSync(src, join(out, to));
  copied++;
}
console.log(`[ocr-assets] copied ${copied}/${files.length} files to public/ocr`);
