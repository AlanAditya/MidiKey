import { useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, ShieldCheck, Wand2 } from 'lucide-react';
import { applyRedactions, CATEGORY_META, manualFindings, reapplyMode, residualScan, PLACEHOLDER_RE, type Finding, type PiiCategory } from '../lib/pii/engine';
import type { PrivacyMode } from '../lib/types';

interface Props {
  text: string;
  findings: Finding[];
  setFindings: (f: Finding[]) => void;
  mode: PrivacyMode;
  setMode: (m: PrivacyMode) => void;
  identifiers: string[];
}

export function RedactionReview({ text, findings, setFindings, mode, setMode, identifiers }: Props) {
  const [view, setView] = useState<'review' | 'preview'>('review');
  const [sel, setSel] = useState<{ start: number; end: number; text: string } | null>(null);
  const [allOcc, setAllOcc] = useState(true);
  const docRef = useRef<HTMLDivElement>(null);

  const result = useMemo(() => applyRedactions(text, findings), [text, findings]);
  const leaks = useMemo(() => residualScan(result.text, { mode, identifiers }), [result.text, mode, identifiers]);

  const byCat = useMemo(() => {
    const m = new Map<PiiCategory, { on: number; total: number }>();
    for (const f of findings) {
      const c = m.get(f.category) ?? { on: 0, total: 0 };
      c.total++;
      if (f.enabled) c.on++;
      m.set(f.category, c);
    }
    return [...m].sort((a, b) => b[1].total - a[1].total);
  }, [findings]);

  const toggle = (id: string) => setFindings(findings.map((f) => (f.id === id ? { ...f, enabled: !f.enabled, userSet: true } : f)));
  const toggleCat = (cat: PiiCategory, on: boolean) => setFindings(findings.map((f) => (f.category === cat ? { ...f, enabled: on, userSet: true } : f)));

  const segments = useMemo(() => {
    const out: ReactNode[] = [];
    let cur = 0;
    const sorted = [...findings].sort((a, b) => a.start - b.start);
    for (const f of sorted) {
      if (f.start < cur) continue;
      if (f.start > cur) out.push(<span key={`t${cur}`} data-s={cur}>{text.slice(cur, f.start)}</span>);
      out.push(
        <button
          key={f.id}
          type="button"
          className="pii"
          data-s={f.start}
          data-cat={f.category}
          data-on={f.enabled}
          onClick={() => toggle(f.id)}
          title={`${CATEGORY_META[f.category].label} · ${f.confidence} confidence · click to ${f.enabled ? 'keep' : 'redact'}`}
          aria-pressed={f.enabled}
          aria-label={`${CATEGORY_META[f.category].label}: ${f.text}. ${f.enabled ? 'Will be redacted' : 'Will be kept'}. Activate to toggle.`}
        >
          {f.text}
        </button>,
      );
      cur = f.end;
    }
    if (cur < text.length) out.push(<span key="tail" data-s={cur}>{text.slice(cur)}</span>);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, findings]);

  const onMouseUp = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !docRef.current) return setSel(null);
    const a = s.anchorNode?.parentElement?.closest('[data-s]') as HTMLElement | null;
    const b = s.focusNode?.parentElement?.closest('[data-s]') as HTMLElement | null;
    if (!a || !b || !docRef.current.contains(a) || !docRef.current.contains(b)) return setSel(null);
    const aOff = +a.dataset.s! + (s.anchorNode!.nodeType === 3 && a.contains(s.anchorNode) ? s.anchorOffset : 0);
    const bOff = +b.dataset.s! + (s.focusNode!.nodeType === 3 && b.contains(s.focusNode) ? s.focusOffset : 0);
    const start = Math.min(aOff, bOff);
    const end = Math.max(aOff, bOff);
    const picked = text.slice(start, end);
    if (picked.trim().length < 2) return setSel(null);
    setSel({ start, end, text: picked });
  };

  const addManual = () => {
    if (!sel) return;
    setFindings(manualFindings(text, findings, sel.start, sel.end, allOcc));
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };

  const active = findings.filter((f) => f.enabled).length;

  return (
    <div className="review">
      <div className="stack tight" style={{ minWidth: 0 }}>
        <div className="row">
          <div className="seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === 'review'} onClick={() => setView('review')}><Eye size={15} style={{ verticalAlign: '-2px' }} /> Review original</button>
            <button role="tab" aria-selected={view === 'preview'} onClick={() => setView('preview')}><EyeOff size={15} style={{ verticalAlign: '-2px' }} /> Sanitized preview</button>
          </div>
          <span className="muted small right">{active} of {findings.length} detections will be removed</span>
        </div>

        {view === 'review' && sel && (
          <div className="selbar" role="region" aria-label="Manual redaction">
            <span className="small">Selected: <b className="mono">{sel.text.length > 40 ? sel.text.slice(0, 40) + '…' : sel.text}</b></span>
            <label className="check small"><input type="checkbox" checked={allOcc} onChange={(e) => setAllOcc(e.target.checked)} /> every occurrence</label>
            <button className="btn primary sm right" onClick={addManual}><Wand2 size={15} /> Redact selection</button>
          </div>
        )}

        {view === 'review' ? (
          <div className="doc" ref={docRef} onMouseUp={onMouseUp} onKeyUp={onMouseUp} tabIndex={0} aria-label="Original document. Highlighted items are detected personal information.">
            {segments}
          </div>
        ) : (
          <div className="doc" tabIndex={0} aria-label="Sanitized document preview">
            <Placeholders text={result.text} />
          </div>
        )}
        <p className="hint">Click a highlight to keep or redact it. Select any other text with your mouse to redact it manually. Nothing here leaves your device.</p>
      </div>

      <aside className="stack" aria-label="Privacy summary">
        <div className="card flat">
          <h3 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><ShieldCheck size={18} color="var(--accent)" /> Privacy level</h3>
          <div className="seg" role="group" aria-label="Privacy mode" style={{ width: '100%' }}>
            <button style={{ flex: 1 }} aria-pressed={mode === 'balanced'} onClick={() => { setMode('balanced'); setFindings(reapplyMode(findings, 'balanced')); }}>Balanced</button>
            <button style={{ flex: 1 }} aria-pressed={mode === 'strict'} onClick={() => { setMode('strict'); setFindings(reapplyMode(findings, 'strict')); }}>Strict</button>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            {mode === 'balanced'
              ? 'Removes patient identifiers & contact details. Keeps clinical dates, clinician and facility names.'
              : 'HIPAA Safe-Harbor style: also removes clinician & facility names and reduces every date to its year.'}
          </p>
        </div>

        <div className="card flat">
          <h3>Detected by category</h3>
          {byCat.length === 0 && <p className="muted small">No personal identifiers found. Double-check the text, and select anything sensitive manually.</p>}
          {byCat.map(([cat, c]) => (
            <label key={cat} className="legend-row">
              <input type="checkbox" checked={c.on === c.total} ref={(el) => { if (el) el.indeterminate = c.on > 0 && c.on < c.total; }} onChange={(e) => toggleCat(cat, e.target.checked)} aria-label={`Redact all ${CATEGORY_META[cat].label}`} />
              <span className="grow">{CATEGORY_META[cat].label}<br /><small className="muted">{CATEGORY_META[cat].description}</small></span>
              <span className="pill">{c.on}/{c.total}</span>
            </label>
          ))}
        </div>

        {leaks.length > 0 ? (
          <div className="notice warn" role="alert">
            <AlertTriangle size={18} />
            <div><b>{leaks.length} possible identifier{leaks.length > 1 ? 's' : ''} remain.</b> Second-pass scan found: {leaks.slice(0, 4).map((l) => <code key={l.id} style={{ marginRight: 4 }}>{l.text.slice(0, 22)}</code>)}</div>
          </div>
        ) : (
          <div className="notice ok"><CheckCircle2 size={18} /><div><b>Second-pass scan clean.</b> The sanitized text was re-scanned and no known identifier patterns remain.</div></div>
        )}
      </aside>
    </div>
  );
}

function Placeholders({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(<span key={m.index} className="ph">{m[0]}</span>);
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}
