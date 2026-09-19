import { useMemo, useRef, useState } from 'react';

export interface LineSeries {
  label: string;
  color: string;
  values: (number | null)[];
  unit?: string;
}

const niceTicks = (min: number, max: number, n = 5) => {
  const span = max - min || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(6));
  return { lo, hi, ticks };
};

const fmtT = (t: number, span: number) => {
  const d = new Date(t);
  return span > 3 * 86400000 ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

export function LineChart({ t, series, band, height = 260, ariaLabel }: { t: number[]; series: LineSeries[]; band?: [number, number]; height?: number; ariaLabel: string }) {
  const W = 760;
  const H = height;
  const pad = { l: 44, r: 14, t: 12, b: 26 };
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const { x, y, ticks, xTicks } = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    let mn = Math.min(...all, band?.[0] ?? Infinity);
    let mx = Math.max(...all, band?.[1] ?? -Infinity);
    if (!isFinite(mn)) (mn = 0), (mx = 1);
    const tk = niceTicks(mn - (mx - mn) * 0.05, mx + (mx - mn) * 0.05);
    const t0 = t[0];
    const t1 = t[t.length - 1] || t0 + 1;
    const xs = (v: number) => pad.l + ((v - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
    const ys = (v: number) => pad.t + (1 - (v - tk.lo) / (tk.hi - tk.lo || 1)) * (H - pad.t - pad.b);
    return { x: xs, y: ys, ticks: tk.ticks, xTicks: Array.from({ length: 5 }, (_, i) => t0 + ((t1 - t0) * i) / 4) };
  }, [t, series, band, H]);

  const span = (t[t.length - 1] ?? 0) - (t[0] ?? 0);
  const paths = series.map((s) => {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(t[i]).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    let bd = Infinity;
    t.forEach((v, i) => {
      const d = Math.abs(x(v) - px);
      if (d < bd) (bd = d), (best = i);
    });
    setHover(best);
  };

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {band && <rect x={pad.l} width={W - pad.l - pad.r} y={y(band[1])} height={Math.max(0, y(band[0]) - y(band[1]))} fill="var(--ok)" opacity="0.1" />}
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end">{v}</text>
          </g>
        ))}
        {xTicks.map((v, i) => (
          <text key={i} x={x(v)} y={H - 6} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{fmtT(v, span)}</text>
        ))}
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={series[i].color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {t.length <= 120 && series.map((s, si) => s.values.map((v, i) => (v === null ? null : <circle key={`${si}-${i}`} cx={x(t[i])} cy={y(v)} r="2.3" fill={s.color} />)))}
        {hover !== null && (
          <g>
            <line x1={x(t[hover])} x2={x(t[hover])} y1={pad.t} y2={H - pad.b} stroke="var(--muted)" strokeDasharray="3 3" />
            {series.map((s, i) => (s.values[hover] == null ? null : <circle key={i} cx={x(t[hover])} cy={y(s.values[hover]!)} r="4.5" fill={s.color} stroke="var(--bg)" strokeWidth="2" />))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `min(calc(${(x(t[hover]) / W) * 100}% + 12px), calc(100% - 190px))`, top: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>{new Date(t[hover]).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</div>
          {series.map((s) => (
            <div key={s.label}>
              <span style={{ color: s.color }}>●</span> {s.label}: <b>{s.values[hover] ?? '—'}</b> {s.unit}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EcgChart({ values, fs, peaks, start, windowSec }: { values: (number | null)[]; fs: number; peaks: number[]; start: number; windowSec: number }) {
  const W = 900;
  const H = 260;
  const i0 = Math.floor(start * fs);
  const i1 = Math.min(values.length, Math.floor((start + windowSec) * fs));
  const seg = values.slice(i0, i1).map((v) => v ?? 0);
  const mn = Math.min(...seg, -0.6);
  const mx = Math.max(...seg, 1.2);
  const x = (i: number) => ((i - i0) / (windowSec * fs)) * W;
  const y = (v: number) => H - 14 - ((v - mn) / (mx - mn)) * (H - 28);
  // downsample to <= 2 points per pixel
  const stride = Math.max(1, Math.floor(seg.length / (W * 2)));
  let d = '';
  for (let k = 0; k < seg.length; k += stride) d += `${k ? 'L' : 'M'}${x(i0 + k).toFixed(1)},${y(seg[k]).toFixed(1)}`;
  const small = 0.04 * fs;
  const gridX: number[] = [];
  for (let s = 0; s <= windowSec * fs; s += small) gridX.push(s);
  const gridY: number[] = [];
  for (let v = Math.ceil(mn * 10) / 10; v <= mx; v += 0.1) gridY.push(+v.toFixed(2));
  return (
    <svg className="chart ecg-paper" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="ECG waveform with detected R-peaks">
      {gridX.map((s, k) => (
        <line key={k} x1={(s / (windowSec * fs)) * W} x2={(s / (windowSec * fs)) * W} y1={0} y2={H} stroke="#ff8a8a" strokeOpacity={k % 5 === 0 ? 0.26 : 0.08} strokeWidth={k % 5 === 0 ? 1 : 0.6} />
      ))}
      {gridY.map((v) => (
        <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="#ff8a8a" strokeOpacity={Math.abs((v * 10) % 5) < 0.01 ? 0.26 : 0.08} strokeWidth={Math.abs((v * 10) % 5) < 0.01 ? 1 : 0.6} />
      ))}
      <path d={d} fill="none" stroke="var(--accent-2)" strokeWidth="1.6" strokeLinejoin="round" />
      {peaks.filter((p) => p >= i0 && p < i1).map((p) => (
        <g key={p}>
          <circle cx={x(p)} cy={y(values[p] ?? 0) - 8} r="4" fill="var(--danger)" />
          <text x={x(p)} y={y(values[p] ?? 0) - 16} textAnchor="middle" style={{ fill: 'var(--danger)', fontSize: 10, fontWeight: 700 }}>R</text>
        </g>
      ))}
    </svg>
  );
}
