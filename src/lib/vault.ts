/**
 * Encrypted local vault (IndexedDB). Every value is AES-256-GCM ciphertext bound
 * to its own key name via AAD, so ciphertexts can't be swapped between records.
 * Only opaque ids and byte-lengths are visible to anyone inspecting storage.
 */
import { createStore, get, set, del, entries, clear } from 'idb-keyval';
import { fromB64Url, fromUtf8, toB64Url, utf8 } from './bytes';
import { aesDecrypt, aesEncrypt } from './crypto';
import type { Identity } from './identity';
import { DEFAULT_SETTINGS, type GrantRecord, type HealthRecord, type Settings } from './types';

const store = createStore('medikey-vault', 'kv');

type Collection = 'rec' | 'grant' | 'cfg';

async function putEnc(id: Identity, col: Collection, name: string, value: unknown): Promise<void> {
  const key = `${col}:${name}`;
  const ct = await aesEncrypt(id.vaultKey, utf8(JSON.stringify(value)), key);
  await set(key, toB64Url(ct), store);
}

async function getEnc<T>(id: Identity, col: Collection, name: string): Promise<T | undefined> {
  const key = `${col}:${name}`;
  const raw = await get<string>(key, store);
  if (!raw) return undefined;
  return JSON.parse(fromUtf8(await aesDecrypt(id.vaultKey, fromB64Url(raw), key))) as T;
}

async function allEnc<T>(id: Identity, col: Collection): Promise<T[]> {
  const out: T[] = [];
  for (const [k, raw] of await entries<string, string>(store)) {
    if (typeof k !== 'string' || !k.startsWith(col + ':')) continue;
    try {
      out.push(JSON.parse(fromUtf8(await aesDecrypt(id.vaultKey, fromB64Url(raw), k))) as T);
    } catch {
      console.warn('Skipping undecryptable entry', k);
    }
  }
  return out;
}

export const newId = (): string => toB64Url(crypto.getRandomValues(new Uint8Array(12)));

export const saveRecord = (id: Identity, r: HealthRecord) => putEnc(id, 'rec', r.id, r);
export const listRecords = async (id: Identity) =>
  (await allEnc<HealthRecord>(id, 'rec')).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.createdAt - a.createdAt);
export const deleteRecord = (_id: Identity, recId: string) => del(`rec:${recId}`, store);

export const saveGrant = (id: Identity, g: GrantRecord) => putEnc(id, 'grant', g.id, g);
export const listGrants = async (id: Identity) =>
  (await allEnc<GrantRecord>(id, 'grant')).sort((a, b) => b.createdAt - a.createdAt);
export const deleteGrant = (_id: Identity, gid: string) => del(`grant:${gid}`, store);

export async function loadSettings(id: Identity): Promise<Settings> {
  const s = await getEnc<Partial<Settings>>(id, 'cfg', 'settings');
  return { ...DEFAULT_SETTINGS, ...s, storage: { ...DEFAULT_SETTINGS.storage, ...s?.storage } };
}
export const saveSettings = (id: Identity, s: Settings) => putEnc(id, 'cfg', 'settings', s);

// ----- encrypted backup (.medikey file) -----

export async function exportBackup(id: Identity): Promise<Blob> {
  const payload = {
    v: 1,
    records: await allEnc<HealthRecord>(id, 'rec'),
    grants: await allEnc<GrantRecord>(id, 'grant'),
    settings: await loadSettings(id),
  };
  const ct = await aesEncrypt(id.vaultKey, utf8(JSON.stringify(payload)), 'medikey/backup/v1');
  const header = utf8('MEDIKEY1\n');
  return new Blob([header as BlobPart, ct as BlobPart], { type: 'application/octet-stream' });
}

export async function importBackup(id: Identity, file: File): Promise<{ records: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = utf8('MEDIKEY1\n');
  if (!header.every((b, i) => bytes[i] === b)) throw new Error('Not a MediKey backup file.');
  const json = fromUtf8(await aesDecrypt(id.vaultKey, bytes.subarray(header.length), 'medikey/backup/v1'));
  const p = JSON.parse(json) as { records: HealthRecord[]; grants: GrantRecord[]; settings: Settings };
  for (const r of p.records) await saveRecord(id, r);
  for (const g of p.grants) await saveGrant(id, g);
  if (p.settings) await saveSettings(id, p.settings);
  return { records: p.records.length };
}

export async function wipeVaultData(): Promise<void> {
  await clear(store);
}

/** For the Security page: show what an attacker with disk access would actually see. */
export async function rawSample(limit = 3): Promise<{ key: string; bytes: number; preview: string }[]> {
  const out: { key: string; bytes: number; preview: string }[] = [];
  for (const [k, v] of await entries<string, string>(store)) {
    if (typeof k !== 'string' || typeof v !== 'string') continue;
    out.push({ key: k.replace(/^(\w+:)(.{6}).*$/, '$1$2…'), bytes: Math.round((v.length * 3) / 4), preview: v.slice(0, 96) + '…' });
    if (out.length >= limit) break;
  }
  return out;
}
