import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, HeartPulse, FilePlus2, Sparkles } from 'lucide-react';
import { useVault } from '../state/VaultContext';
import { EcgChart, LineChart } from '../components/Charts';
import { analyzeEcg, classifyBp, fmt, NORMAL_BANDS, seriesStats } from '../lib/vitals';
import type { VitalsDataset } from '../lib/types';

const COLORS = ['#64d2ff', '#ff6482', '#30d158', '#ffd60a', '#bf5af2', '#ff9f0a', '#5e5ce6', '#a3e635'];

export function VitalsView({ ds, readOnly }: { ds: VitalsDataset; readOnly?: boolean }) {
  return ds.type === 'ecg' ? <EcgView ds={ds} /> : <SeriesView ds={ds} readOnly={readOnly} />;
}

function SeriesView({ ds }: { ds: VitalsDataset; readOnly?: boolean }) {
  const stats = ds.series.map((s) => ({ s, st: seriesStats(ds.t, s.values) }));
  const sys = ds.series.find((s) => s.key === 'systolic');
  const dia = ds.series.find((s) => s.key === 'diastolic');
  const bp = sys && dia ? { a: seriesStats(ds.t, sys.values), b: seriesStats(ds.t, dia.values) } : null;
  const cls = bp?.a && bp.b ? classifyBp(bp.a.mean, bp.b.mean) : null;
  const rest = ds.series.filter((s) => s !== sys && s !== dia);
  const days = Math.max(1, (ds.t[ds.t.length - 1] - ds.t[0]) / 86400000);

  return (
    <div className="stack">
      <div className="grid auto">
        {stats.map(({ s, st }, i) => st && (
          <div className="card stat" key={s.key}>
            <span>{s.label}</span>
            <b style={{ color: COLORS[i % COLORS.length] }}>{fmt(st.latest)} <small className="muted" style={{ fontWeight: 500 }}>{s.unit}</small></b>
            <span>avg {fmt(st.mean)} · {fmt(st.min)}–{fmt(st.max)} ·{' '}
              <b style={{ color: Math.abs(st.slopePerDay * days) < st.sd * 0.5 ? 'var(--muted)' : 'var(--accent-2)' }}>
                {Math.abs(st.slopePerDay * days) < st.sd * 0.5 ? '→ steady' : st.slopePerDay > 0 ? `↑ ${fmt(st.slopePerDay * days)}` : `↓ ${fmt(Math.abs(st.slopePerDay * days))}`}
              </b>
            </span>
          </div>
        ))}
      </div>
      {sys && dia && (
        <div className="card flat">
          <div className="row" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Blood pressure</h3>
            {cls && <span className={`pill ${cls.tone === 'ok' ? 'ok' : cls.tone === 'warn' ? 'warn' : 'bad'}`}>Average {bp!.a!.mean.toFixed(0)}/{bp!.b!.mean.toFixed(0)} · {cls.label}</span>}
            <span className="legend right"><span><i style={{ background: COLORS[0] }} />Systolic</span><span><i style={{ background: COLORS[1] }} />Diastolic</span><span><i style={{ background: 'var(--ok)', opacity: 0.4 }} />Normal band</span></span>
          </div>
          <LineChart t={ds.t} band={NORMAL_BANDS.systolic} ariaLabel={`Blood pressure over ${days.toFixed(0)} days`} series={[{ label: 'Systolic', color: COLORS[0], values: sys.values, unit: 'mmHg' }, { label: 'Diastolic', color: COLORS[1], values: dia.values, unit: 'mmHg' }]} />
        </div>
      )}
      <div className="grid cols-2">
        {rest.map((s, i) => (
          <div className="card flat" key={s.key} style={{ minWidth: 0 }}>
            <h3>{s.label} <small className="muted">{s.unit}</small></h3>
            <LineChart t={ds.t} height={200} band={NORMAL_BANDS[s.key]} ariaLabel={`${s.label} over time`} series={[{ label: s.label, color: COLORS[(i + 2) % COLORS.length], values: s.values, unit: s.unit }]} />
          </div>
        ))}
      </div>
    </div>
  );
}

function EcgView({ ds }: { ds: VitalsDataset }) {
  const fs = ds.sampleRate ?? 250;
  const total = ds.t[ds.t.length - 1] ?? 0;
  const [start, setStart] = useState(0);
  const win = Math.min(6, total);
  const a = useMemo(() => analyzeEcg(ds), [ds]);
  return (
    <div className="stack">
      {a && (
        <div className="grid cols-4">
          <div className="card stat"><span>Heart rate</span><b>{a.meanHr.toFixed(0)} <small className="muted">bpm</small></b></div>
          <div className="card stat"><span>HRV (RMSSD)</span><b>{a.rmssd.toFixed(0)} <small className="muted">ms</small></b></div>
          <div className="card stat"><span>SDNN</span><b>{a.sdnn.toFixed(0)} <small className="muted">ms</small></b></div>
          <div className="card stat"><span>Rhythm</span><b style={{ fontSize: '1.2rem', color: a.irregular ? 'var(--warn)' : 'var(--ok)' }}>{a.irregular ? 'Irregular RR' : 'Regular'}</b><span>{a.peaks.length} beats detected</span></div>
        </div>
      )}
      <div className="card flat">
        <div className="row" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Lead I · {fs} Hz</h3>
          <span className="muted small">grid: 1 mm = 40 ms · 0.1 mV</span>
        </div>
        <EcgChart values={ds.series[0].values} fs={fs} peaks={a?.peaks ?? []} start={start} windowSec={win} />
        {total > win && (
          <label className="field" style={{ margin: '10px 0 0' }}>
            <span className="lbl">Scroll ({start.toFixed(1)} s – {(start + win).toFixed(1)} s of {total.toFixed(0)} s)</span>
            <input type="range" min={0} max={Math.max(0, total - win)} step={0.1} value={start} onChange={(e) => setStart(+e.target.value)} />
          </label>
        )}
      </div>
      {a && a.irregular && <div className="notice warn">RR intervals vary more than usual. This automated screen is not a diagnosis — please review the tracing with a clinician.</div>}
    </div>
  );
}

export default function Vitals() {
  const { records } = useVault();
  const list = useMemo(() => records.filter((r) => r.vitals), [records]);
  const [sel, setSel] = useState<string | undefined>(list[0]?.id);
  useEffect(() => {
    if (!list.find((r) => r.id === sel)) setSel(list[0]?.id);
  }, [list, sel]);
  const cur = list.find((r) => r.id === sel);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Vitals &amp; Time-series</h1>
          <p>Blood pressure, glucose, wearable exports and ECG waveforms — analysed on-device.</p>
        </div>
        <Link to="/vault/new" className="btn primary right"><FilePlus2 size={17} /> Import CSV</Link>
      </div>
      {list.length === 0 ? (
        <div className="card pad-lg center">
          <div className="big-ico"><HeartPulse size={30} /></div>
          <h2>No vitals yet</h2>
          <p className="muted" style={{ maxWidth: 520, margin: '0 auto 16px' }}>Import a CSV export from a BP cuff, glucometer, smartwatch or ECG device. Columns like <code>timestamp</code>, <code>systolic</code>, <code>diastolic</code>, <code>pulse</code>, <code>glucose</code>, or <code>time_s</code> + <code>ecg_mv</code> are recognised automatically.</p>
          <Link to="/vault/new?demo=1" className="btn primary"><Sparkles size={17} /> Try the sample data</Link>
        </div>
      ) : (
        <>
          <div className="row tight" role="tablist" aria-label="Datasets" style={{ marginBottom: 16 }}>
            {list.map((r) => (
              <button key={r.id} role="tab" aria-selected={r.id === sel} className={`btn sm ${r.id === sel ? 'primary' : ''}`} onClick={() => setSel(r.id)}>
                <Activity size={14} /> {r.title}
              </button>
            ))}
          </div>
          {cur?.vitals && <VitalsView ds={cur.vitals} />}
        </>
      )}
    </>
  );
}
