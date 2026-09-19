/**
 * Zero-trust sharing protocol
 * ===========================
 *  Patient (browser)                                 Blind relay                     Provider (browser)
 *  ─────────────────                                 ───────────                     ──────────────────
 *  K  = random 256-bit grant key
 *  Ka = random 256-bit ("link half")   ── URL #fragment only, never sent to any server ──▶  Ka
 *  Kb = K XOR Ka                        ───────────▶  stores Kb (deleted on expiry/revoke)
 *  bundle → gzip → 192 KiB chunks → AES-256-GCM(K, aad = id:index:total) → shards
 *  shards ─────────────────────────────▶ relay blob store  or  IPFS (content addressed)
 *  manifest {id, Kb, expiry, shard hashes} signed with the patient's Ed25519 key ───────▶  verify signature
 *                                                                                          K = Ka XOR Kb
 *                                                                                          fetch + verify + decrypt shards
 *
 *  Link modes:  bearer (Ka in link)  |  passcode (Ka wrapped with Argon2id(passcode))
 *               bound  (Ka sealed to the clinician's X25519 key — the link alone is useless)
 */
import { concat, fromB64Url, fromUtf8, randomBytes, toB64Url, utf8, xor, canonical } from './bytes';
import { aesDecrypt, aesEncrypt, importAesKey, openSealed, sealTo, stretchPassphrase } from './crypto';
import { fingerprintOf, sign, verify, type Identity } from './identity';
import { fetchShard, makeBlobStore } from './blobstore';
import { makeRelay, relayBase, RelayError, type GrantBody, type Relay, type ShardRef } from './relay';
import type { GrantRecord, HealthRecord, Settings } from './types';

export const SHARD_PLAINTEXT = 192 * 1024;
const SHARE_KDF = { t: 2, m: 32 * 1024, p: 1 } as const;

// ---------------------------------------------------------------- compression
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
const gzip = (b: Uint8Array) => pipe(b, new CompressionStream('gzip'));
const gunzip = (b: Uint8Array) => pipe(b, new DecompressionStream('gzip'));

// ---------------------------------------------------------------- types
export type BundleRecord = Pick<HealthRecord, 'id' | 'title' | 'kind' | 'date' | 'text' | 'redaction' | 'vitals'>;

export interface ShareBundle {
  v: 1;
  grantId: string;
  createdAt: number;
  expiresAt: number;
  recipient: { label: string; type: GrantRecord['recipientType'] };
  note?: string;
  patient: { fingerprint: string };
  records: BundleRecord[];
}

export interface LinkSecret {
  v: 1;
  m: 'bearer' | 'passcode' | 'bound';
  /** bearer: Ka · passcode: iv||AES(Ka) · bound: sealed(Ka) — all b64url */
  ka: string;
  salt?: string;
  /** relay base URL, if not same-origin */
  r?: string;
  /** IPFS gateway, if shards live on IPFS */
  g?: string;
}

export const encodeSecret = (s: LinkSecret) => toB64Url(utf8(JSON.stringify(s)));
export function decodeSecret(str: string): LinkSecret {
  try {
    const s = JSON.parse(fromUtf8(fromB64Url(str))) as LinkSecret;
    if (s.v !== 1 || !s.ka || !['bearer', 'passcode', 'bound'].includes(s.m)) throw new Error();
    return s;
  } catch {
    throw new Error('This link is incomplete or damaged (the secret part after the last "/" is missing).');
  }
}

export function parseShareLink(input: string): { id: string; secret: string } | null {
  const m = input.trim().match(/#?\/?p\/([A-Za-z0-9_-]{16,32})\/([A-Za-z0-9_-]+)\s*$/);
  return m ? { id: m[1], secret: m[2] } : null;
}

export class NeedsPasscode extends Error {
  constructor() {
    super('This link is protected with a passcode.');
  }
}
export class NeedsProviderKey extends Error {
  constructor() {
    super('This link is bound to a specific clinician key.');
  }
}
export class WrongCredential extends Error {}

// ---------------------------------------------------------------- creating a share
export interface ShareOptions {
  label: string;
  recipientType: GrantRecord['recipientType'];
  ttlMs: number;
  maxViews: number | null;
  passcode?: string;
  /** clinician's X25519 public key (from the Provider Portal) */
  providerPub?: Uint8Array;
  note?: string;
  appUrl?: string;
}

export async function createShare(
  identity: Identity,
  records: HealthRecord[],
  opts: ShareOptions,
  settings: Settings,
  onProgress: (msg: string) => void = () => {},
): Promise<GrantRecord> {
  if (!records.length) throw new Error('Select at least one record to share.');
  const base = relayBase(settings.storage.relayUrl);
  const relay = makeRelay(base);
  const store = makeBlobStore(settings.storage, relay);

  const id = toB64Url(randomBytes(16));
  const now = Date.now();
  const expiresAt = now + opts.ttlMs;

  const K = randomBytes(32);
  const Ka = randomBytes(32);
  const Kb = xor(K, Ka);
  const key = await importAesKey(K);

  onProgress('Bundling & compressing records…');
  const bundle: ShareBundle = {
    v: 1,
    grantId: id,
    createdAt: now,
    expiresAt,
    recipient: { label: opts.label, type: opts.recipientType },
    note: opts.note?.trim() || undefined,
    patient: { fingerprint: identity.fingerprint },
    records: records.map(({ id, title, kind, date, text, redaction, vitals }) => ({ id, title, kind, date, text, redaction, vitals })),
  };
  const packed = await gzip(utf8(JSON.stringify(bundle)));

  onProgress('Encrypting shards (AES-256-GCM)…');
  const total = Math.max(1, Math.ceil(packed.length / SHARD_PLAINTEXT));
  const shards: ShardRef[] = [];
  let totalBytes = 0;
  for (let i = 0; i < total; i++) {
    const chunk = packed.subarray(i * SHARD_PLAINTEXT, (i + 1) * SHARD_PLAINTEXT);
    const ct = await aesEncrypt(key, chunk, `${id}:${i}:${total}`);
    onProgress(`Uploading encrypted shard ${i + 1}/${total} to ${store.name === 'ipfs' ? 'IPFS' : 'relay'}…`);
    shards.push(await store.put(ct));
    totalBytes += ct.length;
  }

  // Link half — what the URL fragment carries
  const secret: LinkSecret = { v: 1, m: 'bearer', ka: toB64Url(Ka) };
  if (opts.providerPub) {
    secret.m = 'bound';
    secret.ka = toB64Url(await sealTo(opts.providerPub, Ka));
  } else if (opts.passcode) {
    const salt = randomBytes(16);
    const kek = await importAesKey(await stretchPassphrase(opts.passcode, salt, SHARE_KDF));
    secret.m = 'passcode';
    secret.salt = toB64Url(salt);
    secret.ka = toB64Url(await aesEncrypt(kek, Ka, `medikey/ka/${id}`));
  }
  if (base) secret.r = base;
  if (settings.storage.backend === 'ipfs') secret.g = settings.storage.ipfsGateway;

  onProgress('Signing manifest with your identity key…');
  const grant: GrantBody = {
    v: 1,
    id,
    ownerPub: toB64Url(identity.signPub),
    keyShare: toB64Url(Kb),
    createdAt: now,
    expiresAt,
    maxViews: opts.maxViews,
    shards,
    mode: secret.m,
  };
  const sig = toB64Url(sign(identity, utf8(canonical(grant))));
  onProgress('Registering time-bound grant…');
  await relay.createGrant(grant, sig);

  const appUrl = opts.appUrl ?? (typeof location !== 'undefined' ? location.origin + location.pathname : 'http://localhost/');
  return {
    id,
    label: opts.label,
    recipientType: opts.recipientType,
    createdAt: now,
    expiresAt,
    maxViews: opts.maxViews,
    recordIds: records.map((r) => r.id),
    link: `${appUrl}#/p/${id}/${encodeSecret(secret)}`,
    passcode: secret.m === 'passcode',
    boundToProvider: secret.m === 'bound',
    backend: store.name,
    shardCount: shards.length,
    bytes: totalBytes,
    status: 'active',
    views: 0,
    log: [{ t: now, event: 'created' }],
  };
}

// ---------------------------------------------------------------- owner: refresh & revoke
export async function refreshGrants(identity: Identity, grants: GrantRecord[], settings: Settings): Promise<GrantRecord[]> {
  const relay = makeRelay(relayBase(settings.storage.relayUrl));
  const ids = grants.map((g) => g.id);
  if (!ids.length) return grants;
  const info = await relay.inspect(identity, ids);
  return grants.map((g) => {
    const i = info[g.id];
    if (!i) return g;
    if (i.status === 'unknown') {
      // A still-"active" grant the relay has no record of can't be opened by anyone (no key half),
      // so show it as ended instead of a phantom live link that can't even be revoked.
      if (g.status === 'active' && g.expiresAt > Date.now()) return { ...g, status: 'revoked', log: [...(g.log ?? []), { t: Date.now(), event: 'missing-on-relay' }] };
      // otherwise the relay simply forgot it after its retention window — derive from the clock
      return { ...g, status: g.status === 'revoked' ? 'revoked' : g.expiresAt <= Date.now() ? 'expired' : g.status };
    }
    const status = i.status === 'exhausted' ? 'expired' : i.status;
    const last = [...i.log].reverse().find((e) => e.event === 'opened');
    return { ...g, status, views: i.views, lastViewedAt: last?.t ?? g.lastViewedAt, log: i.log };
  });
}

/**
 * Revoke on the relay. If the relay has no record of the grant (its data was reset, or it never
 * arrived) the link cannot be opened anyway — the key half doesn't exist — so that counts as
 * revoked rather than an error that leaves the grant stuck "active" forever.
 */
export async function revokeShare(identity: Identity, grantId: string, settings: Settings): Promise<{ alreadyGone: boolean }> {
  try {
    await makeRelay(relayBase(settings.storage.relayUrl)).revoke(identity, grantId);
    return { alreadyGone: false };
  } catch (e) {
    if (e instanceof RelayError && e.status === 404) return { alreadyGone: true };
    throw e;
  }
}

// ---------------------------------------------------------------- provider: opening a share
export interface OpenInput {
  passcode?: string;
  providerPriv?: Uint8Array;
}

/** Recovers Ka locally. Done *before* contacting the relay so wrong passcodes never burn a view. */
export async function unlockLinkHalf(id: string, secret: LinkSecret, input: OpenInput): Promise<Uint8Array> {
  const ka = fromB64Url(secret.ka);
  if (secret.m === 'bearer') return ka;
  if (secret.m === 'passcode') {
    if (!input.passcode) throw new NeedsPasscode();
    const kek = await importAesKey(await stretchPassphrase(input.passcode, fromB64Url(secret.salt ?? ''), SHARE_KDF));
    try {
      return await aesDecrypt(kek, ka, `medikey/ka/${id}`);
    } catch {
      throw new WrongCredential('Incorrect passcode.');
    }
  }
  if (!input.providerPriv) throw new NeedsProviderKey();
  try {
    return await openSealed(input.providerPriv, ka);
  } catch {
    throw new WrongCredential('This link was issued to a different clinician key.');
  }
}

export interface OpenedShare {
  bundle: ShareBundle;
  verified: boolean;
  ownerFingerprint: string;
  viewsLeft: number | null;
  viewsUsed: number;
  serverTime: number;
  expiresAt: number;
  backend: 'relay' | 'ipfs';
  mode: LinkSecret['m'];
  shardCount: number;
}

export async function openShare(id: string, secretStr: string, input: OpenInput = {}): Promise<OpenedShare> {
  const secret = decodeSecret(secretStr);
  const Ka = await unlockLinkHalf(id, secret, input);
  const relay: Relay = makeRelay(relayBase(secret.r));

  const res = await relay.open(id);
  const { grant, sig } = res;

  // 1. authenticity: the manifest must be signed by the key it names
  const ownerPub = fromB64Url(grant.ownerPub);
  const verified = verify(ownerPub, utf8(canonical(grant)), fromB64Url(sig));
  if (!verified) throw new Error('Signature check failed — this share was not created by the key it claims. Do not trust it.');
  if (grant.id !== id) throw new Error('Manifest does not match this link.');
  if (!grant.keyShare) throw new RelayError('This link has been revoked.', 410, 'revoked');

  // 2. reconstruct the key
  const K = xor(Ka, fromB64Url(grant.keyShare));
  const key = await importAesKey(K);

  // 3. fetch, verify, decrypt every shard
  const parts: Uint8Array[] = [];
  for (let i = 0; i < grant.shards.length; i++) {
    const ct = await fetchShard(grant.shards[i], relay, secret.g);
    parts.push(await aesDecrypt(key, ct, `${id}:${i}:${grant.shards.length}`));
  }
  const bundle = JSON.parse(fromUtf8(await gunzip(concat(...parts)))) as ShareBundle;
  if (bundle.grantId !== id) throw new Error('Bundle does not belong to this link.');

  return {
    bundle,
    verified,
    ownerFingerprint: fingerprintOf(ownerPub),
    viewsLeft: res.viewsLeft,
    viewsUsed: res.views,
    serverTime: res.serverTime,
    expiresAt: grant.expiresAt,
    backend: grant.shards[0]?.c ? 'ipfs' : 'relay',
    mode: secret.m,
    shardCount: grant.shards.length,
  };
}
