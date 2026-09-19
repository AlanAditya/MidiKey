import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyRedactions, detect } from '../src/lib/pii/engine';
import { answer, allLabs } from '../src/lib/copilot/rag';
import type { HealthRecord } from '../src/lib/types';

const mk = (file: string, id: string, title: string): HealthRecord => {
  const t = readFileSync(new URL(`../public/samples/${file}`, import.meta.url), 'utf8');
  return { id, title, kind: 'lab', createdAt: 1, source: { filename: file, mime: 'text/plain', size: t.length, method: 'text' }, text: applyRedactions(t, detect(t, { mode: 'balanced' })).text, redaction: { mode: 'balanced', total: 0, counts: {} } };
};
const records = [mk('lab-report-gonzalez.txt', 'a', 'Lab report'), mk('discharge-summary-verma.txt', 'b', 'Discharge'), mk('cardiology-letter-okafor.txt', 'c', 'Cardiology letter')];

describe('copilot', () => {
  it('parses lab rows with flags and reference ranges', () => {
    const labs = allLabs(records);
    const hb = labs.find((l) => l.name === 'Hemoglobin')!;
    expect(hb).toMatchObject({ value: 10.8, flag: 'low', low: 12, high: 15.5 });
    expect(labs.find((l) => l.name === 'TSH')!.flag).toBe('normal');
    expect(labs.find((l) => l.name === 'HbA1c')!.flag).toBe('high');
    expect(labs.length).toBeGreaterThanOrEqual(15);
  });
  it('lists abnormal results', () => {
    const a = answer('Which results are abnormal?', records);
    expect(a.blocks.some((b) => b.t === 'labs')).toBe(true);
    expect(a.sources.length).toBeGreaterThan(0);
  });
  it('lists medicines with plain explanations', () => {
    const a = answer('what medicines am I taking?', records);
    const ul = a.blocks.find((b) => b.t === 'ul');
    expect(JSON.stringify(ul)).toMatch(/Clopidogrel/);
    expect(JSON.stringify(ul)).toMatch(/Statin|cholesterol/i);
  });
  it('explains jargon and falls back to retrieval with citations', () => {
    expect(JSON.stringify(answer('what is HbA1c?', records).blocks)).toMatch(/average blood sugar/);
    const a = answer('atrial fibrillation stroke risk', records);
    expect(a.sources.map((s) => s.id)).toContain('c');
  });

  it('never dead-ends on a supported vault: every answer is grounded, cited, and non-empty', () => {
    // The exact phrasing that used to fall through to "I could not find that in your records".
    const questions = [
      'should i visit the doctor again',
      'do I need to see a doctor?',
      'is it serious?',
      'is this normal',
      'am I okay',
      "I'm worried about my results",
      'what should i do',
      'how am I doing',
      'am I healthy',
      'is everything fine',
      'can you check my numbers',
      'random gibberish that matches nothing at all',
    ];
    for (const q of questions) {
      const a = answer(q, records);
      expect(a.title, q).not.toMatch(/^I could not find that in your records$/);
      expect(a.blocks.length, q).toBeGreaterThan(1); // more than just the disclaimer
      expect(a.sources.length, q).toBeGreaterThan(0);
    }
  });

  it('a "should I" question gives grounded context and an explicit non-advice disclaimer, not a diagnosis', () => {
    const a = answer('should i visit the doctor again', records);
    const text = JSON.stringify(a.blocks);
    expect(text).toMatch(/isn't something I can decide|can't tell you/i);
    expect(a.blocks.some((b) => b.t === 'labs')).toBe(true); // grounded in the actual abnormal labs
  });

  it('still routes clear intents correctly alongside the new advice/fallback logic', () => {
    expect(answer('Which results are abnormal?', records).blocks.some((b) => b.t === 'labs')).toBe(true);
    expect(JSON.stringify(answer('what medicines am I taking?', records).blocks)).toMatch(/Clopidogrel/);
    expect(answer('give me a summary of my health', records).title).toBe('Your health at a glance');
  });
});
