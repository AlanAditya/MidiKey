/** Parses lab-result rows out of free text and explains them in plain language. */
export interface LabResult {
  name: string;
  value: number;
  unit: string;
  low?: number;
  high?: number;
  refText: string;
  flag: 'high' | 'low' | 'normal';
  recordId: string;
  recordTitle: string;
  meaning?: string;
}

interface Info {
  what: string;
  high?: string;
  low?: string;
}

const INFO: Record<string, Info> = {
  hemoglobin: { what: 'Carries oxygen in red blood cells.', low: 'Low haemoglobin (anaemia) can cause tiredness, pallor or breathlessness; common causes are iron deficiency and blood loss.', high: 'High values can come from dehydration, smoking or living at altitude.' },
  hematocrit: { what: 'Share of blood made of red cells.', low: 'Often goes hand-in-hand with anaemia.' },
  wbc: { what: 'White blood cells fight infection.', high: 'Often a sign of infection or inflammation.', low: 'Can follow viral infections or some medicines.' },
  platelets: { what: 'Help blood clot.', low: 'Low counts raise bleeding risk.', high: 'High counts can occur with inflammation or iron deficiency.' },
  mcv: { what: 'Average red-cell size.', low: 'Small red cells (microcytosis) — often iron deficiency.', high: 'Large red cells — sometimes low B12/folate.' },
  glucose: { what: 'Blood sugar.', high: 'Fasting values of 126 mg/dL or more on repeat testing point to diabetes; 100–125 suggests pre-diabetes.', low: 'Low sugar can cause shakiness and sweating.' },
  hba1c: { what: 'Average blood sugar over ~3 months.', high: '5.7–6.4% is pre-diabetes, 6.5% or above suggests diabetes. Many people with diabetes aim for below 7%.' },
  creatinine: { what: 'Waste product cleared by the kidneys.', high: 'May mean the kidneys are filtering less efficiently, or dehydration.' },
  egfr: { what: 'Estimated kidney filtration rate.', low: 'Below 60 suggests reduced kidney function.' },
  sodium: { what: 'Key salt that balances body fluids.', high: 'Usually dehydration.', low: 'Can come from excess water, some medicines or heart/kidney conditions.' },
  potassium: { what: 'Mineral crucial for heart rhythm and muscles.', high: 'High potassium can affect heart rhythm — needs prompt review.', low: 'Low potassium can cause weakness or cramps.' },
  'total cholesterol': { what: 'All cholesterol in the blood.', high: 'High cholesterol raises the long-term risk of heart disease and stroke.' },
  'ldl cholesterol': { what: '"Bad" cholesterol.', high: 'The main target for cholesterol-lowering treatment.' },
  ldl: { what: '"Bad" cholesterol.', high: 'The main target for cholesterol-lowering treatment.' },
  'hdl cholesterol': { what: '"Good" cholesterol.', low: 'Low HDL is a heart-disease risk factor; exercise and not smoking help.' },
  hdl: { what: '"Good" cholesterol.', low: 'Low HDL is a heart-disease risk factor; exercise and not smoking help.' },
  triglycerides: { what: 'Fat in the blood.', high: 'Often linked to sugar/refined-carb intake, alcohol, excess weight or diabetes.' },
  tsh: { what: 'Thyroid-stimulating hormone.', high: 'Suggests an under-active thyroid.', low: 'Suggests an over-active thyroid.' },
  ferritin: { what: 'Iron stores.', low: 'Low ferritin means iron deficiency.' },
  troponin: { what: 'Heart-muscle damage marker.', high: 'Raised levels suggest heart muscle injury.' },
};

const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const ROW =
  /^[ \t]*([A-Za-z][A-Za-z0-9 ()/%,.+-]{1,38}?)[ \t]{2,}(\d+(?:\.\d+)?)[ \t]*([HLhl*]{1,2})?[ \t]+(?:(\d+(?:\.\d+)?)[ \t]*[-–][ \t]*(\d+(?:\.\d+)?)|([<>≤≥][ \t]*\d+(?:\.\d+)?))(?:[ \t]{2,}(\S.*?))?[ \t]*$/gm;

export function parseLabs(text: string, recordId: string, recordTitle: string): LabResult[] {
  const out: LabResult[] = [];
  for (const m of text.matchAll(ROW)) {
    const [, rawName, v, flagCh, lo, hi, cmp, unit] = m;
    const value = Number(v);
    let low: number | undefined;
    let high: number | undefined;
    let refText = '';
    if (lo !== undefined && hi !== undefined) {
      low = Number(lo);
      high = Number(hi);
      refText = `${lo}–${hi}`;
    } else if (cmp) {
      const n = Number(cmp.replace(/[^0-9.]/g, ''));
      if (/[<≤]/.test(cmp)) high = n;
      else low = n;
      refText = cmp.replace(/\s+/g, ' ');
    }
    let flag: LabResult['flag'] = 'normal';
    if (flagCh && /h/i.test(flagCh)) flag = 'high';
    else if (flagCh && /l/i.test(flagCh)) flag = 'low';
    else if (high !== undefined && value > high) flag = 'high';
    else if (low !== undefined && value < low) flag = 'low';
    const name = rawName.trim().replace(/\s+/g, ' ');
    const info = INFO[norm(name)];
    const meaning = info ? (flag === 'high' ? info.high : flag === 'low' ? info.low : undefined) ?? info.what : undefined;
    out.push({ name, value, unit: (unit ?? '').split(/\s{2,}/)[0], low, high, refText, flag, recordId, recordTitle, meaning });
  }
  return out;
}

export function describeTest(name: string): string | undefined {
  return INFO[norm(name)]?.what;
}
