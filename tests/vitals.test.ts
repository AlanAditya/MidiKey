import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeEcg, parseVitalsCsv, seriesStats } from '../src/lib/vitals';

const sample = (n: string) => readFileSync(new URL(`../public/samples/${n}`, import.meta.url), 'utf8');

describe('vitals parsing', () => {
  it('parses BP/glucose log', () => {
    const p = parseVitalsCsv(sample('bp-glucose-log.csv'), 'bp.csv')!;
    expect(p.dataset.type).toBe('timeseries');
    expect(p.dataset.series.map((s) => s.key)).toEqual(['systolic', 'diastolic', 'pulse', 'glucose', 'weight']);
    expect(p.dataset.t).toHaveLength(90);
    const sys = seriesStats(p.dataset.t, p.dataset.series[0].values)!;
    expect(sys.slopePerDay).toBeLessThan(0); // improving trend
    expect(p.summary).toMatch(/Stage/);
  });
  it('parses wearable export', () => {
    const p = parseVitalsCsv(sample('wearable-daily.csv'), 'w.csv')!;
    expect(p.dataset.series.map((s) => s.key).sort()).toEqual(['hrv', 'resting_hr', 'sleep', 'spo2', 'steps']);
    expect(p.dataset.series.length).toBe(5);
  });
  it('detects ECG and R peaks (~72 bpm)', () => {
    const p = parseVitalsCsv(sample('ecg-10s-250hz.csv'), 'ecg.csv')!;
    expect(p.dataset.type).toBe('ecg');
    expect(p.dataset.sampleRate).toBe(250);
    const a = analyzeEcg(p.dataset)!;
    expect(a.meanHr).toBeGreaterThan(65);
    expect(a.meanHr).toBeLessThan(80);
    expect(a.peaks.length).toBeGreaterThanOrEqual(10);
    expect(a.irregular).toBe(false);
  });
  it('rejects non-vitals CSV', () => {
    expect(parseVitalsCsv('name,notes\nA,b\nC,d\nE,f\nG,h\nI,j\n', 'x.csv')).toBeNull();
  });
});
