import { useEffect, useState, useSyncExternalStore } from 'react';
import { CheckCircle2, Cpu, Database, Eye, Globe, KeyRound, Lock, PlayCircle, Server, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import { useVault } from '../state/VaultContext';
import { clearNetLog, getNetLog, subscribeNetLog } from '../lib/netlog';
import { rawSample } from '../lib/vault';
import { runSelfTest, type Check } from '../lib/selftest';
import { formatBytes } from '../lib/bytes';

export default function Security() {
  const v = useVault();
  const net = useSyncExternalStore(subscribeNetLog, getNetLog);
  const [raw, setRaw] = useState<{ key: string; bytes: number; preview: string }[]>([]);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => { rawSample(3).then(setRaw); }, [v.records.length]);

  const out = net.filter((n) => n.kind === 'relay' || n.kind === 'ipfs' || n.kind === 'other');
  const bytesOut = out.reduce((a, n) => a + n.bytesOut, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Security &amp; Zero-Trust Ledger</h1>
          <p>Verify — don't trust. Everything below is measured live in this browser.</p>
        </div>
      </div>

      <div className="stats">
        <div className="card stat"><b style={{ color: 'var(--ok)' }}>{net.filter((n) => n.kind === 'other').length}</b><span>Requests to third parties</span></div>
        <div className="card stat"><b>{out.filter((n) => n.kind === 'relay').length}</b><span>Relay requests (ciphertext / signed)</span></div>
        <div className="card stat"><b>{formatBytes(bytesOut)}</b><span>Bytes sent off-device this session</span></div>
        <div className="card stat"><b>{v.records.length}</b><span>Records encrypted at rest</span></div>
      </div>

      <div className="card flat" style={{ marginBottom: 18 }}>
        <h2>Who can see what</h2>
        <div className="flow">
          <div className="node you">
            <h4><Lock size={17} color="var(--ok)" /> Your browser</h4>
            <ul><li>Seed &amp; keys (RAM only while unlocked)</li><li>Original files (discarded after sanitizing)</li><li>Sanitized records (encrypted at rest)</li><li>Link half <code>Ka</code></li></ul>
          </div>
          <div className="node relay">
            <h4><Server size={17} color="var(--warn)" /> Blind relay / IPFS</h4>
            <ul><li>AES-GCM ciphertext shards</li><li>Key half <code>Kb</code> (deleted on expiry / revoke)</li><li>Signed manifest, view counter</li><li><b>Cannot</b> read, decrypt or link records to a person</li></ul>
          </div>
          <div className="node">
            <h4><Eye size={17} color="var(--accent-2)" /> Provider browser</h4>
            <ul><li>Link fragment → <code>Ka</code> (never sent to a server)</li><li><code>K = Ka ⊕ Kb</code> reconstructed locally</li><li>Verifies the patient's Ed25519 signature</li><li>Read-only, watermarked, auto-wipes on expiry</li></ul>
          </div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 18 }}>
        <div className="card flat">
          <h3><KeyRound size={17} style={{ verticalAlign: '-3px' }} /> Cryptographic design</h3>
          <dl className="kv">
            <dt>Identity</dt><dd>256-bit seed → HKDF → Ed25519 signing key + AES-256 vault key</dd>
            <dt>Key at rest</dt><dd>Seed wrapped with Argon2id (64 MiB, t=3) + AES-256-GCM</dd>
            <dt>Records</dt><dd>AES-256-GCM, random 96-bit nonce, AAD = record id</dd>
            <dt>Sharing</dt><dd>Random grant key K = Ka ⊕ Kb; 192 KiB shards, AAD = id:index:total</dd>
            <dt>Authenticity</dt><dd>Ed25519 signature over canonical JSON manifest</dd>
            <dt>Provider binding</dt><dd>X25519 ECDH + HKDF + AES-GCM (ECIES-style)</dd>
            <dt>Your fingerprint</dt><dd className="mono" style={{ color: 'var(--accent)' }}>{v.identity?.fingerprint}</dd>
          </dl>
        </div>
        <div className="card flat">
          <h3><Database size={17} style={{ verticalAlign: '-3px' }} /> What a thief with disk access sees</h3>
          <p className="small muted">Raw values from this browser's IndexedDB — opaque ciphertext, no titles, names, or dates:</p>
          {raw.length === 0 && <p className="small muted">Nothing stored yet.</p>}
          <div className="stack tight">
            {raw.map((r) => <div key={r.key}><div className="small"><span className="mono">{r.key}</span> · {formatBytes(r.bytes)}</div><div className="cipher">{r.preview}</div></div>)}
          </div>
        </div>
      </div>

      <div className="card flat" style={{ marginBottom: 18 }}>
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}><Cpu size={19} style={{ verticalAlign: '-3px' }} /> Live cryptographic self-test</h2>
          <button className="btn primary right" disabled={running} onClick={async () => { setRunning(true); setChecks(await runSelfTest()); setRunning(false); }}><PlayCircle size={16} /> Run self-test</button>
        </div>
        {checks ? (
          <table className="tbl"><tbody>
            {checks.map((c) => (
              <tr key={c.name}>
                <td style={{ width: 28 }}>{c.ok ? <CheckCircle2 size={18} color="var(--ok)" /> : <XCircle size={18} color="var(--danger)" />}</td>
                <td><b>{c.name}</b><br /><small className="muted">{c.detail}</small></td>
              </tr>
            ))}
          </tbody></table>
        ) : <p className="muted small">Exercises AES-GCM, tamper detection, signatures, the split-key scheme and clinician-bound sealing on fresh random keys.</p>}
      </div>

      <div className="card flat" style={{ marginBottom: 18 }}>
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}><Globe size={19} style={{ verticalAlign: '-3px' }} /> Network transparency ledger</h2>
          <button className="btn sm right" onClick={clearNetLog}><Trash2 size={14} /> Clear</button>
        </div>
        <p className="small muted">Every <code>fetch()</code> this app makes is recorded. Reading, OCR, redaction and encryption make <b>zero</b> requests — only sharing talks to the relay, with ciphertext.</p>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Time</th><th>Request</th><th>Destination</th><th>Sent</th><th>Status</th></tr></thead>
            <tbody>
              {net.length === 0 && <tr><td colSpan={5} className="muted">No requests yet this session.</td></tr>}
              {net.slice(0, 40).map((n) => (
                <tr key={n.id}>
                  <td className="mono nowrap">{new Date(n.t).toLocaleTimeString()}</td>
                  <td className="mono">{n.method} {n.path}</td>
                  <td><span className={`pill ${n.kind === 'other' ? 'bad' : n.kind === 'app' ? '' : 'info'}`}>{n.kind}</span> <small className="muted">{n.origin.replace(/^https?:\/\//, '')}</small></td>
                  <td>{n.bytesOut ? formatBytes(n.bytesOut) : '—'}</td>
                  <td>{n.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card flat">
        <h2><ShieldAlert size={19} style={{ verticalAlign: '-3px' }} /> Threat model — honest limits</h2>
        <div className="grid cols-2">
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li><b>Malicious/compromised relay:</b> sees only ciphertext + one key half. It can deny service, not read data. Tampered shards fail the hash and GCM checks; forged manifests fail the signature.</li>
            <li><b>Leaked link:</b> bearer links are as sensitive as a key. Add a passcode, a view limit, or bind to a clinician key.</li>
            <li><b>Stolen laptop:</b> vault is AES-encrypted; brute-forcing needs the Argon2id-hardened passphrase. Auto-lock wipes keys from memory.</li>
          </ul>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li><b>Revocation:</b> destroys the relay's key half, making all copies of the ciphertext (even IPFS pins) permanently undecryptable. It cannot un-see what a provider already viewed.</li>
            <li><b>Screenshots:</b> the portal is read-only and watermarked, but can't stop a photo of a screen.</li>
            <li><b>Provider identity:</b> clinician keys are self-generated; production would bind them to NPI / hospital-issued credentials.</li>
            <li><b>PII detection:</b> rule-based &amp; reviewable, not perfect — always skim the sanitized preview.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
