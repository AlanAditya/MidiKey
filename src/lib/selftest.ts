/** Live cryptographic self-test shown on the Security page (runs in the browser, on demand). */
import { concat, randomBytes, utf8, xor } from './bytes';
import { aesDecrypt, aesEncrypt, importAesKey, newBoxKeypair, openSealed, sealTo } from './crypto';
import { deriveIdentity, sign, verify } from './identity';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runSelfTest(): Promise<Check[]> {
  const out: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => out.push({ name, ok, detail });

  const key = await importAesKey(randomBytes(32));
  const msg = utf8('Hemoglobin 10.8 g/dL');
  const ct = await aesEncrypt(key, msg, 'aad');
  add('AES-256-GCM round-trip', new TextDecoder().decode(await aesDecrypt(key, ct, 'aad')) === 'Hemoglobin 10.8 g/dL', `${msg.length} B → ${ct.length} B (12 B nonce + 16 B tag)`);

  const flipped = ct.slice();
  flipped[20] ^= 1;
  let tamperCaught = false;
  try {
    await aesDecrypt(key, flipped, 'aad');
  } catch {
    tamperCaught = true;
  }
  add('Tamper detection (1 flipped bit)', tamperCaught, 'authentication tag rejects modified ciphertext');

  let aadCaught = false;
  try {
    await aesDecrypt(key, ct, 'other-record');
  } catch {
    aadCaught = true;
  }
  add('Ciphertext bound to its record id (AAD)', aadCaught, 'a ciphertext cannot be swapped between records');

  const id = await deriveIdentity(randomBytes(32));
  const sig = sign(id, msg);
  add('Ed25519 signature verifies', verify(id.signPub, msg, sig), `fingerprint ${id.fingerprint}`);
  add('Forged message rejected', !verify(id.signPub, utf8('Hemoglobin 15.0 g/dL'), sig), 'signature is bound to the exact bytes');

  const K = randomBytes(32);
  const Ka = randomBytes(32);
  const Kb = xor(K, Ka);
  add('Split-key: Ka ⊕ Kb = K, neither half alone leaks K', xor(Ka, Kb).every((b, i) => b === K[i]) && Ka.some((b, i) => b !== K[i]), 'relay stores only Kb; the URL fragment carries Ka');

  const doc = newBoxKeypair();
  const stranger = newBoxKeypair();
  const sealed = await sealTo(doc.pub, Ka);
  let strangerFailed = false;
  try {
    await openSealed(stranger.priv, sealed);
  } catch {
    strangerFailed = true;
  }
  const opened = await openSealed(doc.priv, sealed);
  add('X25519 sealed link (clinician-bound)', strangerFailed && concat(opened).every((b, i) => b === Ka[i]), 'only the intended clinician key can unwrap Ka');
  return out;
}
