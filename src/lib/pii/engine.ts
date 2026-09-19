/**
 * MediKey Privacy Engine — 100 % client-side PII detection & redaction.
 *
 * Pipeline:  detect() → user review (toggle / add manual) → applyRedactions() → residualScan()
 * Nothing in this file touches the network. Rules are layered:
 *   1. Structured identifiers   (SSN, Aadhaar, PAN, cards w/ Luhn, e-mail, phone, IP, URL)
 *   2. Label-anchored fields    ("Patient Name:", "MRN:", "DOB:", "Address:" …)
 *   3. Context cues             (Mr./Mrs./Dr., "Dear …", "<Name> is a 52-year-old")
 *   4. Propagation              (every other occurrence of a detected name / user identifier)
 *   5. HIPAA Safe-Harbor extras (dates → year, ages ≥ 90 → "90+")
 */
import type { PrivacyMode } from '../types';

export type PiiCategory =
  | 'PERSON'
  | 'PROVIDER'
  | 'DOB'
  | 'DATE'
  | 'SSN'
  | 'AADHAAR'
  | 'PAN'
  | 'PHONE'
  | 'EMAIL'
  | 'ADDRESS'
  | 'ZIP'
  | 'MRN'
  | 'INSURANCE'
  | 'ID'
  | 'URL'
  | 'IP'
  | 'CARD'
  | 'AGE90'
  | 'FACILITY'
  | 'CUSTOM'
  | 'MANUAL';

export type Confidence = 'high' | 'medium' | 'low';
export type FindingSource = 'pattern' | 'label' | 'context' | 'propagated' | 'identifier' | 'manual';

export interface Finding {
  id: string;
  start: number;
  end: number;
  text: string;
  category: PiiCategory;
  confidence: Confidence;
  source: FindingSource;
  enabled: boolean;
  /** true once the user has toggled this finding by hand — mode changes won't override it */
  userSet?: boolean;
  /** name-entity id: findings with the same entity share one placeholder (PERSON_1) */
  entity?: number;
}

export interface CategoryMeta {
  label: string;
  placeholder: string;
  description: string;
}

export const CATEGORY_META: Record<PiiCategory, CategoryMeta> = {
  PERSON: { label: 'Person name', placeholder: 'PERSON', description: 'Patient, relatives, contacts' },
  PROVIDER: { label: 'Clinician name', placeholder: 'CLINICIAN', description: 'Doctors & staff names' },
  DOB: { label: 'Date of birth', placeholder: 'DOB', description: 'Birth dates' },
  DATE: { label: 'Date', placeholder: 'DATE', description: 'Other dates (generalised to year in Strict mode)' },
  SSN: { label: 'SSN', placeholder: 'SSN', description: 'US Social Security numbers' },
  AADHAAR: { label: 'Aadhaar', placeholder: 'AADHAAR', description: 'Indian Aadhaar numbers' },
  PAN: { label: 'PAN', placeholder: 'PAN', description: 'Indian PAN numbers' },
  PHONE: { label: 'Phone / fax', placeholder: 'PHONE', description: 'Telephone numbers' },
  EMAIL: { label: 'E-mail', placeholder: 'EMAIL', description: 'E-mail addresses' },
  ADDRESS: { label: 'Address', placeholder: 'ADDRESS', description: 'Street & postal addresses' },
  ZIP: { label: 'Postal code', placeholder: 'POSTAL_CODE', description: 'ZIP / PIN codes' },
  MRN: { label: 'Record number', placeholder: 'MRN', description: 'MRN, UHID, accession, visit numbers' },
  INSURANCE: { label: 'Insurance / account', placeholder: 'INSURANCE_ID', description: 'Policy, member, claim, account numbers' },
  ID: { label: 'Other ID', placeholder: 'ID', description: 'Passport, licence, NPI …' },
  URL: { label: 'URL', placeholder: 'URL', description: 'Web addresses' },
  IP: { label: 'IP address', placeholder: 'IP', description: 'Network addresses' },
  CARD: { label: 'Payment card', placeholder: 'CARD', description: 'Card numbers (Luhn-checked)' },
  AGE90: { label: 'Age 90+', placeholder: '90+', description: 'HIPAA: ages over 89 are aggregated' },
  FACILITY: { label: 'Facility', placeholder: 'FACILITY', description: 'Hospital / clinic / lab names' },
  CUSTOM: { label: 'My identifier', placeholder: 'MY_ID', description: 'Identifiers you told MediKey to always remove' },
  MANUAL: { label: 'Manual', placeholder: 'REDACTED', description: 'Selected by you' },
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const MON =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_SRC = [
  String.raw`\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\b`,
  String.raw`\b(?:0?[1-9]|[12]\d|3[01])[-/](?:0?[1-9]|[12]\d|3[01])[-/](?:\d{4}|\d{2})\b`,
  String.raw`\b(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])\.(?:19|20)\d{2}\b`,
  String.raw`\b(?:0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?[ -]+${MON}\.?,?[ -]+(?:19|20)?\d{2}(?:\d{2})?\b`,
  String.raw`\b${MON}\.?[ ]+(?:0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?,?[ ]+(?:19|20)\d{2}\b`,
].join('|');

const TOKEN = String.raw`[A-Z][A-Za-z'’\-]*\.?`;
const NAME = String.raw`${TOKEN}(?:[ ]${TOKEN}){0,3}`;
const NAME_COMMA = String.raw`[A-Z][A-Za-z'’\-]+,[ ]?[A-Z][A-Za-z'’\-]+(?:[ ][A-Z]\.?)?`;
const NAME_ANY = `(?:${NAME_COMMA}|${NAME})`;

const NAME_STOP = new Set(
  (
    'patient patients male female unknown none nil na not the a an and or of to name age sex gender dob date mrn id phone tel email address room ward dept department doctor dr physician ' +
    'hospital clinic report lab laboratory test result results normal abnormal history note notes summary discharge admission diagnosis medication medications allergies plan follow up ' +
    'followup signed signature reviewed verified page sample specimen blood urine serum plasma glucose hemoglobin cholesterol pressure heart rate cardiology neurology oncology ' +
    'radiology pathology emergency department unit medical center centre health healthcare care services referral referring attending ordering provider consultant private public ' +
    'mr mrs ms miss mx master shri smt sri prof md do rn np mbbs dm mch phd january february march april may june july august september october november december monday tuesday wednesday ' +
    'thursday friday saturday sunday sincerely regards thanks thank dear colleague colleagues sir madam team all friend sirs yes no left right upper lower chief complaint assessment impression findings comments ref range units flag status'
  ).split(' '),
);

/** Words that can trail a captured name because they are the *next label* on the line. */
const NAME_TRAIL = new Set(
  'age sex gender dob mrn id date phone tel email address room ward dept department mobile contact blood group weight height bed doa dod uhid'.split(' '),
);
const CREDENTIALS = new Set(['md', 'do', 'rn', 'np', 'pa-c', 'mbbs', 'ms', 'dm', 'mch', 'phd', 'dnb', 'frcs', 'facc', 'faap']);

const isStop = (t: string) => NAME_STOP.has(t.toLowerCase().replace(/[.,]/g, ''));

const COMMON_WORDS = new Set(
  'young mark will rose grace hope may bill art king ross white brown black green long little strong price case gray grey page stone field'.split(' '),
);

/** Regex for a name token: case-insensitive, except ordinary English words which must keep their capitalisation. */
function tokenRe(tok: string): string {
  const e = escapeRe(tok);
  if (!COMMON_WORDS.has(tok.toLowerCase())) return ci(e);
  return `${e[0].toUpperCase() + e.slice(1).toLowerCase()}|${e.toUpperCase()}`;
}

interface Cand {
  start: number;
  end: number;
  category: PiiCategory;
  confidence: Confidence;
  source: FindingSource;
  entity?: number;
  /** placeholder override text (e.g. "90+") */
  replacement?: string;
}

const PRIORITY: Record<PiiCategory, number> = {
  SSN: 100,
  AADHAAR: 96,
  CARD: 92,
  CUSTOM: 91,
  MANUAL: 99,
  MRN: 88,
  INSURANCE: 88,
  ID: 86,
  EMAIL: 80,
  URL: 78,
  PHONE: 75,
  IP: 70,
  DOB: 68,
  PAN: 66,
  ADDRESS: 60,
  PERSON: 58,
  PROVIDER: 56,
  ZIP: 50,
  AGE90: 45,
  DATE: 40,
  FACILITY: 30,
};

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Make a regex source case-insensitive without the `i` flag (so `[A-Z]` stays uppercase-only). */
function ci(src: string): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      out += ch + (src[++i] ?? '');
      continue;
    }
    if (inClass) {
      out += ch;
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      out += ch;
      continue;
    }
    out += /[a-z]/i.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : ch;
  }
  return out;
}

/** Iterate all matches of `re` (must be global; `d` flag used for group indices). */
function* each(text: string, re: RegExp): Generator<RegExpExecArray & { indices?: [number, number][] }> {
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  type Match = RegExpExecArray & { indices?: [number, number][] };
  for (let m = r.exec(text) as Match | null; m; m = r.exec(text) as Match | null) {
    if (m[0].length === 0) {
      r.lastIndex++;
      continue;
    }
    yield m;
  }
}

function groupSpan(m: RegExpExecArray & { indices?: [number, number][] }, g: number): [number, number] {
  const ix = m.indices?.[g];
  if (ix) return [ix[0], ix[1]];
  const start = m.index + m[0].lastIndexOf(m[g]);
  return [start, start + m[g].length];
}

function yearOf(dateText: string): string | null {
  const four = dateText.match(/(?:19|20)\d{2}/);
  if (four) return four[0];
  const two = dateText.match(/[-/.](\d{2})$/) || dateText.match(/[ ,-](\d{2})$/);
  if (two) {
    const n = parseInt(two[1], 10);
    return String(n > 30 ? 1900 + n : 2000 + n);
  }
  return null;
}

/** Trim label words / credentials from a captured name and reject junk. */
function cleanName(text: string, start: number): { start: number; end: number; tokens: string[] } | null {
  const parts: { t: string; s: number; e: number }[] = [];
  const re = /[^ ,]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) parts.push({ t: m[0], s: start + m.index, e: start + m.index + m[0].length });
  // drop trailing label words / credentials
  while (parts.length) {
    const last = parts[parts.length - 1].t.toLowerCase().replace(/[.,]/g, '');
    if (NAME_TRAIL.has(last) || CREDENTIALS.has(last)) parts.pop();
    else break;
  }
  // drop leading titles
  while (parts.length && /^(mr|mrs|ms|miss|mx|dr|prof|master|shri|smt|sri)\.?$/i.test(parts[0].t)) parts.shift();
  if (!parts.length) return null;
  const meaningful = parts.filter((p) => !isStop(p.t) && p.t.replace(/[.'’-]/g, '').length >= 2);
  if (!meaningful.length) return null;
  // trim leading stop tokens ("The Smith" → "Smith")
  while (parts.length && isStop(parts[0].t)) parts.shift();
  while (parts.length && isStop(parts[parts.length - 1].t)) parts.pop();
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  let end = last.e;
  const poss = last.t.match(/['’]s$/i);
  if (poss) {
    end -= 2;
    last.t = last.t.slice(0, -2);
  } else if (/[.,]$/.test(last.t) && last.t.length > 2) end -= 1;
  const tokens = parts.map((p) => p.t.replace(/[.,]+$/g, '')).filter((t) => t.length > 0);
  return { start: parts[0].s, end, tokens };
}

// ---------------------------------------------------------------------------
// rule tables
// ---------------------------------------------------------------------------

const ID_RULES: { cat: PiiCategory; labels: string }[] = [
  { cat: 'SSN', labels: String.raw`SSN|Social[ ]+Security(?:[ ]+(?:No|Number|#))?` },
  { cat: 'AADHAAR', labels: String.raw`Aadhaar|Aadhar|UID(?:AI)?(?:[ ]+(?:No|Number))?` },
  { cat: 'PAN', labels: String.raw`PAN(?:[ ]+(?:No|Number|Card))?` },
  {
    cat: 'INSURANCE',
    labels: String.raw`Insurance[ ]+(?:ID|No|Number|Policy(?:[ ]+No)?)|Policy[ ]+(?:No|Number|ID|#)|Member[ ]*(?:ID|No|Number)|Subscriber[ ]+(?:ID|No)|Group[ ]+(?:No|Number|ID|#)|Claim[ ]+(?:No|Number|ID|#)|Medicare[ ]+(?:No|Number|ID)|Medicaid[ ]+(?:No|Number|ID)|ABHA[ ]*(?:No|ID|Number)?|Ayushman[ ]+(?:Card|ID|No)|TPA[ ]+(?:ID|No)|Account(?:[ ]+(?:No|Number|#))?|Acct(?:[ ]+(?:No|#))?`,
  },
  {
    cat: 'MRN',
    labels: String.raw`MRN|M\.R\.N|Medical[ ]+Record(?:[ ]+(?:No|Number|Num|#))?|UHID|Hospital[ ]+(?:No|ID|Number)|Patient[ ]+(?:ID|No|Number)|Pt[ ]*ID|Registration[ ]+(?:No|ID|Number)|Reg\.?[ ]*No|Chart[ ]+(?:No|Number)|File[ ]+(?:No|Number)|IP[ ]*No|OP[ ]*No|Case[ ]+(?:No|ID)|Encounter(?:[ ]+(?:No|ID|Number|#))?|Visit[ ]+(?:No|ID|Number)|Admission[ ]+(?:No|ID|Number)|Accession(?:[ ]+(?:No|ID|Number|#))?|Sample[ ]+(?:No|ID)|Specimen[ ]+(?:No|ID)|Lab[ ]+(?:No|ID)|Barcode|Order[ ]+(?:No|ID|Number)`,
  },
  {
    cat: 'ID',
    labels: String.raw`Passport(?:[ ]+(?:No|Number|#))?|Driver'?s?[ ]+Licen[sc]e(?:[ ]+(?:No|Number|#))?|Licen[sc]e[ ]+(?:No|Number|#)|NPI|DEA|Voter[ ]+ID|National[ ]+ID|ID[ ]+(?:No|Number)`,
  },
];

const PATIENT_LABELS = ci(String.raw`Patient(?:'s)?(?:[ ]+Name)?|Pt\.?(?:[ ]+Name)?|Full[ ]+Name|Name(?:[ ]+of[ ](?:the[ ])?patient)?|Guardian(?:[ ]+Name)?|Parent(?:[ ]+Name)?|Mother(?:'s)?(?:[ ]+Name)?|Father(?:'s)?(?:[ ]+Name)?|Spouse(?:[ ]+Name)?|Wife|Husband|Next[ ]+of[ ]+Kin|Emergency[ ]+Contact(?:[ ]+Name)?|Contact[ ]+Person|Relative|Guarantor|Subscriber|Insured|Re|Regarding`);
const NOT_PATIENT_PREFIX = ci(String.raw`(?<!\b(?:Test|Drug|Facility|File|Sample|Study|Medication|Generic|Brand|Hospital|Clinic|Lab|Doctor|Physician|Provider|Company|Employer|Insurance|Plan|Report|Panel|Analyte|Referring|Attending|Ordering|Consulting|Treating|Admitting|Primary|Care)[ ])`);
const PROVIDER_LABELS = ci(String.raw`(?:Referring|Ordering|Treating|Consulting|Admitting|Discharging|Rendering|Attending|Primary[ ]+Care)(?:[ ]+(?:Physician|Doctor|Provider|Clinician))?|PCP|Physician|Doctor|Provider|Consultant|Surgeon|Radiologist|Pathologist|Cardiologist|Technologist|Requested[ ]+by|Ordered[ ]+by|Reported[ ]+by|Reviewed[ ]+by|Verified[ ]+by|Dictated[ ]+by|Collected[ ]+by|Authenticated[ ]+by|(?:Electronically[ ]+)?[Ss]igned(?:[ ]+by)?|Doctor[ ]+Name|Physician[ ]+Name|Provider[ ]+Name`);
const TITLE_PREFIX = ci(String.raw`(?:(?:Dr|Prof|Mr|Mrs|Ms|Miss)\.?[ ]+)?`);
const SEP = String.raw`(?:[ \t]*:[ \t]*|[ \t]+[-–][ \t]+)`;

/** a space, or a soft line-wrap (documents are often hard-wrapped mid-address) */
const SP = String.raw`(?:[ ]+|[ ]*\r?\n[ ]*)`;
const FACILITY_KW = ['Hospital', 'Clinic', 'Medical[ ]+Cent(?:er|re)', 'Health(?:care)?[ ]+System', 'Diagnostics', 'Laboratories', 'Laboratory', 'Labs', 'Nursing[ ]+Home', 'Polyclinic', 'Multispeciality[ ]+Hospital']
  .flatMap((k) => [k, k.toUpperCase()])
  .join('|');
const STREET_SUFFIX =
  'Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Circle|Cir|Terrace|Highway|Hwy|Parkway|Pkwy|Nagar|Colony|Marg|Chowk|Layout';

// ---------------------------------------------------------------------------
// detection
// ---------------------------------------------------------------------------

export interface DetectOptions {
  mode: PrivacyMode;
  /** names / phones / emails the patient always wants removed */
  identifiers?: string[];
}

interface NameHit {
  category: 'PERSON' | 'PROVIDER';
  tokens: string[];
  start: number;
  end: number;
  confidence: Confidence;
  source: FindingSource;
}

export function detect(text: string, opts: DetectOptions): Finding[] {
  const cands: Cand[] = [];
  const push = (c: Cand) => cands.push(c);

  // ---- 1. structured identifiers -----------------------------------------
  for (const m of each(text, /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g))
    push({ start: m.index, end: m.index + m[0].length, category: 'EMAIL', confidence: 'high', source: 'pattern' });

  for (const m of each(text, /\bhttps?:\/\/[^\s<>"')]+|\bwww\.[^\s<>"')]+/gi)) {
    const end = m.index + m[0].replace(/[.,;]+$/, '').length;
    push({ start: m.index, end, category: 'URL', confidence: 'medium', source: 'pattern' });
  }

  for (const m of each(text, /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g))
    if (m[0].split('.').every((o) => +o <= 255))
      push({ start: m.index, end: m.index + m[0].length, category: 'IP', confidence: 'medium', source: 'pattern' });

  for (const m of each(text, /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g))
    push({ start: m.index, end: m.index + m[0].length, category: 'SSN', confidence: 'high', source: 'pattern' });

  for (const m of each(text, /(?<!\d)[2-9]\d{3}[ -]\d{4}[ -]\d{4}(?![ -]?\d)/g))
    push({ start: m.index, end: m.index + m[0].length, category: 'AADHAAR', confidence: 'high', source: 'pattern' });

  for (const m of each(text, /\b[A-Z]{5}\d{4}[A-Z]\b/g))
    push({ start: m.index, end: m.index + m[0].length, category: 'PAN', confidence: 'medium', source: 'pattern' });

  for (const m of each(text, /(?<![\d-])(?:\d[ -]?){13,19}(?!\d)/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
      const trimmed = m[0].replace(/[ -]+$/, '');
      push({ start: m.index, end: m.index + trimmed.length, category: 'CARD', confidence: 'high', source: 'pattern' });
    }
  }

  const phoneRes = [
    /(?<![\d.])(?:\+?\d{1,3}[ .-]?)?(?:\(\d{3}\)[ .-]?|\d{3}[ .-])\d{3}[ .-]\d{4}(?![\d])/g,
    /(?<![\d.])(?:\+91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?!\d)/g,
    /(?<![\d.])\+\d{1,3}[ .-]?\d{2,4}[ .-]?\d{3,4}[ .-]?\d{3,4}(?!\d)/g,
  ];
  for (const re of phoneRes)
    for (const m of each(text, re)) {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 14)
        push({ start: m.index, end: m.index + m[0].length, category: 'PHONE', confidence: 'high', source: 'pattern' });
    }
  for (const m of each(text, /\b(?:Phone|Tel(?:ephone)?|Mobile|Mob|Cell|Fax|Ph|Contact(?:[ ]+No)?)\.?[ ]*(?:No\.?|Number|#)?[ ]*[:\-][ ]*(\+?[\d][\d ()\-.]{6,18}\d)/gid))
    push({ ...spanOf(m, 1), category: 'PHONE', confidence: 'high', source: 'label' });

  // ---- 2. label-anchored fields -----------------------------------------
  for (const { cat, labels } of ID_RULES) {
    const re = new RegExp(
      String.raw`\b(?:${labels})(?![A-Za-z])[ ]*[:#\-–]?[ ]*([A-Z0-9][A-Z0-9\-/]{2,}(?:[ ]\d{3,}){0,3})`,
      'gid',
    );
    for (const m of each(text, re)) {
      if (!/\d/.test(m[1])) continue;
      push({ ...spanOf(m, 1), category: cat, confidence: 'high', source: 'label' });
    }
  }

  const dateRe = new RegExp(DATE_SRC, 'gi');
  for (const m of each(
    text,
    new RegExp(String.raw`(?:D\.?O\.?B\.?|Date[ ]+of[ ]+Birth|Birth[ ]*date|Born(?:[ ]+on)?)[ ]*[:\-]?[ ]*(${DATE_SRC})`, 'gid'),
  ))
    push({ ...spanOf(m, 1), category: 'DOB', confidence: 'high', source: 'label' });
  for (const m of each(text, dateRe))
    push({ start: m.index, end: m.index + m[0].length, category: 'DATE', confidence: 'medium', source: 'pattern' });

  for (const m of each(
    text,
    /\b(?:(?:Home|Residential|Mailing|Permanent|Present|Current|Billing)[ ]+)?Address(?:[ ]*Line[ ]*\d)?[ ]*[:\-][ ]*([^\n\r]{5,140})/gid,
  ))
    push({ ...spanOf(m, 1), category: 'ADDRESS', confidence: 'high', source: 'label' });
  for (const m of each(
    text,
    new RegExp(
      String.raw`\b\d{1,5}(?:[-/]\d{1,4})?${SP}(?:[A-Z][A-Za-z.']*${SP}){1,4}(?:${STREET_SUFFIX})\b\.?(?:,?[ ]*(?:Apt|Apartment|Suite|Ste|Unit|Flat|Floor|Fl|#)[ .]*[A-Za-z0-9-]+)?(?:(?:,[ ]*[A-Z][A-Za-z]+(?:[ ][A-Z][A-Za-z]+)*){1,3}(?:,?[ ]*(?:[A-Z]{2}[ ]+\d{5}(?:-\d{4})?|(?<=,[ ]?[A-Z]{2})[ ]+\d{5}(?:-\d{4})?|[-–]?[ ]*\d{6}(?!\d)))?)?`,
      'g',
    ),
  ))
    push({ start: m.index, end: m.index + m[0].length, category: 'ADDRESS', confidence: 'medium', source: 'pattern' });
  for (const m of each(text, /\b(?:Flat|House|H\.?[ ]?No\.?|Plot)[ ]*(?:No\.?)?[ ]*[\dA-Z][\w\-/]*,[^\n\r]{5,90}/g))
    push({ start: m.index, end: m.index + m[0].length, category: 'ADDRESS', confidence: 'medium', source: 'pattern' });
  for (const m of each(text, /\b[A-Z][a-zA-Z]+(?:[ ][A-Z][a-zA-Z]+)*,[ ]*[A-Z]{2}[ ]+\d{5}(?:-\d{4})?\b/g))
    push({ start: m.index, end: m.index + m[0].length, category: 'ADDRESS', confidence: 'medium', source: 'pattern' });
  for (const m of each(text, /\b(?:PIN(?:[ ]*code)?|Pincode|Zip(?:[ ]*code)?|Postal[ ]*code)[ ]*[:\-]?[ ]*(\d{5,6}(?:-\d{4})?)\b/gid))
    push({ ...spanOf(m, 1), category: 'ZIP', confidence: 'medium', source: 'label' });

  for (const m of each(text, /(?<=[A-Za-z][ ]|[A-Za-z][ ]?[-–][ ]?|,[ ]?)([1-9]\d{2}[ ]?\d{3})(?![\d/%.]|[ ]?(?:mg|ml|mL|cells|x10))/gd)) {
    const [ls, le] = [text.lastIndexOf('\n', m.index) + 1, text.indexOf('\n', m.index)];
    const line = text.slice(ls, le < 0 ? undefined : le);
    if ((line.match(/,/g) ?? []).length >= 2 || /address/i.test(line)) push({ ...spanOf(m, 1), category: 'ZIP', confidence: 'medium', source: 'pattern' });
  }

  // ages ≥ 90 (HIPAA Safe Harbor)
  const ageRes = [
    /\bage(?:d)?[ ]*[:\-]?[ ]*(\d{2,3})\b/gid,
    /\b(\d{2,3})[- ]?(?:year|yr)s?[- ]?old\b/gid,
    /\b(\d{2,3})[ ]?(?:y\/o|yo|yrs?)\b/gid,
  ];
  for (const re of ageRes)
    for (const m of each(text, re)) {
      const n = parseInt(m[1], 10);
      if (n >= 90 && n <= 125) push({ ...spanOf(m, 1), category: 'AGE90', confidence: 'high', source: 'pattern', replacement: '90+' });
    }

  // facilities (suggested only)
  for (const m of each(
    text,
    new RegExp(String.raw`\b(?:[A-Z][A-Za-z.&'’-]+[ ]){1,4}(?:${FACILITY_KW})\b`, 'g'),
  )) {
    let s = m.index;
    const words = m[0].split(' ');
    const lead = new Set(['Comprehensive', 'COMPREHENSIVE', 'Complete', 'COMPLETE', 'Clinical', 'CLINICAL', 'Routine', 'Basic', 'Discharged', 'Discharge', 'From', 'At', 'The', 'To', 'Seen', 'Referred', 'Admitted', 'In', 'Visit', 'Report', 'Lab', 'Transferred', 'Presented', 'Attended']);
    let drop = 0;
    while (drop < words.length - 1 && lead.has(words[drop])) {
      s += words[drop].length + 1;
      drop++;
    }
    if (words.length - drop >= 2) push({ start: s, end: m.index + m[0].length, category: 'FACILITY', confidence: 'low', source: 'pattern' });
  }

  // ---- 3. names ------------------------------------------------------------
  const names: NameHit[] = [];
  const addName = (
    category: 'PERSON' | 'PROVIDER',
    raw: string,
    rawStart: number,
    confidence: Confidence,
    source: FindingSource,
  ) => {
    const c = cleanName(raw, rawStart);
    if (!c) return;
    names.push({ category, tokens: c.tokens, start: c.start, end: c.end, confidence, source });
  };

  for (const m of each(
    text,
    new RegExp(String.raw`${NOT_PATIENT_PREFIX}\b(?:${PATIENT_LABELS})(?:${SEP}|(?<=[eE])[ \t]{2,})${TITLE_PREFIX}(${NAME_ANY})`, 'gd'),
  )) {
    const [s, e] = groupSpan(m, 1);
    addName('PERSON', text.slice(s, e), s, 'high', 'label');
  }
  for (const m of each(text, new RegExp(String.raw`\b(?:${PROVIDER_LABELS})${SEP}${TITLE_PREFIX}(${NAME_ANY})`, 'gd'))) {
    const [s, e] = groupSpan(m, 1);
    addName('PROVIDER', text.slice(s, e), s, 'medium', 'label');
  }
  for (const m of each(text, new RegExp(String.raw`\b${ci('(?:Mr|Mrs|Ms|Miss|Mx|Master|Shri|Smt|Sri)')}\.?[ ]+(${NAME})`, 'gd'))) {
    const [s, e] = groupSpan(m, 1);
    addName('PERSON', text.slice(s, e), s, 'medium', 'context');
  }
  for (const m of each(text, new RegExp(String.raw`\b${ci('(?:Dr|Prof|Doctor)')}\.?[ ]+(${NAME})`, 'gd'))) {
    const [s, e] = groupSpan(m, 1);
    addName('PROVIDER', text.slice(s, e), s, 'medium', 'context');
  }
  for (const m of each(text, new RegExp(String.raw`\b(${TOKEN}(?:[ ]${TOKEN}){0,2}),?[ ]+(?:MD|M\.D\.|DO|RN|NP|PA-C|MBBS|MS|DM|MCh|PhD|DNB)\b`, 'gd'))) {
    const [s, e] = groupSpan(m, 1);
    addName('PROVIDER', text.slice(s, e), s, 'medium', 'context');
  }
  for (const m of each(text, new RegExp(String.raw`\b${ci('Dear')}[ ]+(?:(${ci('Dr|Prof')})\.?[ ]+|${ci('(?:Mr|Mrs|Ms|Miss)')}\.?[ ]+)?(${TOKEN}(?:[ ]${TOKEN})?)`, 'gd'))) {
    const [s, e] = groupSpan(m, 2);
    addName(m[1] ? 'PROVIDER' : 'PERSON', text.slice(s, e), s, 'medium', 'context');
  }
  for (const m of each(
    text,
    new RegExp(String.raw`\b(${TOKEN}(?:[ ]${TOKEN}){1,2})[ ]+(?:is|was)[ ]+an?[ ]+\d{1,3}[- ]?(?:year|yr|y\/?o)`, 'gd'),
  )) {
    const [s, e] = groupSpan(m, 1);
    addName('PERSON', text.slice(s, e), s, 'medium', 'context');
  }

  for (const m of each(
    text,
    new RegExp(
      String.raw`\b${ci('(?:daughter|son|wife|husband|spouse|mother|father|brother|sister|partner|caregiver|niece|nephew|grandson|granddaughter|guardian)')}(?:,|[ ]${ci('(?:named|is)')}|:)?[ ]+(${NAME})`,
      'gd',
    ),
  )) {
    const [s, e] = groupSpan(m, 1);
    addName('PERSON', text.slice(s, e), s, 'medium', 'context');
  }

  // ---- 4. user identifiers + propagation ---------------------------------
  const entities: { category: 'PERSON' | 'PROVIDER'; tokens: Set<string> }[] = [];
  const entityFor = (category: 'PERSON' | 'PROVIDER', tokens: string[]): number => {
    const keys = tokens.map((t) => t.toLowerCase().replace(/[.,]/g, '')).filter((t) => t.length >= 3 && !isStop(t));
    // Same person if they share a token AND it isn't just a shared surname between two full names
    // ("Rahul Verma" vs "Sunita Verma" stay separate; "Mr. Verma" joins the first Verma).
    let idx = entities.findIndex((e) => {
      if (e.category !== category) return false;
      const shared = keys.filter((k) => e.tokens.has(k)).length;
      return shared > 0 && (keys.length === 1 || e.tokens.size === 1 || shared >= 2 || keys[0] === [...e.tokens][0]);
    });
    if (idx < 0) {
      entities.push({ category, tokens: new Set() });
      idx = entities.length - 1;
    }
    keys.forEach((k) => entities[idx].tokens.add(k));
    return idx;
  };

  for (const raw of opts.identifiers ?? []) {
    const id = raw.trim();
    if (id.length < 3) continue;
    if (/@/.test(id)) {
      for (const m of each(text, new RegExp(escapeRe(id), 'gi')))
        push({ start: m.index, end: m.index + m[0].length, category: 'CUSTOM', confidence: 'high', source: 'identifier' });
    } else if ((id.match(/\d/g) ?? []).length >= 5) {
      const pattern = id.replace(/\D/g, '').split('').join(String.raw`[ .\-()]*`);
      for (const m of each(text, new RegExp(String.raw`(?<!\d)${pattern}(?!\d)`, 'g')))
        push({ start: m.index, end: m.index + m[0].length, category: 'CUSTOM', confidence: 'high', source: 'identifier' });
    } else {
      const tokens = id.split(/\s+/);
      names.push({ category: 'PERSON', tokens, start: -1, end: -1, confidence: 'high', source: 'identifier' });
      for (const m of each(text, new RegExp(tokens.map(escapeRe).join(String.raw`[ \t]+`), 'gi')))
        push({ start: m.index, end: m.index + m[0].length, category: 'PERSON', confidence: 'high', source: 'identifier' });
    }
  }

  const nameCands: (Cand & { entity: number })[] = [];
  for (const n of names) {
    const entity = entityFor(n.category, n.tokens);
    if (n.start >= 0) nameCands.push({ start: n.start, end: n.end, category: n.category, confidence: n.confidence, source: n.source, entity });
  }
  entities.forEach((ent, entity) => {
    const toks = [...ent.tokens];
    if (!toks.length) return;
    const alt = toks.map(tokenRe).join('|');
    const re = new RegExp(String.raw`(?<![A-Za-z'’])(?:${alt})(?:[ ,.]+(?:${alt}|[A-Z]\.?)(?![A-Za-z]))*(?![A-Za-z'’])`, 'g');
    for (const m of each(text, re)) {
      const trimmed = m[0].replace(/[ ,.]+$/, '');
      nameCands.push({
        start: m.index,
        end: m.index + trimmed.length,
        category: ent.category,
        confidence: 'medium',
        source: 'propagated',
        entity,
      });
    }
  });
  // identifier-sourced name hits already pushed as candidates without entity → attach entity by re-linking below
  cands.push(...nameCands);

  return resolve(text, cands, entities, opts.mode);
}

function spanOf(m: RegExpExecArray & { indices?: [number, number][] }, g: number) {
  const [start, end] = groupSpan(m, g);
  return { start, end };
}

/** Overlap resolution: highest priority wins, then longest. Attaches entity ids & defaults. */
function resolve(
  text: string,
  cands: Cand[],
  entities: { category: 'PERSON' | 'PROVIDER'; tokens: Set<string> }[],
  mode: PrivacyMode,
): Finding[] {
  const sorted = [...cands]
    .filter((c) => c.end > c.start)
    .sort((a, b) => PRIORITY[b.category] - PRIORITY[a.category] || b.end - b.start - (a.end - a.start) || a.start - b.start);
  const accepted: Cand[] = [];
  for (const c of sorted) {
    if (accepted.some((a) => c.start < a.end && c.end > a.start)) continue;
    accepted.push(c);
  }
  accepted.sort((a, b) => a.start - b.start);

  // Identifier-sourced names have no entity yet: link to an entity by token match.
  const entityByToken = new Map<string, number>();
  entities.forEach((e, i) => e.tokens.forEach((t) => entityByToken.set(t, i)));

  return accepted.map((c, i) => {
    let entity = c.entity;
    const slice = text.slice(c.start, c.end);
    if ((c.category === 'PERSON' || c.category === 'PROVIDER') && entity === undefined) {
      for (const t of slice.toLowerCase().split(/[^a-z'’-]+/)) {
        if (entityByToken.has(t)) {
          entity = entityByToken.get(t);
          break;
        }
      }
    }
    const f: Finding = {
      id: `f${i}`,
      start: c.start,
      end: c.end,
      text: slice,
      category: c.category,
      confidence: c.confidence,
      source: c.source,
      enabled: defaultEnabled(c.category, c.confidence, mode),
      entity,
    };
    return f;
  });
}

export function defaultEnabled(cat: PiiCategory, conf: Confidence, mode: PrivacyMode): boolean {
  if (cat === 'MANUAL') return true;
  if (conf === 'low' && cat !== 'FACILITY') return false;
  if (cat === 'DATE' || cat === 'PROVIDER' || cat === 'FACILITY') return mode === 'strict';
  return true;
}

/** Re-apply mode defaults (after the user switches Strict ↔ Balanced) without touching manual choices. */
export function reapplyMode(findings: Finding[], mode: PrivacyMode): Finding[] {
  return findings.map((f) => (f.userSet ? f : { ...f, enabled: defaultEnabled(f.category, f.confidence, mode) }));
}

/** Create manual findings for a selection, optionally for every occurrence of that text. */
export function manualFindings(text: string, existing: Finding[], start: number, end: number, all: boolean): Finding[] {
  const sel = text.slice(start, end);
  if (!sel.trim()) return existing;
  const spans: [number, number][] = [[start, end]];
  if (all && sel.trim().length >= 3) {
    const re = new RegExp(escapeRe(sel.trim()), 'gi');
    for (const m of each(text, re)) spans.push([m.index, m.index + m[0].length]);
  }
  const next = [...existing];
  let n = existing.length;
  for (const [s, e] of spans) {
    // replace any overlapping auto findings
    for (let i = next.length - 1; i >= 0; i--) if (s < next[i].end && e > next[i].start) next.splice(i, 1);
    next.push({
      id: `m${n++}`,
      start: s,
      end: e,
      text: text.slice(s, e),
      category: 'MANUAL',
      confidence: 'high',
      source: 'manual',
      enabled: true,
      userSet: true,
    });
  }
  return next.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// applying
// ---------------------------------------------------------------------------

export interface RedactionResult {
  text: string;
  total: number;
  counts: Record<string, number>;
}

export function applyRedactions(text: string, findings: Finding[]): RedactionResult {
  const active = findings.filter((f) => f.enabled).sort((a, b) => a.start - b.start);
  const entityNo = new Map<string, number>();
  const nextNo: Record<string, number> = {};
  const numFor = (cat: PiiCategory, entity: number | undefined, fallbackKey: string) => {
    const key = `${cat}:${entity ?? 'x:' + fallbackKey.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    if (!entityNo.has(key)) {
      nextNo[cat] = (nextNo[cat] ?? 0) + 1;
      entityNo.set(key, nextNo[cat]);
    }
    return entityNo.get(key)!;
  };

  let out = '';
  let cursor = 0;
  const counts: Record<string, number> = {};
  for (const f of active) {
    if (f.start < cursor) continue;
    out += text.slice(cursor, f.start);
    let rep: string;
    switch (f.category) {
      case 'PERSON':
      case 'PROVIDER':
      case 'FACILITY': {
        const meta = CATEGORY_META[f.category].placeholder;
        rep = `[${meta}_${numFor(f.category, f.entity, f.text)}]`;
        break;
      }
      case 'AGE90':
        rep = '90+';
        break;
      case 'DATE': {
        const y = yearOf(f.text);
        rep = y ? `[DATE:${y}]` : '[DATE]';
        break;
      }
      case 'MANUAL':
      case 'CUSTOM':
        rep = `[${CATEGORY_META[f.category].placeholder}_${numFor(f.category, undefined, f.text)}]`;
        break;
      default:
        rep = `[${CATEGORY_META[f.category].placeholder}]`;
    }
    out += rep;
    cursor = f.end;
    counts[f.category] = (counts[f.category] ?? 0) + 1;
  }
  out += text.slice(cursor);
  return { text: out, total: active.filter((f) => f.start >= 0).length, counts };
}

/** Run the high-confidence detectors again over the *sanitised* output. Anything left is a leak warning. */
export function residualScan(sanitized: string, opts: DetectOptions): Finding[] {
  return detect(sanitized, opts).filter(
    (f) => f.enabled && f.confidence !== 'low' && f.category !== 'DATE' && f.category !== 'AGE90' && !/^\[.*\]$/.test(f.text),
  );
}

export const PLACEHOLDER_RE = /\[(?:[A-Z_]+(?:_\d+)?|DATE:\d{4})\]/g;
