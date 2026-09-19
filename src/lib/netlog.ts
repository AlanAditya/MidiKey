/**
 * Network transparency ledger. Wraps window.fetch and records every request the app
 * makes (method, host, path, bytes sent) so the Security page can prove that
 * plaintext never leaves the device — and show exactly what does.
 */
export interface NetEntry {
  id: number;
  t: number;
  method: string;
  origin: string;
  path: string;
  bytesOut: number;
  status: number | 'error';
  kind: 'relay' | 'ipfs' | 'app' | 'other';
}

let entries: NetEntry[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function classify(url: URL): NetEntry['kind'] {
  if (url.pathname.startsWith('/api/v0/') || url.pathname.startsWith('/ipfs/')) return 'ipfs';
  if (url.pathname.startsWith('/api/')) return 'relay';
  if (url.origin === window.location.origin) return 'app';
  return 'other';
}

function sizeOf(body: BodyInit | null | undefined): number {
  if (!body) return 0;
  if (typeof body === 'string') return new Blob([body]).size;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof FormData) {
    let n = 0;
    body.forEach((v) => (n += typeof v === 'string' ? v.length : v.size));
    return n;
  }
  return 0;
}

let installed = false;
export function installNetLog(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let url: URL;
    try {
      url = new URL(raw, window.location.href);
    } catch {
      return original(input, init);
    }
    const entry: NetEntry = {
      id: ++seq,
      t: Date.now(),
      method: (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase(),
      origin: url.origin,
      path: url.pathname.replace(/([A-Za-z0-9_-]{24,})/g, (m) => m.slice(0, 6) + '…'),
      bytesOut: sizeOf(init?.body),
      status: 'error',
      kind: classify(url),
    };
    try {
      const res = await original(input, init);
      entry.status = res.status;
      return res;
    } finally {
      entries = [entry, ...entries].slice(0, 200);
      listeners.forEach((l) => l());
    }
  };
}

export const getNetLog = () => entries;
export function subscribeNetLog(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function clearNetLog() {
  entries = [];
  listeners.forEach((l) => l());
}
