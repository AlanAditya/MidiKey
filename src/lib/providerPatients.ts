/**
 * The clinician's local patient list ("dashboard").
 *
 * What is stored, in THIS browser only:  the access link (id + link secret), a nickname the doctor
 * chose, and non-medical metadata (expiry, record count, patient key fingerprint, last-opened time).
 * What is NEVER stored: decrypted records, titles, notes, or any health content — those exist in
 * memory only while a link is open and are wiped on close/expiry.
 */
import { decodeSecret, type LinkSecret } from './share';

const KEY = 'medikey.provider.patients';

export interface ProviderPatient {
  id: string;
  secret: string;
  nickname: string;
  addedAt: number;
  mode: LinkSecret['m'];
  backend: 'relay' | 'ipfs';
  // metadata learned from status probes / opening the link (none of it is medical content)
  expiresAt?: number;
  patientFp?: string;
  recordCount?: number;
  lastOpenedAt?: number;
}

/** Finds every MediKey access link in pasted text (a full URL, "#/p/…", or several links at once). */
export function extractLinks(text: string): { id: string; secret: string }[] {
  const out: { id: string; secret: string }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/(?:^|[#\s/])p\/([A-Za-z0-9_-]{16,32})\/([A-Za-z0-9_-]{8,})/gm)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], secret: m[2] });
  }
  return out;
}

export function loadPatients(): ProviderPatient[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((p): p is ProviderPatient => !!p && typeof p.id === 'string' && typeof p.secret === 'string' && typeof p.nickname === 'string');
  } catch {
    return [];
  }
}

export function savePatients(list: ProviderPatient[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode / quota — the dashboard just won't persist */
  }
}

export interface AddResult {
  list: ProviderPatient[];
  found: number;
  added: number;
  duplicates: number;
  invalid: number;
}

/** Adds every link found in `text`. Duplicates (same link id) are skipped, damaged links counted. */
export function addLinks(list: ProviderPatient[], text: string, nickname?: string): AddResult {
  const links = extractLinks(text);
  const next = [...list];
  let added = 0;
  let duplicates = 0;
  let invalid = 0;
  for (const l of links) {
    if (next.some((p) => p.id === l.id)) {
      duplicates++;
      continue;
    }
    let s: LinkSecret;
    try {
      s = decodeSecret(l.secret);
    } catch {
      invalid++;
      continue;
    }
    const custom = links.length === 1 ? nickname?.trim() : '';
    next.unshift({
      id: l.id,
      secret: l.secret,
      nickname: custom || `Patient ${next.length + 1}`,
      addedAt: Date.now(),
      mode: s.m,
      backend: s.g ? 'ipfs' : 'relay',
    });
    added++;
  }
  return { list: next, found: links.length, added, duplicates, invalid };
}

/** Merge metadata into an existing patient (no-op if the link isn't on the dashboard). */
export function patchPatient(id: string, patch: Partial<ProviderPatient>): void {
  const list = loadPatients();
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], ...patch };
  savePatients(list);
}
