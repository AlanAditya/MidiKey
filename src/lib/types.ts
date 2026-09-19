export type RecordKind = 'lab' | 'imaging' | 'prescription' | 'discharge' | 'clinical-note' | 'vitals' | 'other';

export const RECORD_KINDS: { value: RecordKind; label: string }[] = [
  { value: 'lab', label: 'Lab report' },
  { value: 'clinical-note', label: 'Clinical note' },
  { value: 'discharge', label: 'Discharge summary' },
  { value: 'prescription', label: 'Prescription' },
  { value: 'imaging', label: 'Imaging report' },
  { value: 'vitals', label: 'Vitals / wearable data' },
  { value: 'other', label: 'Other' },
];

export interface RedactionSummary {
  mode: PrivacyMode;
  total: number;
  counts: Record<string, number>;
}

export type PrivacyMode = 'strict' | 'balanced';

export interface VitalsSeries {
  key: string; // e.g. "systolic"
  label: string;
  unit: string;
  values: (number | null)[];
}

export interface VitalsDataset {
  type: 'timeseries' | 'ecg';
  /** epoch ms for timeseries; seconds-from-start for ECG */
  t: number[];
  series: VitalsSeries[];
  /** ECG only */
  sampleRate?: number;
  source: string;
}

export interface HealthRecord {
  id: string;
  title: string;
  kind: RecordKind;
  /** ISO date of the encounter/report (user-chosen, may be empty) */
  date?: string;
  source: { filename: string; mime: string; size: number; method: string };
  /** Sanitized text — the original document is never stored. */
  text: string;
  redaction: RedactionSummary;
  vitals?: VitalsDataset;
  createdAt: number;
}

export type GrantStatus = 'active' | 'expired' | 'revoked';

export interface GrantRecord {
  id: string;
  label: string;
  recipientType: 'doctor' | 'researcher' | 'other';
  createdAt: number;
  expiresAt: number;
  maxViews: number | null;
  recordIds: string[];
  /** full link is stored (encrypted) so the patient can re-copy it */
  link: string;
  passcode: boolean;
  boundToProvider: boolean;
  backend: 'relay' | 'ipfs';
  shardCount: number;
  bytes: number;
  status: GrantStatus;
  views: number;
  lastViewedAt?: number;
  log?: { t: number; event: string }[];
}

export interface Settings {
  privacyMode: PrivacyMode;
  identifiers: string[]; // names/phones/emails the user wants always scrubbed
  storage: { backend: 'relay' | 'ipfs'; relayUrl: string; ipfsApi: string; ipfsGateway: string };
  autoLockMinutes: number;
  theme: 'dark' | 'light';
}

export const DEFAULT_SETTINGS: Settings = {
  privacyMode: 'balanced',
  identifiers: [],
  storage: { backend: 'relay', relayUrl: '', ipfsApi: 'http://127.0.0.1:5001', ipfsGateway: 'http://127.0.0.1:8080' },
  autoLockMinutes: 10,
  theme: 'dark',
};
