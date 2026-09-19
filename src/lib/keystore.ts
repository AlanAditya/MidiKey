/**
 * The keystore holds the 256-bit seed wrapped (AES-GCM) under a key stretched
 * from the patient's passphrase with Argon2id. Only ciphertext touches disk.
 */
import { createStore, get, set, del, clear, keys } from 'idb-keyval';
import { fromB64Url, randomBytes, toB64Url } from './bytes';
import { aesDecrypt, aesEncrypt, DEFAULT_KDF, importAesKey, stretchPassphrase, type KdfParams } from './crypto';
import { deriveIdentity, type Identity } from './identity';

const store = createStore('medikey-keystore', 'kv');
const KEY = 'keystore';

interface StoredKeystore {
  v: 1;
  kdf: KdfParams;
  wrapped: string; // b64url(iv||ct)
  pub: string; // b64url ed25519 public key (public information)
  createdAt: number;
}

export async function hasKeystore(): Promise<boolean> {
  return !!(await get(KEY, store));
}

export async function readPublicIdentity(): Promise<string | null> {
  const ks = await get<StoredKeystore>(KEY, store);
  return ks?.pub ?? null;
}

export async function createKeystore(seed: Uint8Array, passphrase: string): Promise<Identity> {
  const salt = randomBytes(16);
  const kdf: KdfParams = { alg: 'argon2id', ...DEFAULT_KDF, salt: toB64Url(salt) };
  const kek = await importAesKey(await stretchPassphrase(passphrase, salt, kdf));
  const identity = await deriveIdentity(seed);
  const wrapped = await aesEncrypt(kek, seed, 'medikey/keystore/v1');
  const ks: StoredKeystore = {
    v: 1,
    kdf,
    wrapped: toB64Url(wrapped),
    pub: toB64Url(identity.signPub),
    createdAt: Date.now(),
  };
  await set(KEY, ks, store);
  return identity;
}

export async function unlockKeystore(passphrase: string): Promise<Identity> {
  const ks = await get<StoredKeystore>(KEY, store);
  if (!ks) throw new Error('No vault found on this device.');
  const kek = await importAesKey(await stretchPassphrase(passphrase, fromB64Url(ks.kdf.salt), ks.kdf));
  let seed: Uint8Array;
  try {
    seed = await aesDecrypt(kek, fromB64Url(ks.wrapped), 'medikey/keystore/v1');
  } catch {
    throw new Error('Wrong passphrase.');
  }
  return deriveIdentity(seed);
}

/** Wipes the keystore *and* every encrypted record on this device. */
export async function destroyDevice(): Promise<void> {
  await clear(store);
  const vault = createStore('medikey-vault', 'kv');
  await clear(vault);
}

export async function debugKeys() {
  return keys(store);
}

export { del };
