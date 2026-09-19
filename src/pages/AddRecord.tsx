import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, FileUp, Loader2, Lock, Sparkles, ClipboardPaste, Save } from 'lucide-react';
import { useVault } from '../state/VaultContext';
import { useToast } from '../state/Toast';
import { ACCEPT, extractFile, type Extracted } from '../lib/extract';
import { applyRedactions, detect, type Finding } from '../lib/pii/engine';
import { RedactionReview } from '../components/RedactionReview';
import { LineChart } from '../components/Charts';
import { newId } from '../lib/vault';
import { RECORD_KINDS, type HealthRecord, type PrivacyMode, type RecordKind } from '../lib/types';
import { SAMPLES, loadSample } from '../lib/samples';
import { NORMAL_BANDS } from '../lib/vitals';

type Stage = 'pick' | 'working' | 'review' | 'details';

const COLORS = ['#64d2ff', '#ff6482', '#30d158', '#ffd60a', '#bf5af2', '#ff9f0a', '#5e5ce6', '#a3e635'];

function guessKind(text: string, filename: string, vitals: boolean): RecordKind {
  if (vitals) return 'vitals';
  const t = text.slice(0, 4000).toLowerCase();
  if (/discharge summary/.test(t)) return 'discharge';
  if (/reference range|hemoglobin|cholesterol|specimen|laboratory report/.test(t)) return 'lab';
  if (/prescription|\brx\b|sig:/.test(t)) return 'prescription';
  if (/radiolog|mri|ct scan|x-ray|ultrasound|impression:/.test(t)) return 'imaging';
  if (/assessment|plan:|visit|clinic/.test(t) || /note/.test(filename)) return 'clinical-note';
  return 'other';
}

function vitalsDate(ds: { type: string; t: number[] }): string {
  return new Date(ds.type === 'ecg' ? Date.now() : ds.t[ds.t.length - 1]).toISOString().slice(0, 10);
}

function guessDate(findings: Finding[]): string {
  const f = findings.find((x) => x.category === 'DATE');
  if (!f) return '';
  const d = new Date(f.text.replace(/(\d)(st|nd|rd|th)/, '$1'));
  return isNaN(+d) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AddRecord() {
  const v = useVault();
  const toast = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [stage, setStage] = useState<Stage>('pick');
  const [queue, setQueue] = useState<File[]>([]);
  const [idx, setIdx] = useState(0);
  const [msg, setMsg] = useState('');
  const [pct, setPct] = useState(0);
  const [error, setError] = useState('');
  const [ex, setEx] = useState<Extracted | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [mode, setMode] = useState<PrivacyMode>(v.settings.privacyMode);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<RecordKind>('other');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const file = queue[idx];

  const identifiers = v.settings.identifiers;
  const result = useMemo(() => (ex ? applyRedactions(ex.text, findings) : null), [ex, findings]);

  const process = async (f: File, targetMode = mode) => {
    setStage('working');
    setError('');
    setMsg('Reading file…');
    setPct(0);
    try {
      const r = await extractFile(f, (m, frac) => {
        setMsg(m);
        if (frac !== undefined) setPct(frac);
      });
      setEx(r);
      if (r.vitals) {
        setFindings([]);
        setKind('vitals');
        setTitle(r.vitals.dataset.type === 'ecg' ? 'ECG recording' : 'Vitals & wearable data');
        setDate(vitalsDate(r.vitals.dataset));
        setStage('details');
      } else {
        const fs = detect(r.text, { mode: targetMode, identifiers });
        setFindings(fs);
        const k = guessKind(r.text, f.name, false);
        setKind(k);
        setTitle(RECORD_KINDS.find((x) => x.value === k)?.label ?? 'Record');
        setDate(guessDate(fs));
        setStage('review');
      }
    } catch (e) {
      setError((e as Error).message);
      setStage('pick');
    }
  };

  const start = (files: File[]) => {
    if (!files.length) return;
    setQueue(files);
    setIdx(0);
    process(files[0]);
  };

  useEffect(() => {
    if (idx > 0 && queue[idx]) process(queue[idx]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const save = async () => {
    if (!ex || !result) return;
    setSaving(true);
    try {
      const rec: HealthRecord = {
        id: newId(),
        title: title.trim() || 'Untitled record',
        kind,
        date: date || undefined,
        source: { filename: file?.name ?? 'pasted-text.txt', mime: file?.type ?? 'text/plain', size: file?.size ?? ex.text.length, method: ex.method },
        text: ex.vitals ? ex.text : result.text,
        redaction: { mode, total: ex.vitals ? 0 : result.total, counts: ex.vitals ? {} : result.counts },
        vitals: ex.vitals?.dataset,
        createdAt: Date.now(),
      };
      await v.addRecord(rec);
      toast(`Encrypted & saved “${rec.title}”.`);
      if (idx + 1 < queue.length) setIdx(idx + 1);
      else nav(ex.vitals ? '/vitals' : '/vault');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  /** One-click demo: run every sample through the same pipeline with default settings. */
  const loadAll = async () => {
    setStage('working');
    let n = 0;
    try {
      for (const s of SAMPLES) {
        setMsg(`Sanitizing & encrypting ${s.label}…`);
        setPct(n / SAMPLES.length);
        const f = await loadSample(s);
        const r = await extractFile(f);
        const fs = r.vitals ? [] : detect(r.text, { mode: v.settings.privacyMode, identifiers });
        const red = r.vitals ? null : applyRedactions(r.text, fs);
        await v.addRecord({
          id: newId(),
          title: s.label,
          kind: s.kind,
          date: r.vitals ? vitalsDate(r.vitals.dataset) : guessDate(fs) || undefined,
          source: { filename: f.name, mime: f.type, size: f.size, method: r.method },
          text: red ? red.text : r.text,
          redaction: { mode: v.settings.privacyMode, total: red?.total ?? 0, counts: red?.counts ?? {} },
          vitals: r.vitals?.dataset,
          createdAt: Date.now(),
        });
        n++;
      }
      toast(`Loaded ${n} sample records.`);
      nav('/vault');
    } catch (e) {
      setError((e as Error).message);
      setStage('pick');
    }
  };

  const titleLeaks = useMemo(() => {
    const t = title.toLowerCase();
    return t.length > 2 && findings.some((f) => (f.category === 'PERSON' || f.category === 'CUSTOM') && f.text.length > 2 && t.includes(f.text.toLowerCase().split(/\s+/)[0]));
  }, [title, findings]);

  const steps = ['Choose file', 'Review & sanitize', 'Encrypt & save'];
  const step = stage === 'review' ? 1 : stage === 'details' ? 2 : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Add a record</h1>
          <p>Files are read and sanitized in your browser. Only the redacted text is ever encrypted and stored.</p>
        </div>
        <Link to="/vault" className="btn ghost right"><ArrowLeft size={16} /> Back to vault</Link>
      </div>

      <ol className="stepper" style={{ listStyle: 'none', padding: 0 }} aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s} className={`s ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`} aria-current={i === step ? 'step' : undefined}><b>{i + 1}</b>{s}</li>
        ))}
        {queue.length > 1 && <li className="s"><b>{idx + 1}</b>of {queue.length} files</li>}
      </ol>

      {error && <div className="notice bad" role="alert" style={{ marginBottom: 16 }}><AlertTriangle size={18} /><div>{error}</div></div>}

      {stage === 'pick' && (
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <div className="stack">
            <div
              className={`dropzone ${over ? 'over' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Choose files or drop them here"
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileInput.current?.click())}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); start([...e.dataTransfer.files]); }}
            >
              <div className="big-ico"><FileUp size={28} /></div>
              <h3 style={{ margin: 0 }}>Drop files or click to browse</h3>
              <p className="muted small" style={{ margin: '6px 0 0' }}>PDF (text or scanned) · images (OCR) · TXT · CSV vitals · up to 25 MB</p>
              <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { start([...(e.target.files ?? [])]); e.target.value = ''; }} />
            </div>
            <div className="card flat">
              <h3 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><ClipboardPaste size={18} /> Or paste text</h3>
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste a lab result, clinic note, or portal message…" aria-label="Paste text" />
              <button className="btn primary" style={{ marginTop: 10 }} disabled={paste.trim().length < 10} onClick={() => start([new File([paste], 'pasted-text.txt', { type: 'text/plain' })])}>
                Continue <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <div className="card flat">
            <h3 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Sparkles size={18} color="var(--accent)" /> Try with synthetic samples</h3>
            <p className="muted small">Realistic fake documents full of identifiers — perfect for seeing the privacy engine work.</p>
            <div className="stack tight">
              {SAMPLES.map((s) => (
                <button key={s.file} className="btn" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={async () => { try { start([await loadSample(s)]); } catch (e) { setError((e as Error).message); } }}>
                  <span style={{ flex: 1 }}><b>{s.label}</b><br /><small className="muted" style={{ fontWeight: 400 }}>{s.blurb}</small></span>
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
            <hr />
            <button className="btn primary block" onClick={loadAll} data-testid="load-all-samples"><Sparkles size={17} /> Load all samples at once</button>
            <p className="hint">Auto-sanitized with your default privacy level.{params.get('demo') ? ' (Demo mode)' : ''}</p>
          </div>
        </div>
      )}

      {stage === 'working' && (
        <div className="card pad-lg center" role="status" aria-live="polite" style={{ maxWidth: 560, margin: '40px auto' }}>
          <Loader2 size={34} className="spin" color="var(--accent)" />
          <h3 style={{ marginTop: 14 }}>{msg}</h3>
          <div className="progress" aria-hidden="true"><i style={{ width: `${Math.max(4, pct * 100)}%` }} /></div>
          <p className="hint">Processing locally — no network request is made with your document.</p>
        </div>
      )}

      {stage === 'review' && ex && (
        <div className="stack">
          {ex.warnings.map((w) => (
            <div className="notice warn" key={w}><AlertTriangle size={18} /><div>{w}</div></div>
          ))}
          <RedactionReview text={ex.text} findings={findings} setFindings={setFindings} mode={mode} setMode={setMode} identifiers={identifiers} />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn" onClick={() => { setStage('pick'); setEx(null); setQueue([]); }}><ArrowLeft size={16} /> Choose another file</button>
            <button className="btn primary lg" onClick={() => setStage('details')}>Looks good — continue <ArrowRight size={17} /></button>
          </div>
        </div>
      )}

      {stage === 'details' && ex && (
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <div className="card flat stack">
            <h3 style={{ margin: 0 }}>Record details</h3>
            <label className="field" style={{ margin: 0 }}>
              <span className="lbl">Title</span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
              {titleLeaks && <div className="hint" style={{ color: 'var(--warn)' }}>⚠ This title contains a name that was flagged as personal information.</div>}
              <div className="hint">Avoid names — titles are shared with providers.</div>
            </label>
            <div className="grid cols-2">
              <label className="field" style={{ margin: 0 }}>
                <span className="lbl">Type</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as RecordKind)}>
                  {RECORD_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span className="lbl">Date of record</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
            <div className="notice info">
              <Lock size={18} />
              <div>
                Encrypted with <b>AES-256-GCM</b> under your vault key, then written to this device only. The original file
                {ex.vitals ? ' and any columns other than recognised vitals are' : ' is'} discarded.
                {!ex.vitals && result && <> <b>{result.total}</b> identifier{result.total === 1 ? '' : 's'} removed ({mode}).</>}
              </div>
            </div>
            <div className="row">
              <button className="btn" onClick={() => setStage(ex.vitals ? 'pick' : 'review')}><ArrowLeft size={16} /> Back</button>
              <button className="btn primary lg right" onClick={save} disabled={saving || !title.trim()}>
                {saving ? <><Loader2 size={17} className="spin" /> Encrypting…</> : <><Save size={17} /> Encrypt &amp; save</>}
              </button>
            </div>
          </div>
          <div className="card flat" style={{ minWidth: 0 }}>
            <h3>{ex.vitals ? 'Parsed vitals preview' : 'What will be stored'}</h3>
            {ex.vitals ? (
              <VitalsPreview ds={ex.vitals.dataset} summary={ex.vitals.summary} />
            ) : (
              <div className="doc" style={{ maxHeight: 420 }} tabIndex={0} aria-label="Sanitized text to be stored">{result?.text}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function VitalsPreview({ ds, summary }: { ds: NonNullable<Extracted['vitals']>['dataset']; summary: string }) {
  if (ds.type === 'ecg') return <p className="small">{summary}</p>;
  const main = ds.series.slice(0, 3);
  return (
    <div className="stack">
      <LineChart t={ds.t} height={200} band={main[0] ? NORMAL_BANDS[main[0].key] : undefined} ariaLabel="Preview of imported vitals" series={main.map((s, i) => ({ label: s.label, color: COLORS[i], values: s.values, unit: s.unit }))} />
      <p className="small muted">{summary}</p>
    </div>
  );
}
