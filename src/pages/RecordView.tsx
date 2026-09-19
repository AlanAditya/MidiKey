import { useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, Download, EyeOff, Share2, Trash2, Languages } from 'lucide-react';
import { useVault } from '../state/VaultContext';
import { useToast } from '../state/Toast';
import { KIND_ICON, PlaceholderText, download, fmtDate } from '../components/common';
import { CATEGORY_META, type PiiCategory } from '../lib/pii/engine';
import { RECORD_KINDS } from '../lib/types';
import { GLOSSARY } from '../lib/copilot/glossary';
import { formatBytes } from '../lib/bytes';

export default function RecordView() {
  const { id } = useParams();
  const v = useVault();
  const toast = useToast();
  const nav = useNavigate();
  const r = v.records.find((x) => x.id === id);
  const [plain, setPlain] = useState(false);
  const annotated = useMemo(() => (r && plain ? annotate(r.text) : null), [r, plain]);
  if (!r) return <Navigate to="/vault" replace />;
  const I = KIND_ICON[r.kind];

  return (
    <>
      <div className="page-head">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div className="ico" style={{ width: 56, height: 56, borderRadius: 18 }}><I size={24} /></div>
          <div>
            <h1>{r.title}</h1>
            <p>{RECORD_KINDS.find((k) => k.value === r.kind)?.label}{r.date ? ` · ${fmtDate(r.date)}` : ''} · {r.source.filename} ({formatBytes(r.source.size)}, {r.source.method})</p>
          </div>
        </div>
        <Link to="/vault" className="btn ghost right"><ArrowLeft size={16} /> Vault</Link>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <button className={`btn ${plain ? 'primary' : ''}`} aria-pressed={plain} onClick={() => setPlain(!plain)}><Languages size={16} /> Plain-language hints</button>
        <Link className="btn" to={`/access?record=${r.id}`}><Share2 size={16} /> Share…</Link>
        <Link className="btn" to="/copilot"><Bot size={16} /> Ask Copilot</Link>
        <button className="btn" onClick={() => download(`${r.title}.txt`, new Blob([r.text], { type: 'text/plain' }))}><Download size={16} /> Export sanitized</button>
        <button className="btn danger right" onClick={async () => { if (confirm(`Delete “${r.title}” from this device? Existing share links keep working until revoked.`)) { await v.removeRecord(r.id); toast('Record deleted.'); nav('/vault'); } }}><Trash2 size={16} /> Delete</button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px', alignItems: 'start' }}>
        <div className="doc" style={{ maxHeight: 'none' }} tabIndex={0} aria-label="Sanitized record text">
          {annotated ?? <PlaceholderText text={r.text} />}
        </div>
        <aside className="card flat">
          <h3 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><EyeOff size={17} color="var(--accent)" /> Privacy report</h3>
          <p className="small muted">{r.redaction.total} identifiers removed · {r.redaction.mode} mode</p>
          {Object.entries(r.redaction.counts).map(([k, n]) => (
            <div key={k} className="legend-row"><span className="grow">{CATEGORY_META[k as PiiCategory]?.label ?? k}</span><span className="pill">{n}</span></div>
          ))}
          {r.redaction.total === 0 && <p className="small muted">Nothing to remove{r.vitals ? ' — numeric vitals only.' : '.'}</p>}
          <p className="hint">The original file was discarded. Only this sanitized text is stored (encrypted).</p>
        </aside>
      </div>
    </>
  );
}

/** Wrap glossary terms in <abbr>-style tooltips. */
function annotate(text: string): ReactNode {
  const re = new RegExp(`\\b(?:${GLOSSARY.map((t) => `(${t.match})`).join('|')})\\b`, 'gi');
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const gi = m.findIndex((x, i) => i > 0 && x !== undefined) - 1;
    const t = GLOSSARY[gi];
    if (m.index! > last) out.push(<PlaceholderText key={`p${last}`} text={text.slice(last, m.index)} />);
    out.push(<abbr key={m.index} className="tip" title={t.plain} tabIndex={0}>{m[0]}</abbr>);
    last = m.index! + m[0].length;
  }
  out.push(<PlaceholderText key="end" text={text.slice(last)} />);
  return <>{out}</>;
}
