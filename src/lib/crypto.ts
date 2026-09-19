/**
 * Cryptographic primitives. Everything here runs in the browser.
 *  - Bulk encryption: AES-256-GCM (WebCrypto, non-extractable keys where possible)
 *  - KDFs:            HKDF-SHA256, Argon2id (memory-hard, passphrase stretching)
 *  - Sealing:         X25519 ECDH + HKDF + AES-GCM (ECIES-style) for provider-bound links
 *  - Signatures:      Ed25519 (see identity.ts)
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf as nobleHkdf } from '@noble/hashes/hkdf.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { concat, randomBytes, utf8 } from './bytes';

const IV_LEN = 12;

export const sha256 = (b: Uint8Array): Uint8Array => nobleSha256(b);

export function hkdf(ikm: Uint8Array, info: string, len = 32, salt?: Uint8Array): Uint8Array {
  return nobleHkdf(nobleSha256, ikm, salt, utf8(info), len);
}

const buf = (b: Uint8Array) => b as unknown as BufferSource;

export async function importAesKey(raw: Uint8Array, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buf(raw), 'AES-GCM', extractable, ['encrypt', 'decrypt']);
}

/** Returns iv(12) || ciphertext||tag. */
export async function aesEncrypt(key: CryptoKey, plaintext: Uint8Array, aad?: string): Promise<Uint8Array> {
  const iv = randomBytes(IV_LEN);
  const params: AesGcmParams = { name: 'AES-GCM', iv: buf(iv) };
  if (aad) params.additionalData = buf(utf8(aad));
  const ct = new Uint8Array(await crypto.subtle.encrypt(params, key, buf(plaintext)));
  return concat(iv, ct);
}

export async function aesDecrypt(key: CryptoKey, blob: Uint8Array, aad?: string): Promise<Uint8Array> {
  if (blob.length < IV_LEN + 16) throw new Error('Ciphertext too short');
  const params: AesGcmParams = { name: 'AES-GCM', iv: buf(blob.subarray(0, IV_LEN)) };
  if (aad) params.additionalData = buf(utf8(aad));
  try {
    return new Uint8Array(await crypto.subtle.decrypt(params, key, buf(blob.subarray(IV_LEN))));
  } catch {
    throw new Error('Decryption failed: wrong key or tampered data');
  }
}

export interface KdfParams {
  alg: 'argon2id';
  t: number;
  m: number; // KiB
  p: number;
  salt: string; // b64url
}

export const DEFAULT_KDF = { t: 3, m: 64 * 1024, p: 1 } as const;

export async function stretchPassphrase(
  passphrase: string,
  salt: Uint8Array,
  params: { t: number; m: number; p: number } = DEFAULT_KDF,
): Promise<Uint8Array> {
  return argon2idAsync(utf8(passphrase.normalize('NFKC')), salt, { ...params, dkLen: 32, asyncTick: 20 });
}

// ---------- ECIES-style sealing to an X25519 public key ----------

export function newBoxKeypair(): { priv: Uint8Array; pub: Uint8Array } {
  const priv = x25519.utils.randomSecretKey();
  return { priv, pub: x25519.getPublicKey(priv) };
}

/** Output: ephPub(32) || iv(12) || ct */
export async function sealTo(recipientPub: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const eph = newBoxKeypair();
  const shared = x25519.getSharedSecret(eph.priv, recipientPub);
  const key = await importAesKey(hkdf(shared, 'medikey/seal/v1', 32, concat(eph.pub, recipientPub)));
  return concat(eph.pub, await aesEncrypt(key, plaintext));
}

export async function openSealed(recipientPriv: Uint8Array, sealed: Uint8Array): Promise<Uint8Array> {
  const ephPub = sealed.subarray(0, 32);
  const recipientPub = x25519.getPublicKey(recipientPriv);
  const shared = x25519.getSharedSecret(recipientPriv, ephPub);
  const key = await importAesKey(hkdf(shared, 'medikey/seal/v1', 32, concat(ephPub, recipientPub)));
  return aesDecrypt(key, sealed.subarray(32));
}

/** Constant-time-ish equality for short secrets. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
