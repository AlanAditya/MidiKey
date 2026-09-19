/** Plain-language explanations for common clinical jargon, abbreviations and drug classes. Fully offline. */
export interface Term {
  term: string;
  /** regex source, matched case-insensitively on word boundaries */
  match: string;
  plain: string;
}

const T = (term: string, plain: string, match = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')): Term => ({ term, plain, match });

export const GLOSSARY: Term[] = [
  T('Hypertension', 'High blood pressure — the force of blood against artery walls is higher than it should be.'),
  T('Hypotension', 'Low blood pressure.'),
  T('Type 2 diabetes mellitus', 'A long-term condition where the body does not use insulin well, so blood sugar runs high.', 'type 2 diabetes(?: mellitus)?|T2DM'),
  T('HbA1c', 'A blood test showing your average blood sugar over the last ~3 months. Below 5.7% is normal; 6.5% or more suggests diabetes.', 'hba1c|hemoglobin a1c|glycated hemoglobin'),
  T('Dyslipidemia', 'Unhealthy levels of fats (cholesterol/triglycerides) in the blood.', 'dyslipidemia|hyperlipidemia'),
  T('LDL', '"Bad" cholesterol — high levels build up in artery walls.', 'LDL(?: cholesterol)?'),
  T('HDL', '"Good" cholesterol — helps clear other cholesterol from the blood.', 'HDL(?: cholesterol)?'),
  T('Triglycerides', 'A type of fat in the blood; high levels raise heart risk.'),
  T('Anemia', 'Too few healthy red blood cells (or too little hemoglobin), which can cause tiredness and breathlessness.', 'anemia|anaemia'),
  T('Microcytic', 'Red blood cells that are smaller than normal — often linked to iron deficiency.'),
  T('Hemoglobin', 'The protein in red blood cells that carries oxygen.', 'hemoglobin|haemoglobin|Hb'),
  T('Hematocrit', 'The share of your blood made up of red blood cells.'),
  T('MCV', 'Average size of your red blood cells.'),
  T('WBC', 'White blood cells — they fight infection.'),
  T('Platelets', 'Tiny blood cells that help blood clot.'),
  T('Creatinine', 'A waste product filtered by the kidneys; a higher level can mean the kidneys are working less well.'),
  T('eGFR', 'An estimate of how well your kidneys filter blood. Above 60 is generally fine.'),
  T('TSH', 'Thyroid-stimulating hormone — the main screening test for an under- or over-active thyroid.'),
  T('Ferritin', 'A blood test that reflects your body\'s iron stores.'),
  T('NSTEMI', 'A type of heart attack where a heart artery is partly blocked.'),
  T('ACS', 'Acute coronary syndrome — sudden reduced blood flow to the heart (e.g. a heart attack or unstable angina).', 'acute coronary syndrome|ACS'),
  T('PCI', 'Percutaneous coronary intervention — a procedure (often a stent) to reopen a blocked heart artery.'),
  T('LAD', 'Left anterior descending artery — a major artery feeding the heart muscle.'),
  T('Stenosis', 'Narrowing of a blood vessel or valve.'),
  T('Stent', 'A tiny mesh tube placed in an artery to keep it open.', 'stent|drug-eluting stent'),
  T('LVEF', 'How much blood the heart\'s main pumping chamber pushes out with each beat. 50–70% is normal.', 'LVEF|ejection fraction'),
  T('Hypokinesia', 'Part of the heart wall moving less than it should.'),
  T('Troponin', 'A protein released when heart muscle is damaged; raised levels suggest a heart attack.', 'troponin(?: I| T)?'),
  T('Atrial fibrillation', 'An irregular, often fast heartbeat that raises stroke risk.', 'atrial fibrillation|AFib|AF'),
  T('Paroxysmal', 'Coming and going — episodes that start and stop on their own.'),
  T('CHA2DS2-VASc', 'A score estimating stroke risk in atrial fibrillation; 2 or more usually means a blood thinner is advised.', 'CHA2DS2-VASc'),
  T('Anticoagulation', 'Treatment with blood thinners to prevent clots.', 'anticoagula\\w+'),
  T('ECG', 'Electrocardiogram — a recording of the heart\'s electrical activity.', 'ECG|EKG'),
  T('Echocardiogram', 'An ultrasound scan of the heart.', 'echocardiogram|echo'),
  T('BID', 'Twice a day.'),
  T('QD', 'Once a day.', 'QD|OD'),
  T('PRN', 'Only when needed.'),
  T('mmHg', 'Millimetres of mercury — the unit for blood pressure.'),
  T('Cardiac rehabilitation', 'A supervised exercise and education programme to recover after a heart problem.'),
  T('Cough-variant asthma', 'A form of asthma where a persistent dry cough is the main symptom.'),
  T('Spirometry', 'A breathing test that measures how much and how fast you can blow air out.'),
  T('FEV1', 'The amount of air you can forcefully breathe out in one second.'),
  T('BMI', 'Body mass index — a rough measure of weight relative to height.'),
  T('SpO2', 'Oxygen saturation — the percentage of your blood carrying oxygen. 95% or higher is normal.', 'SpO2|SpO₂'),
  T('Hypokalemia', 'Low potassium in the blood.'),
  T('Hyperglycemia', 'High blood sugar.'),
  T('Hypoglycemia', 'Low blood sugar.'),
  T('Tachycardia', 'A resting heart rate above 100 beats per minute.'),
  T('Bradycardia', 'A resting heart rate below 60 beats per minute.'),
];

/** What common drug classes do, keyed by generic-name stem. */
export const DRUGS: { match: RegExp; name: string; plain: string }[] = [
  { match: /aspirin/i, name: 'Aspirin', plain: 'Thins the blood slightly to help prevent clots.' },
  { match: /clopidogrel/i, name: 'Clopidogrel', plain: 'Antiplatelet — keeps stents and arteries from clotting.' },
  { match: /apixaban|rivaroxaban|warfarin|dabigatran/i, name: 'Blood thinner', plain: 'Anticoagulant that lowers the chance of clots and stroke.' },
  { match: /atorvastatin|rosuvastatin|simvastatin|pravastatin/i, name: 'Statin', plain: 'Lowers LDL cholesterol and protects arteries.' },
  { match: /metoprolol|atenolol|bisoprolol|carvedilol|propranolol/i, name: 'Beta-blocker', plain: 'Slows the heart and lowers blood pressure.' },
  { match: /ramipril|enalapril|lisinopril|perindopril/i, name: 'ACE inhibitor', plain: 'Relaxes blood vessels to lower blood pressure and protect heart and kidneys.' },
  { match: /losartan|valsartan|telmisartan|olmesartan|candesartan/i, name: 'ARB', plain: 'Relaxes blood vessels to lower blood pressure.' },
  { match: /amlodipine|nifedipine|diltiazem|verapamil/i, name: 'Calcium-channel blocker', plain: 'Relaxes blood vessels to lower blood pressure.' },
  { match: /metformin/i, name: 'Metformin', plain: 'First-line diabetes medicine that lowers blood sugar.' },
  { match: /glipizide|gliclazide|glimepiride/i, name: 'Sulfonylurea', plain: 'Helps the pancreas release more insulin.' },
  { match: /insulin/i, name: 'Insulin', plain: 'Hormone that moves sugar out of the blood.' },
  { match: /albuterol|salbutamol/i, name: 'Albuterol', plain: 'Quick-relief inhaler that opens the airways.' },
  { match: /fluticasone|budesonide|beclomethasone/i, name: 'Inhaled steroid', plain: 'Daily preventer inhaler that calms airway inflammation.' },
  { match: /levothyroxine/i, name: 'Levothyroxine', plain: 'Replaces thyroid hormone.' },
  { match: /omeprazole|pantoprazole|esomeprazole/i, name: 'Proton-pump inhibitor', plain: 'Reduces stomach acid.' },
  { match: /furosemide|hydrochlorothiazide|spironolactone/i, name: 'Diuretic', plain: 'Helps the body remove extra fluid and salt.' },
  { match: /paracetamol|acetaminophen/i, name: 'Paracetamol', plain: 'Pain and fever relief.' },
  { match: /ibuprofen|naproxen|diclofenac/i, name: 'NSAID', plain: 'Anti-inflammatory pain relief.' },
  { match: /amoxicillin|azithromycin|ciprofloxacin|doxycycline|cefalexin|cephalexin/i, name: 'Antibiotic', plain: 'Treats bacterial infections.' },
];

export interface Hit {
  term: string;
  plain: string;
}

/** Find glossary terms present in a text (deduplicated, in order of appearance). */
export function findTerms(text: string, limit = 12): Hit[] {
  const found: { i: number; hit: Hit }[] = [];
  const seen = new Set<string>();
  for (const t of GLOSSARY) {
    const m = new RegExp(`\\b(?:${t.match})\\b`, 'i').exec(text);
    if (m && !seen.has(t.term)) {
      seen.add(t.term);
      found.push({ i: m.index, hit: { term: t.term, plain: t.plain } });
    }
  }
  return found.sort((a, b) => a.i - b.i).slice(0, limit).map((f) => f.hit);
}

export function lookupTerm(query: string): Term | undefined {
  const q = query.toLowerCase().trim();
  return GLOSSARY.find((t) => t.term.toLowerCase() === q || new RegExp(`^(?:${t.match})$`, 'i').test(q));
}
