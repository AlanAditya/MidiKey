/**
 * Vitals & time-series: CSV parsing, column recognition, statistics and ECG analysis.
 * Runs entirely in the browser; only the parsed numeric series is kept (never the raw file).
 */
import type { VitalsDataset, VitalsSeries } from './types';

// ---------- CSV ----------

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.slice(0, clean.indexOf('\n') > 0 ? clean.indexOf('\n') : undefined);
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (q) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some((x) => x.trim() !== '')) rows.push(row);
  }
  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows };
}

// ---------- column recognition ----------

interface ColSpec {
  key: string;
  label: string;
  unit: string;
  aliases: string[];
}

const COLS: ColSpec[] = [
  { key: 'systolic', label: 'Systolic BP', unit: 'mmHg', aliases: ['systolic', 'sys', 'sbp', 'bpsystolic', 'systolicbp', 'systolicmmhg'] },
  { key: 'diastolic', label: 'Diastolic BP', unit: 'mmHg', aliases: ['diastolic', 'dia', 'dbp', 'bpdiastolic', 'diastolicbp', 'diastolicmmhg'] },
  { key: 'pulse', label: 'Pulse', unit: 'bpm', aliases: ['pulse', 'heartrate', 'hr', 'bpm', 'pulsebpm', 'heartratebpm'] },
  { key: 'resting_hr', label: 'Resting heart rate', unit: 'bpm', aliases: ['restinghr', 'restingheartrate', 'rhr'] },
  { key: 'hrv', label: 'HRV', unit: 'ms', aliases: ['hrv', 'hrvms', 'rmssd', 'heartratevariability'] },
  { key: 'glucose', label: 'Glucose', unit: 'mg/dL', aliases: ['glucose', 'glucosemgdl', 'bloodglucose', 'bg', 'bgmgdl', 'sugar'] },
  { key: 'spo2', label: 'SpO₂', unit: '%', aliases: ['spo2', 'spo2pct', 'oxygen', 'oxygensaturation', 'o2sat', 'bloodoxygen'] },
  { key: 'weight', label: 'Weight', unit: 'kg', aliases: ['weight', 'weightkg', 'bodyweight', 'mass'] },
  { key: 'temp', label: 'Temperature', unit: '°C', aliases: ['temp', 'temperature', 'tempc', 'bodytemp'] },
  { key: 'steps', label: 'Steps', unit: 'steps', aliases: ['steps', 'stepcount'] },
  { key: 'sleep', label: 'Sleep', unit: 'h', aliases: ['sleep', 'sleephours', 'sleepduration'] },
  { key: 'resp', label: 'Respiratory rate', unit: '/min', aliases: ['resp', 'respiratoryrate', 'rr', 'breathrate'] },
];
const TIME_ALIASES = ['timestamp', 'time', 'datetime', 'date', 'dateandtime', 'recordedat', 'starttime', 'startdate', 'measuredat', 'day', 'ts'];
const ECG_ALIASES = ['ecg', 'ecgmv', 'ecgv', 'mv', 'millivolts', 'voltage', 'lead1', 'leadi', 'leadii', 'lead2', 'signal', 'ecgsignal', 'amplitude', 'value'];
const ELAPSED_ALIASES = ['times', 'timesec', 'timeseconds', 'seconds', 'elapsed', 'elapsedtime', 'timems', 'ms', 'sample', 'samples', 'index'];

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

function toNum(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '' || !/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function toTime(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\d{9,13}$/.test(t)) return t.length <= 10 ? Number(t) * 1000 : Number(t);
  const d = Date.parse(t.includes(' ') && !t.includes('T') ? t.replace(' ', 'T') : t);
  return Number.isNaN(d) ? null : d;
}

export interface ParsedVitals {
  dataset: VitalsDataset;
  summary: string;
}

/** Returns null if the CSV doesn't look like vitals/wearable data (so it can be treated as a text record). */
export function parseVitalsCsv(text: string, filename: string): ParsedVitals | null {
  const { headers, rows } = parseCsv(text);
  if (headers.length < 2 || rows.length < 5) return null;
  const nh = headers.map(norm);
  const colVals = (i: number) => rows.map((r) => r[i] ?? '');
  const numericShare = (i: number) => colVals(i).filter((v) => toNum(v) !== null).length / rows.length;

  // --- ECG waveform: elapsed-time column + single signal column, high sample rate
  const elapsedIdx = nh.findIndex((h) => ELAPSED_ALIASES.includes(h));
  const ecgIdx = nh.findIndex((h, i) => ECG_ALIASES.includes(h) && i !== elapsedIdx && numericShare(i) > 0.9);
  if (ecgIdx >= 0 && rows.length >= 250) {
    let t: number[] | null = null;
    let sampleRate = 0;
    if (elapsedIdx >= 0 && numericShare(elapsedIdx) > 0.9) {
      const raw = colVals(elapsedIdx).map((v) => toNum(v) ?? NaN);
      const scale = nh[elapsedIdx].endsWith('ms') ? 1000 : 1;
      const secs = raw.map((v) => v / scale);
      const dts = secs.slice(1).map((v, i) => v - secs[i]).filter((d) => d > 0).sort((a, b) => a - b);
      if (dts.length) {
        sampleRate = Math.round(1 / dts[Math.floor(dts.length / 2)]);
        t = secs.map((v) => v - secs[0]);
      }
    } else {
      const ti = nh.findIndex((h) => TIME_ALIASES.includes(h));
      if (ti >= 0) {
        const ms = colVals(ti).map((v) => toTime(v) ?? NaN);
        const dts = ms.slice(1).map((v, i) => v - ms[i]).filter((d) => d > 0).sort((a, b) => a - b);
        if (dts.length) {
          sampleRate = Math.round(1000 / dts[Math.floor(dts.length / 2)]);
          t = ms.map((v) => (v - ms[0]) / 1000);
        }
      }
    }
    if (t && sampleRate >= 50 && sampleRate <= 2000) {
      const values = colVals(ecgIdx).map((v) => toNum(v));
      const dataset: VitalsDataset = {
        type: 'ecg',
        t,
        sampleRate,
        source: filename,
        series: [{ key: 'ecg', label: 'ECG', unit: 'mV', values }],
      };
      const a = analyzeEcg(dataset);
      const summary =
        `ECG waveform from ${filename}: ${(t[t.length - 1]).toFixed(1)} s at ${sampleRate} Hz. ` +
        (a ? `Detected ${a.peaks.length} beats; mean heart rate ${a.meanHr.toFixed(0)} bpm; HRV (RMSSD) ${a.rmssd.toFixed(0)} ms; SDNN ${a.sdnn.toFixed(0)} ms. ${a.irregular ? 'RR intervals are irregular.' : 'RR intervals are regular.'}` : '');
      return { dataset, summary };
    }
  }

  // --- time series
  const timeIdx = nh.findIndex((h) => TIME_ALIASES.includes(h) && colVals(nh.indexOf(h)).filter((v) => toTime(v) !== null).length / rows.length > 0.9);
  if (timeIdx < 0) return null;
  const t = colVals(timeIdx).map((v) => toTime(v));
  const order = t.map((v, i) => [v, i] as const).filter(([v]) => v !== null).sort((a, b) => a[0]! - b[0]!).map(([, i]) => i);
  if (order.length < 5) return null;

  const series: VitalsSeries[] = [];
  const used = new Set<number>([timeIdx]);
  for (const spec of COLS) {
    const i = nh.findIndex((h, idx) => !used.has(idx) && spec.aliases.includes(h));
    if (i < 0 || numericShare(i) < 0.6) continue;
    used.add(i);
    const unit = spec.unit;
    series.push({ key: spec.key, label: spec.label, unit, values: order.map((r) => toNum(rows[r][i] ?? '')) });
  }
  headers.forEach((h, i) => {
    if (used.has(i) || series.length >= 10 || numericShare(i) < 0.8) return;
    // skip anything that looks like an identifier column
    if (/id|name|patient|phone|mrn/.test(nh[i])) return;
    series.push({ key: nh[i], label: h, unit: '', values: order.map((r) => toNum(rows[r][i] ?? '')) });
  });
  if (!series.length) return null;

  const dataset: VitalsDataset = { type: 'timeseries', t: order.map((r) => t[r]!), series, source: filename };
  return { dataset, summary: summarizeVitals(dataset) };
}

// ---------- statistics ----------

export interface SeriesStats {
  n: number;
  mean: number;
  min: number;
  max: number;
  latest: number;
  /** change per day (least-squares) */
  slopePerDay: number;
  sd: number;
}

export function seriesStats(t: number[], values: (number | null)[]): SeriesStats | null {
  const pts: [number, number][] = [];
  values.forEach((v, i) => {
    if (v !== null) pts.push([t[i], v]);
  });
  if (!pts.length) return null;
  const n = pts.length;
  const mean = pts.reduce((a, p) => a + p[1], 0) / n;
  const sd = Math.sqrt(pts.reduce((a, p) => a + (p[1] - mean) ** 2, 0) / n);
  const tm = pts.reduce((a, p) => a + p[0], 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of pts) {
    num += (x - tm) * (y - mean);
    den += (x - tm) ** 2;
  }
  const slopePerMs = den ? num / den : 0;
  return {
    n,
    mean,
    min: Math.min(...pts.map((p) => p[1])),
    max: Math.max(...pts.map((p) => p[1])),
    latest: pts[pts.length - 1][1],
    slopePerDay: slopePerMs * 86400000,
    sd,
  };
}

export type BpClass = 'Normal' | 'Elevated' | 'Stage 1 hypertension' | 'Stage 2 hypertension' | 'Hypertensive crisis';
export function classifyBp(sys: number, dia: number): { label: BpClass; tone: 'ok' | 'warn' | 'bad' } {
  if (sys > 180 || dia > 120) return { label: 'Hypertensive crisis', tone: 'bad' };
  if (sys >= 140 || dia >= 90) return { label: 'Stage 2 hypertension', tone: 'bad' };
  if (sys >= 130 || dia >= 80) return { label: 'Stage 1 hypertension', tone: 'warn' };
  if (sys >= 120) return { label: 'Elevated', tone: 'warn' };
  return { label: 'Normal', tone: 'ok' };
}

/** Reference bands (green zone) per series key, used to shade charts. */
export const NORMAL_BANDS: Record<string, [number, number]> = {
  systolic: [90, 119],
  diastolic: [60, 79],
  pulse: [60, 100],
  resting_hr: [50, 90],
  glucose: [70, 140],
  spo2: [95, 100],
  temp: [36.1, 37.5],
  hrv: [20, 100],
};

export function summarizeVitals(ds: VitalsDataset): string {
  const days = ((ds.t[ds.t.length - 1] - ds.t[0]) / 86400000).toFixed(0);
  const from = new Date(ds.t[0]).toISOString().slice(0, 10);
  const to = new Date(ds.t[ds.t.length - 1].valueOf()).toISOString().slice(0, 10);
  const parts = [`Vitals / wearable data from ${ds.source}: ${ds.t.length} readings over ${days} days (${from} to ${to}).`];
  for (const s of ds.series) {
    const st = seriesStats(ds.t, s.values);
    if (!st) continue;
    const trend = Math.abs(st.slopePerDay * Number(days)) < st.sd * 0.5 ? 'stable' : st.slopePerDay > 0 ? 'rising' : 'falling';
    parts.push(`${s.label}: mean ${fmt(st.mean)} ${s.unit}, range ${fmt(st.min)}–${fmt(st.max)}, latest ${fmt(st.latest)} (${trend}).`);
  }
  const sys = ds.series.find((s) => s.key === 'systolic');
  const dia = ds.series.find((s) => s.key === 'diastolic');
  if (sys && dia) {
    const a = seriesStats(ds.t, sys.values);
    const b = seriesStats(ds.t, dia.values);
    if (a && b) parts.push(`Average blood pressure ${a.mean.toFixed(0)}/${b.mean.toFixed(0)} mmHg — ${classifyBp(a.mean, b.mean).label}.`);
  }
  return parts.join(' ');
}

export const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2)).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1');

// ---------- ECG analysis ----------

export interface EcgAnalysis {
  peaks: number[]; // sample indices
  rr: number[]; // seconds
  meanHr: number;
  sdnn: number;
  rmssd: number;
  irregular: boolean;
}

export function analyzeEcg(ds: VitalsDataset): EcgAnalysis | null {
  const fs = ds.sampleRate ?? 250;
  const raw = ds.series[0].values.map((v) => v ?? 0);
  const n = raw.length;
  if (n < fs * 3) return null;

  // remove baseline wander with a ~0.6 s moving average
  const win = Math.max(3, Math.round(fs * 0.6));
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + raw[i];
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - (win >> 1));
    const b = Math.min(n, i + (win >> 1) + 1);
    x[i] = raw[i] - (cs[b] - cs[a]) / (b - a);
  }
  // squared derivative + moving-window integration (Pan–Tompkins style)
  const d = new Float64Array(n);
  for (let i = 2; i < n - 2; i++) d[i] = (-x[i - 2] - 2 * x[i - 1] + 2 * x[i + 1] + x[i + 2]) / 8;
  const sq = d.map((v) => v * v);
  const iw = Math.max(2, Math.round(fs * 0.12));
  const integ = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += sq[i];
    if (i >= iw) acc -= sq[i - iw];
    integ[i] = acc / iw;
  }
  const maxI = integ.reduce((m, v) => Math.max(m, v), 0);
  if (maxI === 0) return null;
  const thr = maxI * 0.3;
  const refractory = Math.round(fs * 0.25);
  const peaks: number[] = [];
  let i = 0;
  while (i < n) {
    if (integ[i] > thr) {
      let j = i;
      while (j < n && integ[j] > thr) j++;
      // R peak = max |x| in the window
      let best = i;
      const lo = Math.max(0, i - iw);
      const hi = Math.min(n, j + iw);
      for (let k = lo; k < hi; k++) if (Math.abs(x[k]) > Math.abs(x[best])) best = k;
      if (!peaks.length || best - peaks[peaks.length - 1] > refractory) peaks.push(best);
      i = j;
    } else i++;
  }
  if (peaks.length < 3) return null;
  const rr = peaks.slice(1).map((p, k) => (p - peaks[k]) / fs);
  const meanRr = rr.reduce((a, b) => a + b, 0) / rr.length;
  const sdnn = Math.sqrt(rr.reduce((a, b) => a + (b - meanRr) ** 2, 0) / rr.length) * 1000;
  const diffs = rr.slice(1).map((v, k) => v - rr[k]);
  const rmssd = diffs.length ? Math.sqrt(diffs.reduce((a, b) => a + b * b, 0) / diffs.length) * 1000 : 0;
  const cv = (sdnn / 1000) / meanRr;
  return { peaks, rr, meanHr: 60 / meanRr, sdnn, rmssd, irregular: cv > 0.15 };
}
