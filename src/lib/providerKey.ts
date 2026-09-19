/** A clinician's X25519 key pair, kept in this browser only. The public half ("MKP-…") is what a patient binds a link to. */
import { fromB64Url, toB64Url } from './bytes';
import { newBoxKeypair } from './crypto';

const KEY = 'medikey.provider';

export interface ProviderKey {
  name: string;
  priv: Uint8Array;
  pub: Uint8Array;
  createdAt: number;
}

export function providerId(pub: Uint8Array): string {
  return 'MKP-' + toB64Url(pub);
}

export function loadProviderKey(): ProviderKey | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { name: string; priv: string; pub: string; createdAt: number };
    return { name: j.name, priv: fromB64Url(j.priv), pub: fromB64Url(j.pub), createdAt: j.createdAt };
  } catch {
    return null;
  }
}

export function createProviderKey(name: string): ProviderKey {
  const kp = newBoxKeypair();
  const k: ProviderKey = { name: name.trim(), priv: kp.priv, pub: kp.pub, createdAt: Date.now() };
  localStorage.setItem(KEY, JSON.stringify({ name: k.name, priv: toB64Url(k.priv), pub: toB64Url(k.pub), createdAt: k.createdAt }));
  return k;
}

export function deleteProviderKey() {
  localStorage.removeItem(KEY);
}
