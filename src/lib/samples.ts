import type { RecordKind } from './types';

export interface Sample {
  file: string;
  label: string;
  kind: RecordKind;
  blurb: string;
}

export const SAMPLES: Sample[] = [
  { file: 'lab-report-gonzalez.txt', label: 'Lab report (US)', kind: 'lab', blurb: 'CBC, metabolic & lipid panels · SSN, MRN, address, insurance' },
  { file: 'discharge-summary-verma.txt', label: 'Discharge summary (India)', kind: 'discharge', blurb: 'NSTEMI + stent · Aadhaar, PAN, +91 phone, UHID' },
  { file: 'cardiology-letter-okafor.txt', label: 'Cardiology letter', kind: 'clinical-note', blurb: 'Referral letter · names without labels, relatives' },
  { file: 'visit-summary-whitaker.pdf', label: 'Clinic visit (PDF)', kind: 'clinical-note', blurb: 'Real PDF with a text layer' },
  { file: 'prescription-scan.jpg', label: 'Scanned prescription (OCR)', kind: 'prescription', blurb: 'A photo/scan — read with on-device OCR' },
  { file: 'bp-glucose-log.csv', label: 'Home BP & glucose log', kind: 'vitals', blurb: '45 days · trend chart' },
  { file: 'ecg-10s-250hz.csv', label: 'ECG waveform (10 s)', kind: 'vitals', blurb: '250 Hz · R-peaks, HR, HRV' },
  { file: 'wearable-daily.csv', label: 'Wearable daily export', kind: 'vitals', blurb: 'Resting HR, HRV, sleep, steps, SpO₂' },
];

export async function loadSample(s: Sample): Promise<File> {
  const res = await fetch(`${import.meta.env.BASE_URL}samples/${s.file}`);
  if (!res.ok) throw new Error(`Could not load ${s.file}`);
  const blob = await res.blob();
  const type = s.file.endsWith('.pdf') ? 'application/pdf' : s.file.endsWith('.csv') ? 'text/csv' : s.file.endsWith('.jpg') ? 'image/jpeg' : 'text/plain';
  return new File([blob], s.file, { type });
}
