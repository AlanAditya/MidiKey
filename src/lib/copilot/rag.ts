/**
 * On-device Retrieval-Augmented Generation.
 *  retrieve  : BM25 over paragraph chunks of the patient's *sanitised* records (in memory only)
 *  generate  : deterministic, template-driven plain-language answers grounded in retrieved text,
 *              with citations. No network. Optionally polished by the browser's built-in on-device
 *              model (Chrome Prompt API) if present — still local.
 */
import type { HealthRecord } from '../types';
import { classifyBp, fmt, seriesStats } from '../vitals';
import { DRUGS, findTerms, lookupTerm, type Hit } from './glossary';
import { parseLabs, type LabResult } from './labs';

export interface Chunk {
  recordId: string;
  title: string;
  text: string;
  tokens: string[];
}

const STOP = new Set('a an the and or of to in on for with is are was were be been it this that at by from as my me i what which who how do does did can could should would about tell show please any all have has had'.split(' '));
const SYN: Record<string, string[]> = {
  sugar: ['glucose', 'diabetes', 'hba1c'],
  diabetes: ['glucose', 'hba1c', 'metformin'],
  cholesterol: ['ldl', 'hdl', 'lipid', 'triglycerides', 'statin'],
  bp: ['blood', 'pressure', 'hypertension', 'systolic'],
  pressure: ['hypertension', 'bp', 'systolic'],
  heart: ['cardiac', 'coronary', 'ecg', 'lvef', 'troponin'],
  kidney: ['creatinine', 'egfr'],
  thyroid: ['tsh'],
  anemia: ['hemoglobin', 'iron', 'ferritin', 'hematocrit'],
  iron: ['ferritin', 'hemoglobin', 'mcv'],
  medicine: ['medication', 'mg', 'daily'],
  meds: ['medication', 'mg', 'daily'],
  pill: ['medication', 'mg'],
  lung: ['asthma', 'spirometry', 'fev1', 'cough'],
  breathing: ['asthma', 'spirometry', 'spo2'],
};

export const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9%./ -]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.\-/]+|[.\-/]+$/g, ''))
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t));

export function chunkRecords(records: HealthRecord[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const r of records) {
    const paras = r.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let buf = '';
    const flush = () => {
      if (buf.trim()) chunks.push({ recordId: r.id, title: r.title, text: buf.trim(), tokens: tokenize(r.title + ' ' + buf) });
      buf = '';
    };
    for (const p of paras) {
      if (buf.length + p.length > 700) flush();
      buf += (buf ? '\n\n' : '') + p;
    }
    flush();
  }
  return chunks;
}

export function retrieve(query: string, chunks: Chunk[], k = 4): (Chunk & { score: number })[] {
  const q = [...new Set(tokenize(query).flatMap((t) => [t, ...(SYN[t] ?? [])]))];
  if (!q.length || !chunks.length) return [];
  const N = chunks.length;
  const avg = chunks.reduce((a, c) => a + c.tokens.length, 0) / N;
  const df = new Map<string, number>();
  for (const c of chunks) for (const t of new Set(c.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const k1 = 1.4;
  const b = 0.75;
  return chunks
    .map((c) => {
      const tf = new Map<string, number>();
      c.tokens.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
      let score = 0;
      for (const t of q) {
        const f = tf.get(t) ?? 0;
        if (!f) continue;
        const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * c.tokens.length) / avg));
      }
      return { ...c, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---------------------------------------------------------------------------

export type Block =
  | { t: 'p'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'labs'; rows: LabResult[] }
  | { t: 'terms'; terms: Hit[] }
  | { t: 'quote'; text: string; source: string }
  | { t: 'note'; text: string };

export interface Answer {
  title: string;
  blocks: Block[];
  sources: { id: string; title: string }[];
}

const DISCLAIMER = 'MediKey Copilot explains your own records in plain language. It is not a doctor and cannot diagnose — discuss anything that worries you with a clinician.';

export function allLabs(records: HealthRecord[]): LabResult[] {
  return records.flatMap((r) => parseLabs(r.text, r.id, r.title));
}

function sectionLines(text: string, heading: RegExp, maxLines = 12): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!heading.test(lines[i])) continue;
    const inline = lines[i].replace(heading, '').replace(/^[\s:.-]+/, '').trim();
    if (inline) out.push(inline);
    for (let j = i + 1; j < lines.length && out.length < maxLines; j++) {
      const l = lines[j].trim();
      if (!l) {
        if (out.length) break;
        continue;
      }
      if (/^[A-Z][A-Z /&-]{4,}$/.test(l)) break;
      out.push(l);
    }
  }
  return out;
}

function medications(records: HealthRecord[]): { line: string; recordId: string; title: string }[] {
  const out: { line: string; recordId: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    const lines = [
      ...sectionLines(r.text, /^(?:discharge\s+)?medications?\b/i, 14),
      ...r.text.split('\n').filter((l) => /\b\d+(?:\.\d+)?\s?(?:mg|mcg|µg|ml)\b/i.test(l) && DRUGS.some((d) => d.match.test(l))),
    ];
    for (const raw of lines) {
      const line = raw.replace(/^\s*\d+[.)]\s*/, '').trim();
      const parts = /^(?:current medications?:\s*)/i.test(line) ? line.replace(/^current medications?:\s*/i, '').split(/,\s*|\s+and\s+/) : [line];
      for (const p of parts) {
        const l = p.trim().replace(/\.$/, '');
        if (l.length < 4 || !DRUGS.some((d) => d.match.test(l)) || seen.has(l.toLowerCase())) continue;
        seen.add(l.toLowerCase());
        out.push({ line: l, recordId: r.id, title: r.title });
      }
    }
  }
  return out;
}

function vitalsAnswer(records: HealthRecord[]): Block[] {
  const blocks: Block[] = [];
  for (const r of records.filter((x) => x.vitals && x.vitals.type === 'timeseries')) {
    const ds = r.vitals!;
    const items: string[] = [];
    for (const s of ds.series) {
      const st = seriesStats(ds.t, s.values);
      if (!st) continue;
      const days = Math.max(1, (ds.t[ds.t.length - 1] - ds.t[0]) / 86400000);
      const change = st.slopePerDay * days;
      const trend = Math.abs(change) < Math.max(st.sd * 0.6, 0.02 * Math.abs(st.mean)) ? 'has stayed steady' : change > 0 ? `has risen by about ${fmt(Math.abs(change))}` : `has fallen by about ${fmt(Math.abs(change))}`;
      items.push(`${s.label}: average ${fmt(st.mean)} ${s.unit}, latest ${fmt(st.latest)}; ${trend} over ${days.toFixed(0)} days.`);
    }
    const sys = ds.series.find((s) => s.key === 'systolic');
    const dia = ds.series.find((s) => s.key === 'diastolic');
    if (sys && dia) {
      const a = seriesStats(ds.t, sys.values);
      const b = seriesStats(ds.t, dia.values);
      if (a && b) items.unshift(`Average blood pressure is ${a.mean.toFixed(0)}/${b.mean.toFixed(0)} mmHg, which falls in the "${classifyBp(a.mean, b.mean).label}" range.`);
    }
    blocks.push({ t: 'p', text: `From “${r.title}”:` }, { t: 'ul', items });
  }
  for (const r of records.filter((x) => x.vitals?.type === 'ecg')) blocks.push({ t: 'p', text: `“${r.title}”: ${r.text}` });
  return blocks;
}

/** Shared by the explicit "summarize" intent and the last-resort fallback, so a miss never comes back empty-handed. */
function snapshotBlocks(records: HealthRecord[], labs: LabResult[], abnormal: LabResult[], cite: (id: string, title: string) => void): Block[] {
  const blocks: Block[] = [];
  for (const r of records.filter((x) => !x.vitals)) {
    cite(r.id, r.title);
    const dx = [...sectionLines(r.text, /^(?:discharge\s+)?diagnos[ie]s\b/i, 6), ...sectionLines(r.text, /^(?:assessment|interpretation|impression)\b/i, 4)];
    const plain = findTerms(dx.join(' '), 6);
    blocks.push({ t: 'p', text: `${r.title}${r.date ? ` (${r.date})` : ''}` });
    if (dx.length) blocks.push({ t: 'quote', text: dx.slice(0, 5).join(' '), source: r.title });
    if (plain.length) blocks.push({ t: 'terms', terms: plain });
  }
  if (abnormal.length) blocks.push({ t: 'p', text: `Out-of-range labs: ${abnormal.map((l) => `${l.name} ${l.value}${l.unit ? ' ' + l.unit : ''} (${l.flag})`).join(', ')}.` });
  else if (labs.length) blocks.push({ t: 'p', text: `All ${labs.length} parsed lab values are within their printed reference range.` });
  const meds = medications(records);
  if (meds.length) blocks.push({ t: 'p', text: `Medicines mentioned: ${meds.map((m) => m.line).join('; ')}.` });
  blocks.push(...vitalsAnswer(records));
  records.filter((r) => r.vitals).forEach((r) => cite(r.id, r.title));
  return blocks;
}

// Trigger phrasing per intent. Checked as plain substrings against the raw lower-cased question, so
// word order and punctuation don't matter. Several (medic, prescri, drug…) are deliberate word
// *stems*, meant to match inside "medicine(s)/medication", "prescribed/prescription" etc. — do not
// wrap the whole alternation in \b...\b, since the trailing \b would break that prefix matching.
const RE = {
  abnormal: /abnormal|out.of.range|flagged|flag\b|wrong|too high|too low|\bhigh\b|\blow\b/,
  advice: /should i|do i need|is it (?:serious|normal|okay|ok|fine|safe|dangerous|urgent)|is this (?:serious|normal|okay|ok|fine|safe|dangerous|urgent)|am i (?:ok\b|okay|fine|alright)|(?:worried|worry|concerned|anxious) about|need(?:s)? to (?:see|visit|call)|(?:see|visit|call|go to) (?:a |the |my )?(?:doctor|physician|clinic|er\b|emergency)|(?:go to|visit) the hospital|book (?:a|an) appointment|follow[- ]?up appointment|check[- ]?up|is (?:my|this) .* (?:serious|normal|okay|ok|dangerous)|what should i do/,
  summary: /summar|overview|tell me about my|my health|how am i doing|am i healthy\b|everything|recap|whole picture|all my/,
  meds: /medic|drug|prescri|pill|dose|dosage|tablet|what am i taking|am i on\b/,
  vitals: /blood pressure|\bbp\b|heart rate|pulse|glucose trend|sugar trend|weight|trend|vitals|ecg|hrv|steps|sleep|oxygen|spo2/,
  define: /^(?:what(?:'s| is| does| are)?|explain|define|meaning of)\b/,
};

export function answer(query: string, records: HealthRecord[]): Answer {
  const q = query.toLowerCase().trim();
  const sources = new Map<string, string>();
  const cite = (id: string, title: string) => sources.set(id, title);
  const blocks: Block[] = [];
  let title = 'Here is what your records say';

  if (!records.length) {
    return { title: 'Nothing to read yet', blocks: [{ t: 'p', text: 'Add a record to your vault first — I only read what is stored on this device.' }], sources: [] };
  }

  const labs = allLabs(records);
  const abnormal = labs.filter((l) => l.flag !== 'normal');

  if (RE.abnormal.test(q) && !/blood pressure|\bbp\b/.test(q)) {
    title = abnormal.length ? `${abnormal.length} result${abnormal.length > 1 ? 's' : ''} outside the reference range` : 'All parsed lab values are in range';
    if (abnormal.length) {
      blocks.push({ t: 'p', text: 'These values were outside the lab\'s reference range. A single out-of-range value is not a diagnosis — your clinician looks at the whole picture.' }, { t: 'labs', rows: abnormal });
      abnormal.forEach((l) => cite(l.recordId, l.recordTitle));
    } else blocks.push({ t: 'p', text: 'I could not find any lab values outside their printed reference ranges.' });
  } else if (RE.advice.test(q)) {
    // A "should I…" / "is this serious" question has no factual answer we can look up — we ground
    // whatever context exists instead of either fabricating advice or dead-ending.
    title = 'I can\'t tell you that — here\'s what your records show';
    blocks.push({ t: 'p', text: 'Whether to see a clinician isn\'t something I can decide from your records — especially for new or worsening symptoms, when in doubt, reach out to one. Here is the relevant context on this device:' });
    if (abnormal.length) {
      blocks.push({ t: 'labs', rows: abnormal });
      abnormal.forEach((l) => cite(l.recordId, l.recordTitle));
    } else if (labs.length) {
      blocks.push({ t: 'p', text: `Nothing in your ${labs.length} parsed lab values is flagged outside its reference range right now.` });
    }
    const vitalsRecords = records.filter((r) => r.vitals);
    if (vitalsRecords.length) {
      blocks.push(...vitalsAnswer(records));
      vitalsRecords.forEach((r) => cite(r.id, r.title));
    }
    const meds = medications(records);
    if (meds.length) blocks.push({ t: 'p', text: `You're recorded as taking: ${meds.map((m) => m.line).join('; ')}.` });
    if (!abnormal.length && !vitalsRecords.length && !meds.length) blocks.push({ t: 'p', text: 'I don\'t have anything specific flagged in your stored records to go on here.' });
  } else if (RE.summary.test(q)) {
    title = 'Your health at a glance';
    blocks.push(...snapshotBlocks(records, labs, abnormal, cite));
  } else if (RE.meds.test(q)) {
    const meds = medications(records);
    title = meds.length ? 'Medicines found in your records' : 'No medicines found';
    if (meds.length) {
      blocks.push({
        t: 'ul',
        items: meds.map((m) => {
          cite(m.recordId, m.title);
          const d = DRUGS.find((x) => x.match.test(m.line));
          return `${m.line}${d ? ` — ${d.name}: ${d.plain}` : ''}`;
        }),
      });
      blocks.push({ t: 'note', text: 'Never change or stop a medicine without asking the clinician who prescribed it.' });
    } else blocks.push({ t: 'p', text: 'I could not find a medication list in the records on this device.' });
  } else if (RE.vitals.test(q) && records.some((r) => r.vitals)) {
    title = 'Your vitals';
    blocks.push(...vitalsAnswer(records));
    records.filter((r) => r.vitals).forEach((r) => cite(r.id, r.title));
  } else if (RE.define.test(q)) {
    const target = q.replace(/^(?:what(?:'s| is| does| are)?|explain|define|meaning of)\s+(?:a |an |the |my )?/, '').replace(/\s+mean\??$|\?$/g, '').trim();
    const t = lookupTerm(target);
    if (t) {
      title = t.term;
      blocks.push({ t: 'p', text: t.plain });
    } else {
      const lab = labs.find((l) => l.name.toLowerCase().includes(target));
      if (lab) {
        title = lab.name;
        blocks.push({ t: 'labs', rows: [lab] });
        cite(lab.recordId, lab.recordTitle);
      }
    }
  }

  if (!blocks.length) {
    const hits = retrieve(query, chunkRecords(records), 3);
    if (hits.length) {
      hits.forEach((h) => cite(h.recordId, h.title));
      blocks.push({ t: 'p', text: 'These passages from your records are the most relevant to your question:' });
      for (const h of hits) blocks.push({ t: 'quote', text: h.text.length > 420 ? h.text.slice(0, 420) + '…' : h.text, source: h.title });
      const terms = findTerms(hits.map((h) => h.text).join(' '), 8);
      if (terms.length) blocks.push({ t: 'p', text: 'In plain language:' }, { t: 'terms', terms });
    } else {
      // Last resort: never dead-end when there is data on the device — ground the answer in a
      // snapshot instead of a bare "not found", which reads as broken when records do exist.
      title = 'I couldn\'t match that exactly — here\'s an overview instead';
      blocks.push({ t: 'p', text: 'I couldn\'t find a specific answer to that question, but here is what is stored on this device:' });
      blocks.push(...snapshotBlocks(records, labs, abnormal, cite));
    }
  }
  blocks.push({ t: 'note', text: DISCLAIMER });
  return { title, blocks, sources: [...sources].map(([id, title]) => ({ id, title })) };
}

/** Optional: polish with the browser's on-device model (Chrome Prompt API). Returns null if unavailable. */
export async function polishOnDevice(a: Answer, question: string): Promise<string | null> {
  const LM = (globalThis as unknown as { LanguageModel?: { availability(): Promise<string>; create(o?: unknown): Promise<{ prompt(p: string): Promise<string>; destroy(): void }> } }).LanguageModel;
  if (!LM) return null;
  try {
    if ((await LM.availability()) === 'unavailable') return null;
    const session = await LM.create({ initialPrompts: [{ role: 'system', content: 'You rewrite medical facts in warm, plain language for a patient. Use ONLY the facts given. Do not add diagnoses or advice. 120 words max.' }] });
    const facts = a.blocks
      .map((b) => (b.t === 'p' || b.t === 'quote' ? b.text : b.t === 'ul' ? b.items.join('; ') : b.t === 'labs' ? b.rows.map((r) => `${r.name} ${r.value} ${r.unit} (${r.flag})`).join('; ') : b.t === 'terms' ? b.terms.map((t) => `${t.term}: ${t.plain}`).join('; ') : ''))
      .join('\n');
    const out = await session.prompt(`Question: ${question}\n\nFacts from the patient's own records:\n${facts}`);
    session.destroy();
    return out;
  } catch {
    return null;
  }
}
