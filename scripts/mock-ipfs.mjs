// A tiny stand-in for a Kubo (go-ipfs) node so the "IPFS" storage backend can be demoed
// without installing IPFS. Speaks just enough of the HTTP API (/api/v0/add) and the gateway (/ipfs/:cid).
//   API:      http://127.0.0.1:5001      Gateway: http://127.0.0.1:8080
// Content is addressed by a real CIDv1 (raw, sha2-256) computed over the bytes.
import http from 'node:http';
import { createHash } from 'node:crypto';

const store = new Map();
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function cidOf(buf) {
  const digest = createHash('sha256').update(buf).digest();
  const bytes = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]);
  let bits = 0, value = 0, out = 'b';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/v0/add') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const boundary = /boundary=(.+)$/.exec(req.headers['content-type'] ?? '')?.[1];
      if (!boundary) { res.writeHead(400); return res.end('no boundary'); }
      const start = body.indexOf('\r\n\r\n') + 4;
      const end = body.lastIndexOf(`\r\n--${boundary}`);
      const content = body.subarray(start, end);
      const cid = cidOf(content);
      store.set(cid, content);
      console.log(`[mock-ipfs] add ${cid} (${content.length} B)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ Name: cid, Hash: cid, Size: String(content.length) }));
    });
    return;
  }
  const m = /^\/ipfs\/([a-z0-9]+)$/.exec(url.pathname);
  if (req.method === 'GET' && m) {
    const c = store.get(m[1]);
    if (!c) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    return res.end(c);
  }
  res.writeHead(404); res.end('not found');
}

for (const port of [5001, 8080]) http.createServer(handler).listen(port, '127.0.0.1', () => console.log(`[mock-ipfs] listening on http://127.0.0.1:${port}`));
