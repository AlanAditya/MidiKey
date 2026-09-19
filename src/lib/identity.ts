/**
 * Identity = a single 256-bit seed that never leaves the device unencrypted.
 * From it we deterministically derive:
 *   - vaultKey  : AES-256-GCM key that encrypts every local record
 *   - signing   : Ed25519 keypair that authenticates share manifests / revocations
 * The seed is also the "recovery key" the patient writes down.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { fromBase32, toBase32, toHex, fromB64Url, toB64Url } from './bytes';
import { hkdf, importAesKey, sha256 } from './crypto';

export interface Identity {
  vaultKey: CryptoKey;
  signPriv: Uint8Array;
  signPub: Uint8Array;
  fingerprint: string;
  seed: Uint8Array;
}

export async function deriveIdentity(seed: Uint8Array): Promise<Identity> {
  if (seed.length !== 32) throw new Error('Seed must be 32 bytes');
  const vaultKey = await importAesKey(hkdf(seed, 'medikey/vault-key/v1'), false);
  const signPriv = hkdf(seed, 'medikey/ed25519/v1');
  const signPub = ed25519.getPublicKey(signPriv);
  return { vaultKey, signPriv, signPub, fingerprint: fingerprintOf(signPub), seed };
}

export function fingerprintOf(pub: Uint8Array): string {
  const s = toBase32(sha256(pub).subarray(0, 10)); // 16 chars
  return 'MK-' + s.match(/.{4}/g)!.join('-');
}

export function sign(id: Identity, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, id.signPriv);
}

export function verify(pub: Uint8Array, message: Uint8Array, sig: Uint8Array): boolean {
  try {
    return ed25519.verify(sig, message, pub);
  } catch {
    return false;
  }
}

export const pubToString = toB64Url;
export const pubFromString = fromB64Url;
export const pubHex = toHex;

// ----- Recovery key: base32(seed) + 4-char checksum, grouped in fours -----

export function encodeRecoveryKey(seed: Uint8Array): string {
  const body = toBase32(seed);
  const check = toBase32(sha256(seed)).slice(0, 4);
  return (body + check).match(/.{1,4}/g)!.join('-');
}

export function decodeRecoveryKey(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (clean.length !== 56) throw new Error('A recovery key has 56 characters (14 groups of 4).');
  const seed = fromBase32(clean.slice(0, 52)).slice(0, 32);
  if (toBase32(sha256(seed)).slice(0, 4) !== clean.slice(52)) {
    throw new Error('Checksum mismatch — check the recovery key for typos.');
  }
  return seed;
}
