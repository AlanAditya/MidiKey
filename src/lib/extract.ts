/**
 * Turns an uploaded file into text — entirely in the browser.
 *   .txt/.md/.log/.json → text          .csv/.tsv → vitals (if recognised) or text
 *   .pdf  → pdf.js text layer, falling back to on-device OCR for scanned pages
 *   .png/.jpg/.webp/.bmp → on-device OCR (Tesseract WASM, bundled locally — no CDN)
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseVitalsCsv, type ParsedVitals } from './vitals';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface Extracted {
  text: string;
  method: 'text' | 'pdf-text' | 'pdf-ocr' | 'image-ocr' | 'csv-vitals';
  vitals?: ParsedVitals;
  warnings: string[];
  pages?: number;
}

export type Progress = (message: string, fraction?: number) => void;

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ACCEPT = '.pdf,.txt,.md,.log,.csv,.tsv,.json,.png,.jpg,.jpeg,.webp,.bmp,text/plain,application/pdf,image/*,text/csv';

const ext = (name: string) => name.toLowerCase().split('.').pop() ?? '';

export function normalizeText(t: string): string {
  return t
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let s = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if ((s.match(/�/g) ?? []).length > 3) s = new TextDecoder('windows-1252').decode(buf);
  return s;
}

export async function extractFile(file: File, onProgress: Progress = () => {}): Promise<Extracted> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`"${file.name}" is larger than 25 MB.`);
  const e = ext(file.name);
  const warnings: string[] = [];

  if (e === 'pdf' || file.type === 'application/pdf') return extractPdf(file, onProgress);

  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(e)) {
    onProgress('Running on-device OCR…', 0);
    const text = await ocr(file, (f) => onProgress('Running on-device OCR…', f));
    if (text.replace(/\s/g, '').length < 20) warnings.push('OCR found very little text. Try a sharper, better-lit image.');
    warnings.push('OCR output can contain typos — review the text before saving.');
    return { text: normalizeText(text), method: 'image-ocr', warnings };
  }

  onProgress('Reading file…');
  const raw = await readText(file);
  if (e === 'csv' || e === 'tsv') {
    const vitals = parseVitalsCsv(raw, file.name);
    if (vitals) return { text: vitals.summary, method: 'csv-vitals', vitals, warnings };
  }
  return { text: normalizeText(raw), method: 'text', warnings };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

async function extractPdf(file: File, onProgress: Progress): Promise<Extracted> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const numPages = doc.numPages;
  const warnings: string[] = [];
  const pages: string[] = [];
  let ocrPages = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    onProgress(`Reading page ${p} of ${doc.numPages}…`, (p - 1) / doc.numPages);
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let text = itemsToText(content.items as { str: string; transform: number[]; width: number; hasEOL?: boolean }[]);

    if (text.replace(/\s/g, '').length < 25) {
      // No usable text layer → scanned page: render and OCR locally
      onProgress(`Page ${p}: scanned image detected — running on-device OCR…`, (p - 1) / doc.numPages);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('canvas'))), 'image/png'));
      text = await ocr(blob, (f) => onProgress(`Page ${p}: on-device OCR…`, (p - 1 + f) / doc.numPages));
      ocrPages++;
    }
    pages.push(text);
  }
  await task.destroy();
  if (ocrPages) warnings.push(`${ocrPages} scanned page(s) were read with on-device OCR — review the text for typos.`);
  const joined = normalizeText(pages.join('\n\n'));
  if (joined.length < 20) warnings.push('No readable text was found in this PDF.');
  return { text: joined, method: ocrPages ? 'pdf-ocr' : 'pdf-text', warnings, pages: numPages };
}

function itemsToText(items: { str: string; transform: number[]; width: number; hasEOL?: boolean }[]): string {
  let out = '';
  let lastY: number | null = null;
  let lastEnd = 0;
  for (const it of items) {
    if (!('str' in it)) continue;
    const [, , , d, x, y] = it.transform;
    const size = Math.abs(d) || 10;
    if (lastY !== null && Math.abs(y - lastY) > size * 0.5) {
      out += '\n';
      lastEnd = 0;
    } else if (lastY !== null) {
      const gap = x - lastEnd;
      if (gap > size * 2.2) out += '   ';
      else if (gap > size * 0.15 && !out.endsWith(' ') && !it.str.startsWith(' ')) out += ' ';
    }
    out += it.str;
    lastY = y;
    lastEnd = x + it.width;
    if (it.hasEOL) {
      out += '\n';
      lastY = null;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// OCR (Tesseract.js, all assets served from /ocr — nothing leaves the device)
// ---------------------------------------------------------------------------

export async function ocr(image: Blob, onProgress: (fraction: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const base = new URL(import.meta.env.BASE_URL + 'ocr/', window.location.href).href;
  const worker = await createWorker('eng', 1, {
    workerPath: base + 'worker.min.js',
    corePath: base,
    langPath: base,
    gzip: true,
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
