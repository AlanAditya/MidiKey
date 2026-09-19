import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyRedactions, detect, residualScan, manualFindings } from '../src/lib/pii/engine';

const sample = (n: string) => readFileSync(new URL(`../public/samples/${n}`, import.meta.url), 'utf8');

function redact(text: string, mode: 'balanced' | 'strict' = 'balanced', identifiers: string[] = []) {
  const findings = detect(text, { mode, identifiers });
  return { findings, ...applyRedactions(text, findings) };
}

describe('PII engine — US lab report', () => {
  const t = sample('lab-report-gonzalez.txt');
  const r = redact(t);
  it('removes direct identifiers', () => {
    for (const leak of [
      'Maria Elena Gonzalez', 'Gonzalez', '512-44-9081', '00482913', 'RB-2026-0774412', '(512) 555-0142',
      'maria.gonzalez71@examplemail.com', '1287 Willow Creek', 'BSX9920371145', '03/14/1971', '78745',
    ])
      expect(r.text, leak).not.toContain(leak);
  });
  it('keeps clinical content intact', () => {
    for (const keep of ['Hemoglobin               10.8', 'HbA1c', '7.4', 'microcytic anemia', 'type 2 diabetes mellitus', 'Total Cholesterol'])
      expect(r.text, keep).toContain(keep);
  });
  it('uses one placeholder per person', () => {
    expect(r.text).toMatch(/Patient Name: \[PERSON_1\]/);
    expect(r.text).toMatch(/Mrs\. \[PERSON_1\]/);
  });
  it('leaves clinicians in balanced mode, removes in strict', () => {
    expect(r.text).toContain('Robert Chen');
    const s = redact(t, 'strict');
    expect(s.text).not.toContain('Robert Chen');
    expect(s.text).not.toContain('Helen Park');
    expect(s.text).not.toContain('Riverbend');
    expect(s.text).toMatch(/\[DATE:2026\]/);
  });
  it('residual scan is clean', () => expect(residualScan(r.text, { mode: 'balanced' })).toHaveLength(0));
});

describe('PII engine — regressions', () => {
  it('captures a ZIP that follows a state code in the same address', () => {
    const r = redact('Lab, 4410 Lakeshore Boulevard, Austin, TX 78704\nPhone ok');
    expect(r.text).not.toContain('78704');
    expect(r.text).not.toContain('Lakeshore');
  });
  it('does not suggest a generic report title as a facility', () => {
    const f = detect('COMPREHENSIVE LABORATORY REPORT\nRiverbend Diagnostics Laboratories, x', { mode: 'strict' }).filter((x) => x.category === 'FACILITY');
    expect(f.map((x) => x.text)).toEqual(['Riverbend Diagnostics Laboratories']);
  });
});

describe('PII engine — Indian discharge summary', () => {
  const r = redact(sample('discharge-summary-verma.txt'));
  it('removes Indian identifiers', () => {
    for (const leak of ['RAHUL VERMA', 'Rahul Verma', 'Verma', '4821 7730 1956', 'BQRPV4412K', '98450 12377', 'rahul.verma68@examplemail.in',
      'Palm Meadows', '560102', 'SMH-2026-118843', 'IP/26/004417', 'P/700100/01/2026/003318', 'Sunita', '21 June 1968', '99000 45821'])
      expect(r.text, leak).not.toContain(leak);
  });
  it('keeps clinical content', () => {
    for (const keep of ['Acute coronary syndrome', 'Clopidogrel 75 mg', 'LVEF 45%', '128/82 mmHg', 'troponin I'])
      expect(r.text, keep).toContain(keep);
  });
  it('keeps hospital phone-free but clinical dates in balanced', () => expect(r.text).toContain('12 August 2026'));
  it('residual scan is clean', () => expect(residualScan(r.text, { mode: 'balanced' })).toHaveLength(0));
});

describe('PII engine — cardiology letter (context cues)', () => {
  const r = redact(sample('cardiology-letter-okafor.txt'));
  it('finds names without labels', () => {
    for (const leak of ['Samuel Okafor', 'Okafor', 'Chidinma', '11/02/1958', '7710254', '55 Birchwood', '612-555-0107', 'examplemail.com'])
      expect(r.text, leak).not.toContain(leak);
  });
  it('keeps clinical content', () => {
    for (const keep of ['atrial fibrillation', 'apixaban 5 mg BID', '146/92 mmHg', 'CHA2DS2-VASc score 3'])
      expect(r.text, keep).toContain(keep);
  });
});

describe('PII engine — behaviours', () => {
  it('user identifiers are always scrubbed', () => {
    const r = redact('Ping Aditya Dudeja or aditya@x.io / +91 98765 43210. Mr. Dudeja agrees.', 'balanced', ['Aditya Dudeja', 'aditya@x.io', '9876543210']);
    expect(r.text).not.toMatch(/Aditya|Dudeja|aditya@|98765/);
  });
  it('ages 90+ are aggregated, younger ages kept', () => {
    expect(redact('Age: 93. She is 71 years old.').text).toBe('Age: 90+. She is 71 years old.');
  });
  it('Luhn-valid cards only', () => {
    expect(redact('Card 4111 1111 1111 1111 done').text).toContain('[CARD]');
    expect(redact('Ref 4111 1111 1111 1112 done').text).not.toContain('[CARD]');
  });
  it('does not mangle lab tables / dosing', () => {
    const t = 'Glucose 5.6 mmol/L (3.9-5.6)\nTest Name: Hemoglobin\nDrug Name: Metformin 500 mg BID\nWBC 6.9 x10^3/uL';
    expect(redact(t).text).toBe(t);
  });
  it('manual selection redacts all occurrences', () => {
    const t = 'Employer Acme Corp. Works at Acme Corp daily.';
    const f = manualFindings(t, [], 9, 18, true);
    expect(applyRedactions(t, f).text).toBe('Employer [REDACTED_1]. Works at [REDACTED_1] daily.');
  });
  it('toggled-off findings are not applied', () => {
    const t = 'Call (555) 123-4567 now';
    const f = detect(t, { mode: 'balanced' }).map((x) => ({ ...x, enabled: false }));
    expect(applyRedactions(t, f).text).toBe(t);
  });
});
