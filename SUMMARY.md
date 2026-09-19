# MediKey — Project Summary

**Zero-trust medical record aggregator.** *Your medical history. Your keys. Nobody's server.*

---

## 1. The problem

Patients' health data is scattered across hospital portals, PDFs, scans, lab text and wearables. Consolidating it and sharing it with a new specialist or researcher is tedious, and it usually means emailing raw records full of personal identifiers. The usual fix — a cloud "health locker" — becomes one more centralized honeypot in the most-breached industry, and a leaked medical history can never be changed.

**The question we answered:** what if the server simply *couldn't* read your data?

## 2. The solution in one paragraph

MediKey is a local-first web app. Keys are generated in the browser, files are parsed and OCR'd on-device, personal identifiers are redacted *before* anything is encrypted, and records live encrypted on the patient's own device. To share, the patient makes a link that is end-to-end encrypted, time-boxed, and revocable. The only server involved is a **blind relay** that holds ciphertext and one useless-on-its-own half of the key. Revoking (or expiry) destroys that half, so the shared data becomes permanently unreadable, even if a copy was pinned to IPFS.

---

## 3. Problem statement → what we built

| Requirement from the brief | How MediKey delivers it |
|---|---|
| **Authentication** — secure login with client-side cryptographic keys | A 256-bit seed is generated in the browser and derives an Ed25519 identity and an AES-256 vault key. The seed is wrapped with the user's passphrase using Argon2id (64 MiB) and AES-GCM. A 14-group recovery key with a checksum restores the identity. No account, no email, no server. Auto-lock wipes keys from memory. |
| **Document Vault** — aggregate PDFs, lab reports, raw text | Upload or paste PDFs (text or scanned), images, TXT and CSV. PDF text is extracted locally; scans and photos go through bundled on-device OCR (Tesseract WASM). Each record is AES-256-GCM encrypted in IndexedDB and bound to its own id. |
| **Privacy Engine** — client-side PII redaction before encryption | Layered detector for names, IDs, phones, emails, addresses, dates, SSN, Aadhaar, PAN and cards. Per-item review, manual selection redaction, a HIPAA-Safe-Harbor-style Strict mode, and a second-pass leak scan. The original file is discarded. |
| **Access Dashboard** — generate, manage, revoke links | Create links with recipient, records, expiry (1 h–30 days), view limit, and access mode. See live status, countdowns, open counts and an access log. QR codes. One-click revoke. |
| **Provider Portal** — read-only view for verified professionals | Decrypts in the provider's browser, verifies the patient's Ed25519 signature, and shows a read-only, watermarked, print-blocked view that wipes itself at expiry. |
| **Stretch: Time-bound access** | Server-enforced expiry and burn-after-reading. Expiry or revocation deletes the relay's key half, which makes the data cryptographically unreadable, not just hidden. |
| **Stretch: AI Health Copilot (secure RAG)** | Fully on-device: BM25 retrieval over sanitized chunks, a medical glossary, a lab reference-range engine, and citations. No data leaves the browser. |
| **Stretch: Vitals & time-series dashboard** | Blood pressure, glucose and wearable CSVs are auto-mapped and charted. ECG waveforms get R-peak detection, heart rate and HRV. |
| **Stretch: Decentralized storage** | Encrypted, content-addressed shards can be stored on IPFS (Kubo API plus any gateway) instead of the relay. |

---

## 4. Feature list

### Identity & vault
- Client-side key generation, passphrase unlock, recovery-key restore, auto-lock
- Encrypted local vault (IndexedDB), per-record encryption with AAD binding
- Encrypted `.medikey` backup export/import; erase-device
- Search and filter across sanitized records; per-record privacy report

### Ingestion
- PDF text-layer extraction
- On-device OCR for scans and photos (assets bundled locally, no CDN)
- TXT, pasted text, CSV; automatic detection of vitals vs. text CSVs
- Eight synthetic sample documents, including a scanned prescription image

### Privacy Engine
- Detects: person and clinician names, DOB and other dates, SSN, Aadhaar, PAN, phone, email, addresses, ZIP/PIN, MRN/UHID/accession, insurance IDs, URLs, IPs, Luhn-checked cards, ages 90+, facility names
- Detection layers: structured patterns, label-anchored fields, context cues (titles, "Dear…", relationship cues), name propagation across the text, and your own always-scrub identifiers
- Balanced vs. Strict (dates reduced to year, clinician and facility names removed) modes
- Click-to-toggle highlights, select-to-redact (with "all occurrences"), sanitized preview, and a residual leak warning

### Sharing & access control
- **Split-key protocol:** `K = Ka ⊕ Kb`; `Ka` lives only in the URL fragment and `Kb` on the relay
- Three link modes: anyone-with-link, passcode (Argon2id, checked locally), or bound to a clinician's X25519 key
- Signed manifests (Ed25519); shard integrity by SHA-256 plus AES-GCM tags
- Expiry, view limits, burn-after-reading, revocation, live "1 open" monitoring, QR codes
- Relay or IPFS shard storage; a mock IPFS node for demos without installing IPFS

### Provider Portal
- Clinician key generator (`MKP-…` ID); link-paste entry
- Signature verified badge, expiry countdown, views-left counter
- Read-only, watermarked, print-blocked, searchable, and wipes on expiry or "Close & wipe"

### Vitals & time-series
- BP, pulse, glucose, weight, SpO₂, HRV, sleep and steps with trend statistics and normal-range bands
- BP staging (average and classification)
- ECG paper-grid rendering, R-peak detection, heart rate, RMSSD/SDNN, and an irregular-rhythm flag

### AI Health Copilot
- Answers: abnormal labs, medications with plain-language classes, health summary, vitals trends, "what is X"
- Glossary of common clinical terms and abbreviations, and reference ranges for common tests
- Every answer cites its source records
- Optional rephrasing through the browser's built-in on-device model, where available

### Security transparency
- A live network ledger of every request the app makes
- A view of the raw ciphertext stored at rest
- An in-browser cryptographic self-test (AES-GCM, tamper detection, signatures, split-key, sealing)
- A threat model with honest limitations

### UX
- Liquid Glass design on black: translucent blurred surfaces, specular rims, pill controls, floating sidebar and phone tab bar
- Responsive from phone to desktop; keyboard-accessible; honors reduced-motion and reduced-transparency

---

## 5. How it maps to the judging criteria

| Criterion | Evidence |
|---|---|
| **Innovation (25%)** | Split-key sharing with cryptographic revocation; clinician-bound links; signed manifests; on-device RAG; IPFS shards that stay safe to publish; Zero-Trust Ledger; ECG analysis in the browser |
| **Functionality (25%)** | The full loop works end to end: create vault → add and sanitize → encrypt → share → provider opens → revoke → provider locked out |
| **UI/UX (20%)** | Review-before-encrypt flow, clear trust messaging, accessible controls, Liquid Glass design, phone support |
| **Technical execution (20%)** | WebCrypto AES-GCM plus audited noble libraries (no hand-rolled crypto), a signed-request relay API with hardening, and 37 automated tests including a malicious-relay tamper test |
| **Impact (10%)** | Patient-controlled sharing, de-identified data that institutions can actually accept, consent-based research access |

---

## 6. Architecture at a glance

```
Patient browser  ──ciphertext shards + Kb + signed manifest──▶  Blind relay (or IPFS)
      │                                                                 ▲
      └── link #fragment carries Ka (never sent to a server) ──▶  Provider browser
                                                     K = Ka ⊕ Kb → verify → decrypt → read-only view
```

| Component | Can see | Cannot |
|---|---|---|
| Patient browser | Everything, in memory only while unlocked | — |
| Relay / IPFS | Ciphertext, one key half, signed manifest, open count | Read data or identify anyone |
| Provider browser | Link half plus the decrypted shared bundle | See anything not shared, or keep access after expiry |

**Stack:** React 19 + TypeScript + Vite; Express 5 relay; WebCrypto, `@noble/curves`, `@noble/hashes`; pdf.js; Tesseract.js; vitest.

---

## 7. Honest limitations

- PII detection is rule-based, tuned to US and India formats, and meant for human review. It is not a guarantee.
- Revocation stops future access but cannot un-see what a provider already viewed. Screenshots can't be prevented.
- Clinician keys are self-issued in this prototype; production needs credential-backed identity.
- The vault is local-first: clearing browser data without a backup loses it.
- IPFS was only tested against the mock node, not a real Kubo node.
- The optional on-device model rewording depends on browser support and wasn't exercised.
- Prototype with synthetic data only. Not a medical device.

---

## 8. Future scope

**Security & identity**
- Passkey / WebAuthn unlock instead of a typed passphrase
- Verifiable-credential or NPI-registry-backed clinician identity
- Shamir-split social recovery of the seed
- Tamper-evident consent receipts, optionally anchored on-chain

**Data ingestion & interoperability**
- FHIR / HL7 importers, and Apple Health / Google Health Connect connectors
- Scanned-report table extraction; multilingual OCR and PII detection
- DICOM thumbnails and imaging-report parsing

**Intelligence**
- A local LLM (WebLLM / browser built-in AI) behind the same retrieval layer for richer explanations
- Trend alerts and medication-interaction hints, all on-device
- ML-assisted PII detection that runs locally, alongside the rules

**Sharing & scale**
- Encrypted multi-device sync over IPFS with conflict-free merging
- Consented research cohorts with k-anonymity and differential-privacy aggregates
- Hospital and EHR integration for one-click, patient-approved record push
- Organization-hosted relays (self-hostable, with an audit dashboard)

**Product**
- Native mobile wrapper (PWA/Capacitor) with biometric unlock
- Emergency-access mode (break-glass link with a delay and patient notification)
- Caregiver and family delegation with scoped, expiring permissions
