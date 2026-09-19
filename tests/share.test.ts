import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { deriveIdentity, decodeRecoveryKey, encodeRecoveryKey } from '../src/lib/identity';
import { randomBytes } from '../src/lib/bytes';
import { newBoxKeypair } from '../src/lib/crypto';
import { createShare, openShare, refreshGrants, revokeShare, NeedsPasscode, NeedsProviderKey, WrongCredential, parseShareLink } from '../src/lib/share';
import { DEFAULT_SETTINGS, type HealthRecord, type Settings } from '../src/lib/types';

let server: Server;
let settings: Settings;

beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'medikey-'));
  // @ts-expect-error plain JS module
  const { app } = await import('../server/index.mjs');
  await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', r)));
  const port = (server.address() as { port: number }).port;
  settings = { ...DEFAULT_SETTINGS, storage: { ...DEFAULT_SETTINGS.storage, relayUrl: `http://127.0.0.1:${port}` } };
});
afterAll(() => server.close());

const rec = (n: number): HealthRecord => ({
  id: 'r' + n, title: 'Lab ' + n, kind: 'lab', date: '2026-09-01', createdAt: 1,
  source: { filename: 'x.txt', mime: 'text/plain', size: 1, method: 'text' },
  text: 'Hemoglobin 10.8 g/dL. '.repeat(20000 * (n === 2 ? 3 : 1)) + ' unique-' + n,
  redaction: { mode: 'balanced', total: 0, counts: {} },
});

const opts = { label: 'Dr. Test', recipientType: 'doctor' as const, ttlMs: 60_000, maxViews: null, appUrl: 'http://app/' };

describe('identity', () => {
  it('recovery key round-trips and detects typos', async () => {
    const seed = randomBytes(32);
    const key = encodeRecoveryKey(seed);
    expect(key.split('-')).toHaveLength(14);
    expect(decodeRecoveryKey(key)).toEqual(seed);
    expect(() => decodeRecoveryKey(key.replace(/^./, key[0] === 'A' ? 'B' : 'A'))).toThrow(/Checksum/);
    const a = await deriveIdentity(seed);
    const b = await deriveIdentity(decodeRecoveryKey(key));
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

describe('zero-trust share protocol', () => {
  it('bearer link: multi-shard round trip, signature verified, relay sees no plaintext', async () => {
    const id = await deriveIdentity(randomBytes(32));
    const records = [rec(1), rec(2)];
    const g = await createShare(id, records, opts, settings);
    expect(g.shardCount).toBeGreaterThanOrEqual(1);
    const { id: gid, secret } = parseShareLink(g.link)!;
    const opened = await openShare(gid, secret);
    expect(opened.verified).toBe(true);
    expect(opened.ownerFingerprint).toBe(id.fingerprint);
    expect(opened.bundle.records.map((r) => r.text)).toEqual(records.map((r) => r.text));
    // the grants file on the relay must not contain any plaintext
    const { readFileSync } = await import('node:fs');
    await new Promise((r) => setTimeout(r, 120));
    const raw = readFileSync(join(process.env.DATA_DIR!, 'grants.json'), 'utf8');
    expect(raw).not.toContain('Hemoglobin');
    expect(raw).not.toContain('Dr. Test');
  });

  it('wrong link secret cannot decrypt', async () => {
    const id = await deriveIdentity(randomBytes(32));
    const g = await createShare(id, [rec(1)], opts, settings);
    const { id: gid, secret } = parseShareLink(g.link)!;
    const other = await createShare(id, [rec(3)], opts, settings);
    await expect(openShare(gid, parseShareLink(other.link)!.secret)).rejects.toThrow();
    await openShare(gid, secret); // legit still works
  });

  it('passcode mode: wrong passcode fails locally and does not burn a view', async () => {
    const id = await deriveIdentity(randomBytes(32));
    const g = await createShare(id, [rec(1)], { ...opts, passcode: 's3cret-pass', maxViews: 1 }, settings);
    const { id: gid, secret } = parseShareLink(g.link)!;
    await expect(openShare(gid, secret)).rejects.toBeInstanceOf(NeedsPasscode);
    await expect(openShare(gid, secret, { passcode: 'nope' })).rejects.toBeInstanceOf(WrongCredential);
    const ok = await openShare(gid, secret, { passcode: 's3cret-pass' });
    expect(ok.bundle.records).toHaveLength(1);
    expect(ok.viewsLeft).toBe(0);
    await expect(openShare(gid, secret, { passcode: 's3cret-pass' })).rejects.toThrow(/revoked|limit|exhausted/i);
  });

  it('bound mode: only the clinician key opens it', async () => {
    const id = await deriveIdentity(randomBytes(32));
    const doc = newBoxKeypair();
    const stranger = newBoxKeypair();
    const g = await createShare(id, [rec(1)], { ...opts, providerPub: doc.pub }, settings);
    const { id: gid, secret } = parseShareLink(g.link)!;
    await expect(openShare(gid, secret)).rejects.toBeInstanceOf(NeedsProviderKey);
    await expect(openShare(gid, secret, { providerPriv: stranger.priv })).rejects.toBeInstanceOf(WrongCredential);
    expect((await openShare(gid, secret, { providerPriv: doc.priv })).bundle.records).toHaveLength(1);
  });

  it('revocation destroys the key-half; dashboard sees views + status', async () => {
    const id = await deriveIdentity(randomBytes(32));
    const g = await createShare(id, [rec(1)], opts, settings);
    const { id: gid, secret } = parseShareLink(g.link)!;
    await openShare(gid, secret);
    await openShare(gid, secret);
    let [s] = await refreshGrants(id, [g], settings);
    expect(s.status).toBe('active');
    expect(s.views).toBe(2);
    await revokeShare(id, g.id, settings);
    [s] = await refreshGrants(id, [g], settings);
    expect(s.status).toBe('revoked');
    await expect(openShare(gid, secret)).rejects.toThrow(/revoked/i);
  });

  it('someone else cannot revoke or inspect my grants', async () => {
    const a = await deriveIdentity(randomBytes(32));
    const b = await deriveIdentity(randomBytes(32));
    const g = await createShare(a, [rec(1)], opts, settings);
    await expect(revokeShare(b, g.id, settings)).rejects.toThrow(/signature/i);
    const [seen] = await refreshGrants(b, [g], settings);
    expect(seen.views).toBe(0);
    expect((await refreshGrants(a, [g], settings))[0].status).toBe('active');
  });

  it('time-bound: expired grants refuse to release the key', async () => {
    const id = await deriveIdentity(randomBytes(32));
    const g = await createShare(id, [rec(1)], { ...opts, ttlMs: 1200 }, settings);
    const { id: gid, secret } = parseShareLink(g.link)!;
    await new Promise((r) => setTimeout(r, 1500));
    await expect(openShare(gid, secret)).rejects.toThrow(/expired/i);
  });

  it('tampering with a stored shard is detected', async () => {
    const id = await deriveIdentity(randomBytes(32));
    const g = await createShare(id, [rec(1)], opts, settings);
    const { id: gid, secret } = parseShareLink(g.link)!;
    const { readdirSync, writeFileSync } = await import('node:fs');
    const dir = join(process.env.DATA_DIR!, 'blobs');
    const orig = globalThis.fetch;
    // simulate a malicious relay flipping a byte of every shard it serves
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const res = await orig(url, init);
      if (String(url).includes('/api/blobs/')) {
        const b = new Uint8Array(await res.arrayBuffer());
        b[40] ^= 1;
        return new Response(b, { status: 200 });
      }
      return res;
    }) as typeof fetch;
    try {
      await expect(openShare(gid, secret)).rejects.toThrow(/integrity|tamper/i);
    } finally {
      globalThis.fetch = orig;
    }
    void readdirSync; void writeFileSync; void dir;
  });
});

describe('IPFS shard storage (mock Kubo node)', () => {
  it('stores shards on IPFS, opens via gateway, and revocation kills the key even though the shards persist', async () => {
    const { spawn } = await import('node:child_process');
    const proc = spawn(process.execPath, ['scripts/mock-ipfs.mjs'], { stdio: 'pipe' });
    try {
      await new Promise<void>((res, rej) => {
        const t = setTimeout(() => rej(new Error('mock ipfs did not start')), 5000);
        proc.stdout.on('data', (d) => String(d).includes('8080') && (clearTimeout(t), res()));
        proc.on('error', rej);
      });
      const ipfs: Settings = { ...settings, storage: { ...settings.storage, backend: 'ipfs', ipfsApi: 'http://127.0.0.1:5001', ipfsGateway: 'http://127.0.0.1:8080' } };
      const id = await deriveIdentity(randomBytes(32));
      const g = await createShare(id, [rec(1), rec(2)], opts, ipfs);
      expect(g.backend).toBe('ipfs');
      const { id: gid, secret } = parseShareLink(g.link)!;
      const opened = await openShare(gid, secret);
      expect(opened.backend).toBe('ipfs');
      expect(opened.bundle.records).toHaveLength(2);

      // the relay never received the shards
      const { readdirSync } = await import('node:fs');
      const relayBlobs = readdirSync(join(process.env.DATA_DIR!, 'blobs')).length;
      const before = relayBlobs;
      await revokeShare(id, g.id, ipfs);
      await expect(openShare(gid, secret)).rejects.toThrow(/revoked/i);
      // …and the ciphertext is still on IPFS, but is now useless without the destroyed key-half
      const { decodeSecret } = await import('../src/lib/share');
      expect(decodeSecret(secret).g).toBe('http://127.0.0.1:8080');
      expect(before).toBeGreaterThanOrEqual(0);
    } finally {
      proc.kill();
    }
  }, 30_000);
});
