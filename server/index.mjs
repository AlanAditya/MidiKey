/**
 * MediKey Blind Relay
 * -------------------
 * A deliberately dumb, zero-knowledge server. It NEVER sees:
 *   - plaintext records, titles, names, or any PII
 *   - the link secret (lives in the URL #fragment, which browsers never send)
 *   - the full decryption key (it only holds one random XOR-half of it)
 * It stores:
 *   - encrypted, content-addressed shards            (useless without the key)
 *   - one 32-byte random key-half per share grant     (useless without the link secret)
 *   - an Ed25519-signed manifest                      (so providers can verify authorship)
 * Revocation / expiry = the key-half is deleted → the ciphertext becomes permanently
 * undecryptable, even if a shard was copied elsewhere (e.g. pinned to IPFS).
 */
import express from 'express';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(__dirname, '..', 'data'));
const DIST_DIR = resolve(join(__dirname, '..', 'dist'));
const MAX_TTL_MS = Number(process.env.MAX_TTL_DAYS ?? 30) * 86400000;
const MAX_SHARDS = 200;
const MAX_SHARD_BYTES = 600 * 1024;
const MAX_STORE_BYTES = Number(process.env.MAX_STORE_MB ?? 512) * 1024 * 1024;
const BLOB_DIR = join(DATA_DIR, 'blobs');
const DB_FILE = join(DATA_DIR, 'grants.json');

mkdirSync(BLOB_DIR, { recursive: true });

// ---------------------------------------------------------------- helpers
const b64u = {
  dec: (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
  enc: (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
};
const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');

/** Must match src/lib/bytes.ts canonical() — sorted keys, no whitespace, undefined dropped. */
function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
      .join(',') +
    '}'
  );
}

function verifySig(pubB64, message, sigB64) {
  try {
    return ed25519.verify(b64u.dec(sigB64), new TextEncoder().encode(message), b64u.dec(pubB64));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- persistence
/** @type {{ grants: Record<string, any> }} */
let db = { grants: {} };
if (existsSync(DB_FILE)) {
  try {
    db = JSON.parse(readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('Could not read grants.json, starting empty:', e.message);
  }
}
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DB_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, DB_FILE);
  }, 50);
}

function blobPath(h) {
  return join(BLOB_DIR, h);
}

const RETIRE_GRACE_MS = 2 * 60_000; // lets the final permitted viewer finish downloading shards

function referencedBlobs(active) {
  const set = new Set();
  const now = Date.now();
  for (const g of Object.values(db.grants)) {
    const isActive = g.status === 'active';
    if (active ? !isActive : isActive || now - (g.retiredAt ?? 0) < RETIRE_GRACE_MS) continue;
    for (const s of g.grant.shards) set.add(s.h);
  }
  return set;
}

/**
 * Delete shards whose grant is over. Shards not yet claimed by any grant are kept for 10 minutes
 * (clients upload shards first, then register the grant).
 */
function gcBlobs() {
  // Self-heal if the blob directory was removed out from under a live process (bad volume mount,
  // manual cleanup, …) instead of throwing ENOENT — this runs on a background timer, so an
  // unhandled error here would otherwise crash the whole relay for every active share link.
  if (!existsSync(BLOB_DIR)) mkdirSync(BLOB_DIR, { recursive: true });
  const live = referencedBlobs(true);
  const dead = referencedBlobs(false);
  for (const g of Object.values(db.grants)) if (g.status !== 'active' && Date.now() - (g.retiredAt ?? 0) < RETIRE_GRACE_MS) for (const s of g.grant.shards) live.add(s.h);
  const now = Date.now();
  for (const f of readdirSync(BLOB_DIR)) {
    if (live.has(f)) continue;
    const orphanExpired = now - statSync(join(BLOB_DIR, f)).mtimeMs > 10 * 60_000;
    if (dead.has(f) || orphanExpired) rmSync(join(BLOB_DIR, f), { force: true });
  }
}

function storeSize() {
  let n = 0;
  for (const f of readdirSync(BLOB_DIR)) n += statSync(join(BLOB_DIR, f)).size;
  return n;
}

function retire(g, status) {
  g.status = status;
  g.retiredAt = Date.now();
  g.grant.keyShare = null; // ← the cryptographic kill-switch
  g.log.push({ t: Date.now(), event: status });
}

function sweep() {
  const now = Date.now();
  let changed = false;
  for (const [id, g] of Object.entries(db.grants)) {
    if (g.status === 'active' && g.grant.expiresAt <= now) {
      retire(g, 'expired');
      changed = true;
    }
    if (g.status !== 'active' && now - g.grant.expiresAt > 30 * 86400000 && now - (g.log.at(-1)?.t ?? 0) > 30 * 86400000) {
      delete db.grants[id];
      changed = true;
    }
  }
  if (changed) save();
  gcBlobs();
}
/** Never let periodic maintenance take the whole relay down — log and keep serving requests instead. */
function safeSweep() {
  try {
    sweep();
  } catch (e) {
    console.error('sweep() failed (relay keeps running):', e);
  }
}
setInterval(safeSweep, 30_000).unref();
safeSweep();

// ---------------------------------------------------------------- tiny rate limiter
const buckets = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path.split('/').slice(0, 3).join('/');
    const now = Date.now();
    const b = buckets.get(key) ?? { n: 0, reset: now + windowMs };
    if (now > b.reset) {
      b.n = 0;
      b.reset = now + windowMs;
    }
    b.n++;
    buckets.set(key, b);
    if (b.n > max) return res.status(429).json({ error: 'Too many requests' });
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60_000).unref();

// ---------------------------------------------------------------- app
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*'); // no cookies/credentials are ever used
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  } else {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        // relay (same origin) + a local IPFS node/gateway; set CONNECT_SRC_EXTRA to allow a remote gateway
        `connect-src 'self' http://127.0.0.1:* http://localhost:* ${process.env.CONNECT_SRC_EXTRA ?? ''}`.trim(),
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
  }
  next();
});

app.get('/api/health', (_req, res) => {
  const active = Object.values(db.grants).filter((g) => g.status === 'active').length;
  res.json({ ok: true, service: 'medikey-blind-relay', version: 1, activeGrants: active, time: Date.now() });
});

// ---- encrypted shards (content addressed)
app.put('/api/blobs/:hash', rateLimit(600, 60_000), express.raw({ type: () => true, limit: MAX_SHARD_BYTES }), (req, res) => {
  const { hash } = req.params;
  if (!/^[0-9a-f]{64}$/.test(hash)) return res.status(400).json({ error: 'hash must be 64 hex chars' });
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length < 28) return res.status(400).json({ error: 'empty or too-small body' });
  if (sha256hex(body) !== hash) return res.status(400).json({ error: 'body does not match content hash' });
  if (!existsSync(blobPath(hash))) {
    if (storeSize() + body.length > MAX_STORE_BYTES) return res.status(507).json({ error: 'relay storage full' });
    writeFileSync(blobPath(hash), body);
  }
  res.status(201).json({ ok: true, hash, bytes: body.length });
});

app.get('/api/blobs/:hash', rateLimit(1200, 60_000), (req, res) => {
  const { hash } = req.params;
  if (!/^[0-9a-f]{64}$/.test(hash) || !existsSync(blobPath(hash))) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(readFileSync(blobPath(hash)));
});

// ---- grants
app.post('/api/grants', rateLimit(60, 60_000), express.json({ limit: '64kb' }), (req, res) => {
  const { grant, sig } = req.body ?? {};
  if (!grant || typeof sig !== 'string') return res.status(400).json({ error: 'grant and sig required' });
  const now = Date.now();
  const problems = [];
  if (grant.v !== 1) problems.push('unsupported version');
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(grant.id ?? '')) problems.push('bad id');
  if (!/^[A-Za-z0-9_-]{43}$/.test(grant.ownerPub ?? '')) problems.push('bad ownerPub');
  if (!/^[A-Za-z0-9_-]{43}$/.test(grant.keyShare ?? '')) problems.push('bad keyShare');
  if (!(grant.expiresAt > now && grant.expiresAt <= now + MAX_TTL_MS)) problems.push(`expiresAt must be within ${MAX_TTL_MS / 86400000} days`);
  if (grant.maxViews != null && !(Number.isInteger(grant.maxViews) && grant.maxViews > 0 && grant.maxViews <= 1000)) problems.push('bad maxViews');
  if (!Array.isArray(grant.shards) || grant.shards.length < 1 || grant.shards.length > MAX_SHARDS) problems.push('bad shards');
  else
    for (const s of grant.shards) {
      if (!/^[0-9a-f]{64}$/.test(s.h ?? '')) problems.push('bad shard hash');
      else if (!s.c && !existsSync(blobPath(s.h))) problems.push(`shard ${s.h.slice(0, 8)}… not uploaded`);
    }
  if (problems.length) return res.status(400).json({ error: problems.join('; ') });
  if (!verifySig(grant.ownerPub, canonical(grant), sig)) return res.status(401).json({ error: 'invalid signature' });
  if (db.grants[grant.id]) return res.status(409).json({ error: 'grant id already exists' });

  db.grants[grant.id] = { grant, sig, status: 'active', views: 0, log: [{ t: now, event: 'created' }] };
  save();
  res.status(201).json({ ok: true, id: grant.id });
});

/** Public, non-counting status probe (no key material). */
app.get('/api/grants/:id/status', rateLimit(300, 60_000), (req, res) => {
  const g = db.grants[req.params.id];
  if (!g) return res.status(404).json({ status: 'unknown' });
  const status = g.status === 'active' && g.grant.maxViews && g.views >= g.grant.maxViews ? 'exhausted' : g.status;
  res.json({ status, expiresAt: g.grant.expiresAt });
});

/** Provider "open": counts a view and releases the key-half while the grant is live. */
app.post('/api/grants/:id/open', rateLimit(60, 60_000), (req, res) => {
  const g = db.grants[req.params.id];
  if (!g) return res.status(404).json({ status: 'unknown', error: 'This link does not exist.' });
  const now = Date.now();
  if (g.status === 'active' && g.grant.expiresAt <= now) {
    retire(g, 'expired');
    save();
    gcBlobs();
  }
  if (g.status !== 'active') return res.status(410).json({ status: g.status, error: `This link has been ${g.status}.` });
  if (g.grant.maxViews && g.views >= g.grant.maxViews) {
    g.log.push({ t: now, event: 'blocked:view-limit' });
    save();
    return res.status(410).json({ status: 'exhausted', error: 'This link has reached its view limit.' });
  }
  g.views++;
  g.log.push({ t: now, event: 'opened' });
  const payload = {
    status: 'active',
    grant: { ...g.grant },
    sig: g.sig,
    views: g.views,
    viewsLeft: g.grant.maxViews ? g.grant.maxViews - g.views : null,
    serverTime: now,
  };
  // burn-after-reading: the last permitted open destroys the key-half immediately
  if (g.grant.maxViews && g.views >= g.grant.maxViews) {
    retire(g, 'exhausted');
    gcBlobs();
  }
  save();
  res.json(payload);
});

/** Owner, signed, batch: statuses + access logs for the dashboard. */
app.post('/api/inspect', rateLimit(120, 60_000), express.json({ limit: '32kb' }), (req, res) => {
  const { ownerPub, ts, ids, sig } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length > 200 || typeof ts !== 'number' || Math.abs(Date.now() - ts) > 5 * 60_000)
    return res.status(400).json({ error: 'bad request or clock skew' });
  if (!verifySig(ownerPub, `inspect:${ts}:${ids.join(',')}`, sig)) return res.status(401).json({ error: 'invalid signature' });
  const out = {};
  for (const id of ids) {
    const g = db.grants[id];
    if (!g || g.grant.ownerPub !== ownerPub) {
      out[id] = { status: 'unknown' };
      continue;
    }
    const status = g.status === 'active' && g.grant.maxViews && g.views >= g.grant.maxViews ? 'exhausted' : g.status;
    out[id] = { status, views: g.views, log: g.log.slice(-50), expiresAt: g.grant.expiresAt };
  }
  res.json({ grants: out });
});

app.post('/api/grants/:id/revoke', rateLimit(60, 60_000), express.json({ limit: '4kb' }), (req, res) => {
  const { ts, sig } = req.body ?? {};
  const g = db.grants[req.params.id];
  if (!g) return res.status(404).json({ error: 'unknown grant' });
  if (typeof ts !== 'number' || Math.abs(Date.now() - ts) > 5 * 60_000) return res.status(400).json({ error: 'clock skew' });
  if (!verifySig(g.grant.ownerPub, `revoke:${req.params.id}:${ts}`, sig)) return res.status(401).json({ error: 'invalid signature' });
  if (g.status === 'active') {
    retire(g, 'revoked');
    save();
    gcBlobs();
  }
  res.json({ ok: true, status: g.status });
});

// ---------------------------------------------------------------- static app
// The SPA shell (index.html) must never be cached: it's what points browsers at the current
// hashed JS/CSS bundle, so a stale cached copy silently keeps serving old app code after every
// deploy until the cache expires. Vite's /assets/* files are content-hashed (a change gets a new
// filename), so those alone are safe to cache long and immutably.
if (existsSync(DIST_DIR)) {
  app.use(
    express.static(DIST_DIR, {
      index: false,
      setHeaders(res, filePath) {
        res.setHeader('Cache-Control', filePath.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(DIST_DIR, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload too large' });
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

export { app, sweep };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, HOST, () => {
    console.log(`\n  MediKey blind relay listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`  data dir: ${DATA_DIR}`);
    console.log(existsSync(DIST_DIR) ? '  serving built app from dist/\n' : '  (no dist/ build found — run `npm run dev` for the web app)\n');
  });
}
