import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EyeOff, FilePlus2, FolderOpen, Search, ShieldCheck, Share2, Sparkles } from 'lucide-react';
import { useVault } from '../state/VaultContext';
import { KIND_ICON, fmtDate } from '../components/common';
import { RECORD_KINDS, type RecordKind } from '../lib/types';
import { formatBytes } from '../lib/bytes';

export default function Vault() {
  const { records, grants } = useVault();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<RecordKind | 'all'>('all');
  const removed = records.reduce((n, r) => n + r.redaction.total, 0);
  const active = grants.filter((g) => g.status === 'active' && g.expiresAt > Date.now()).length;

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return records.filter((r) => (kind === 'all' || r.kind === kind) && (!t || r.title.toLowerCase().includes(t) || r.text.toLowerCase().includes(t)));
  }, [records, q, kind]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Document Vault</h1>
          <p>Everything here is encrypted with your key and stored only on this device.</p>
        </div>
        <button className="btn primary right" onClick={() => nav('/vault/new')}><FilePlus2 size={18} /> Add record</button>
      </div>

      <div className="stats">
        <div className="card stat"><b>{records.length}</b><span>Encrypted records</span></div>
        <div className="card stat"><b>{removed}</b><span>Identifiers removed</span></div>
        <div className="card stat"><b>{active}</b><span>Active share links</span></div>
        <div className="card stat"><b style={{ color: 'var(--ok)' }}>0</b><span>Plaintext bytes uploaded</span></div>
      </div>

      {records.length === 0 ? (
        <div className="card pad-lg center">
          <div className="big-ico"><FolderOpen size={30} /></div>
          <h2>Your vault is empty</h2>
          <p className="muted" style={{ maxWidth: 520, margin: '0 auto 18px' }}>Add a lab report, discharge summary, PDF or wearable CSV. MediKey will extract the text, flag personal identifiers, and only then encrypt it.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link className="btn primary" to="/vault/new"><FilePlus2 size={17} /> Add your first record</Link>
            <Link className="btn" to="/vault/new?demo=1"><Sparkles size={17} /> Try with sample documents</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 420 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--muted)' }} />
              <input type="search" placeholder="Search your sanitized records…" aria-label="Search records" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 36 }} />
            </div>
            <div className="row tight" role="group" aria-label="Filter by type">
              {[{ value: 'all' as const, label: 'All' }, ...RECORD_KINDS.filter((k) => records.some((r) => r.kind === k.value))].map((k) => (
                <button key={k.value} className={`btn sm ${kind === k.value ? 'primary' : ''}`} aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>{k.label}</button>
              ))}
            </div>
          </div>
          <div className="stack tight">
            {shown.map((r) => {
              const I = KIND_ICON[r.kind];
              return (
                <Link key={r.id} to={`/vault/${r.id}`} className="rec">
                  <div className="ico"><I size={21} /></div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <h3>{r.title}</h3>
                    <div className="meta" style={{ marginTop: 0 }}>
                      <span className="pill">{RECORD_KINDS.find((k) => k.value === r.kind)?.label}</span>
                      {r.date && <span>{fmtDate(r.date)}</span>}
                      <span><EyeOff size={14} /> {r.redaction.total} removed · {r.redaction.mode}</span>
                      <span>{r.source.filename} · {formatBytes(r.source.size)}</span>
                    </div>
                  </div>
                  <ShieldCheck size={18} color="var(--ok)" aria-label="Encrypted" />
                </Link>
              );
            })}
            {shown.length === 0 && <p className="muted center">No records match.</p>}
          </div>
          <div className="notice info" style={{ marginTop: 22 }}>
            <Share2 size={18} />
            <div>Ready to share? Open <Link to="/access">Sharing</Link> to create a time-limited, revocable link for a doctor or researcher.</div>
          </div>
        </>
      )}
    </>
  );
}
