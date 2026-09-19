import { useRef, useState } from 'react';
import { Download, Eraser, HardDrive, Loader2, Plus, Upload, X, CheckCircle2, XCircle } from 'lucide-react';
import { useVault } from '../state/VaultContext';
import { useToast } from '../state/Toast';
import { download } from '../components/common';
import { makeRelay, relayBase } from '../lib/relay';

export default function Settings() {
  const v = useVault();
  const toast = useToast();
  const s = v.settings;
  const [ident, setIdent] = useState('');
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const addIdent = () => {
    const t = ident.trim();
    if (t.length < 3 || s.identifiers.includes(t)) return;
    v.updateSettings({ identifiers: [...s.identifiers, t] });
    setIdent('');
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      if (s.storage.backend === 'ipfs') {
        const r = await fetch(`${s.storage.ipfsApi.replace(/\/+$/, '')}/api/v0/version`, { method: 'POST' }).catch(() => null);
        setTest(r?.ok ? { ok: true, msg: 'IPFS node reachable.' } : { ok: false, msg: 'Cannot reach IPFS API (check the URL and CORS).' });
      } else {
        const h = await makeRelay(relayBase(s.storage.relayUrl)).health();
        setTest({ ok: true, msg: `Relay online · ${h.activeGrants} active grant(s).` });
      }
    } catch (e) {
      setTest({ ok: false, msg: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p>Stored encrypted inside your vault.</p></div></div>
      <div className="stack" style={{ maxWidth: 820 }}>
        <section className="card flat stack" aria-labelledby="s-priv">
          <h2 id="s-priv">Privacy engine</h2>
          <div>
            <span className="lbl" style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-2)' }}>Default privacy level</span>
            <div className="seg" role="group" aria-label="Default privacy level" style={{ display: 'flex', marginTop: 6, maxWidth: 320 }}>
              {(['balanced', 'strict'] as const).map((m) => <button key={m} style={{ flex: 1, textTransform: 'capitalize' }} aria-pressed={s.privacyMode === m} onClick={() => v.updateSettings({ privacyMode: m })}>{m}</button>)}
            </div>
            <p className="hint">Strict also removes clinician &amp; facility names and generalises every date to its year (HIPAA Safe-Harbor style).</p>
          </div>
          <div>
            <span className="lbl" style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-2)' }}>My identifiers — always scrubbed</span>
            <p className="hint" style={{ marginTop: 2 }}>Your name, phone, e-mail, family names. Every occurrence is removed from every future upload.</p>
            <div className="row tight" style={{ margin: '8px 0' }}>
              {s.identifiers.map((i) => <span className="pill" key={i}>{i}<button className="btn ghost icon-btn" style={{ padding: 0 }} aria-label={`Remove ${i}`} onClick={() => v.updateSettings({ identifiers: s.identifiers.filter((x) => x !== i) })}><X size={13} /></button></span>)}
            </div>
            <div className="row">
              <input type="text" value={ident} onChange={(e) => setIdent(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addIdent())} placeholder="e.g. Jane Q. Public" aria-label="Add identifier" style={{ flex: '1 1 240px' }} />
              <button className="btn" onClick={addIdent}><Plus size={16} /> Add</button>
            </div>
          </div>
        </section>

        <section className="card flat stack" aria-labelledby="s-store">
          <h2 id="s-store"><HardDrive size={19} style={{ verticalAlign: '-3px' }} /> Decentralised storage</h2>
          <div className="seg" role="group" aria-label="Shard storage backend" style={{ display: 'flex', maxWidth: 420 }}>
            <button style={{ flex: 1 }} aria-pressed={s.storage.backend === 'relay'} onClick={() => v.updateSettings({ storage: { ...s.storage, backend: 'relay' } })}>MediKey relay</button>
            <button style={{ flex: 1 }} aria-pressed={s.storage.backend === 'ipfs'} onClick={() => v.updateSettings({ storage: { ...s.storage, backend: 'ipfs' } })}>IPFS</button>
          </div>
          <label className="field" style={{ margin: 0 }}>
            <span className="lbl">Relay URL <small className="muted">(blank = same origin)</small></span>
            <input type="url" value={s.storage.relayUrl} onChange={(e) => v.updateSettings({ storage: { ...s.storage, relayUrl: e.target.value } })} placeholder="https://relay.example.org" />
            <div className="hint">Always holds the key half + signed manifest, even in IPFS mode.</div>
          </label>
          {s.storage.backend === 'ipfs' && (
            <div className="grid cols-2">
              <label className="field" style={{ margin: 0 }}><span className="lbl">IPFS API (Kubo)</span><input type="url" value={s.storage.ipfsApi} onChange={(e) => v.updateSettings({ storage: { ...s.storage, ipfsApi: e.target.value } })} /></label>
              <label className="field" style={{ margin: 0 }}><span className="lbl">IPFS gateway</span><input type="url" value={s.storage.ipfsGateway} onChange={(e) => v.updateSettings({ storage: { ...s.storage, ipfsGateway: e.target.value } })} /></label>
            </div>
          )}
          <div className="row">
            <button className="btn" onClick={runTest} disabled={testing}>{testing ? <Loader2 size={16} className="spin" /> : null} Test connection</button>
            {test && <span className={`pill ${test.ok ? 'ok' : 'bad'}`}>{test.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {test.msg}</span>}
          </div>
          <p className="hint" style={{ margin: 0 }}>Shards are AES-GCM ciphertext, so publishing them to IPFS is safe; revoking destroys the key half and they become permanently unreadable. No IPFS node? Run <code>npm run mock-ipfs</code> for a local stand-in.</p>
        </section>

        <section className="card flat stack" aria-labelledby="s-sec">
          <h2 id="s-sec">Session &amp; appearance</h2>
          <label className="field" style={{ margin: 0, maxWidth: 320 }}>
            <span className="lbl">Auto-lock after inactivity</span>
            <select value={s.autoLockMinutes} onChange={(e) => v.updateSettings({ autoLockMinutes: +e.target.value })}>
              {[1, 5, 10, 30, 0].map((m) => <option key={m} value={m}>{m ? `${m} minute${m > 1 ? 's' : ''}` : 'Never'}</option>)}
            </select>
          </label>
        </section>

        <section className="card flat stack" aria-labelledby="s-back">
          <h2 id="s-back">Backup &amp; danger zone</h2>
          <p className="small muted" style={{ margin: 0 }}>Backups are encrypted with your vault key — useless without your recovery key or passphrase.</p>
          <div className="row">
            <button className="btn" onClick={async () => download(`medikey-backup-${new Date().toISOString().slice(0, 10)}.medikey`, await v.exportBackup())}><Download size={16} /> Export encrypted backup</button>
            <button className="btn" onClick={() => file.current?.click()}><Upload size={16} /> Import backup</button>
            <input ref={file} type="file" accept=".medikey" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try { toast(`Restored ${await v.importBackup(f)} records.`); } catch (x) { toast((x as Error).message, 'bad'); }
            }} />
            <button className="btn danger right" onClick={async () => { if (confirm('Erase your vault, keys and ALL records from this device? Make sure you have your recovery key and a backup.')) await v.eraseDevice(); }}><Eraser size={16} /> Erase this device</button>
          </div>
        </section>
      </div>
    </>
  );
}
