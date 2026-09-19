# MediKey — 3-Minute Pitch

**Tagline:** *Your medical history. Your keys. Nobody's server.*
Total ≈ 3:00 · speak ~130 wpm · demo runs live in the app (keep the relay + app open in two tabs: **patient** and **provider**).

---

## 0:00 – 0:35 · The problem  *(slide: a pile of PDFs + a padlock with a crack)*

> "Everyone in this room has health data in at least five places: a hospital portal, a lab PDF, a photo of a prescription, a smartwatch.
> When you finally see a new specialist, you either send everything — names, addresses, insurance IDs, the lot — over email or WhatsApp,
> or you carry nothing and start from zero.
> The 'fix' is a cloud health locker… which just becomes one more honeypot. Healthcare is the most breached industry — and once a record leaks, you can't change your medical history.
> **We asked: what if the server simply *couldn't* read your data?**"

## 0:35 – 1:15 · What MediKey is  *(slide: architecture — patient browser · blind relay · provider browser)*

> "MediKey is a zero-trust vault that runs in your browser.
> **One:** your identity is a cryptographic key generated on your device — no account, no email.
> **Two:** drop in PDFs, scans, lab text, wearable CSVs. Parsing and OCR happen locally.
> **Three:** our **privacy engine** finds names, MRNs, SSNs, Aadhaar, phones, addresses and dates — you review every item — and *only then* is the sanitized text encrypted with AES-256.
> **Four:** to share, we split the decryption key in two. One half lives **only in the link's fragment**, which never reaches any server. The other half sits on a *blind relay* that stores nothing but ciphertext.
> When the timer runs out, or you hit revoke, the relay **destroys its half** — and the data is mathematically unreadable. Even if it was pinned to IPFS."

## 1:15 – 2:30 · Live demo  *(75 s — rehearse this; every step below is real)*

1. *(Landing)* "Keys generate right here — Argon2id-protected, plus a recovery key." → open vault (pre-created, samples loaded).
2. *(Add record → Lab report)* "Watch the privacy engine: patient name, SSN, MRN, address, insurance — struck through. Toggle **Strict** and every date drops to a year. I can select anything it missed. The second-pass scan says clean." → Encrypt & save.
3. *(Vitals)* "A 10-second ECG: R-peaks detected, 72 bpm, HRV — all client-side. And a 45-day blood-pressure trend."
4. *(Copilot)* Ask **"Which results are abnormal?"** "A private RAG pipeline — plain-language explanations with citations. Zero network requests."
5. *(Sharing → New link)* "Dr. Chen, 24 hours, 1 open, bound to *his* clinician key." → copy link.
6. *(Switch to provider tab)* "The doctor opens it: **signature verified**, countdown, read-only, watermarked. Names are placeholders — the doctor gets the clinical picture, not the identity."
7. *(Back to dashboard)* "I see the doctor opened it. Now — **Revoke**." → refresh provider tab: **"Access was revoked."**
8. *(Security tab)* "Zero third-party requests. This is what a thief with my disk sees — noise."

## 2:30 – 3:00 · Impact & what's next  *(slide: roadmap)*

> "Judges' rubric, in one line each: **functional** — vault, sanitization, sharing, portal, all working end-to-end with 37 automated tests including a malicious-relay tamper test.
> **Technical** — split-key sharing, signed manifests, clinician-bound links, IPFS shards.
> **Impact** — patients get control; hospitals get de-identified data they can actually accept; researchers get consent-based access.
> **Next:** passkey unlock, verifiable-credential identity for clinicians, FHIR import, a local LLM behind the same retrieval layer, and consented research cohorts with differential privacy.
> MediKey: *you hold the keys.* Thank you."

---

## Q&A cheat-sheet

| Question | Answer |
|---|---|
| *"What if your server is hacked?"* | It holds ciphertext + half a key. Nothing to steal. Tampering is caught by SHA-256 + AES-GCM tags + signatures. |
| *"Revocation can't un-see data."* | Correct — we say so. It stops all *future* access, including from copies of the ciphertext. Add view limits / burn-after-reading for one-shot sharing. |
| *"How do you verify a doctor?"* | Prototype: clinician-held X25519 keys bind the link to a person's key. Production: NPI / verifiable credentials — the hook is already there. |
| *"PII detection isn't perfect."* | Agreed — it's human-in-the-loop by design: confidence levels, per-item toggles, manual redaction, second-pass scan, personal-identifier list. |
| *"Where's the AI?"* | On-device RAG (BM25 retrieval + glossary + lab ranges) so no PHI ever reaches an LLM API; the retrieval layer is model-agnostic for a local LLM. |
| *"Why not blockchain?"* | Not needed for confidentiality. IPFS gives content-addressed decentralised storage; the kill-switch is a key, not a chain. |
| *"Forgot passphrase?"* | Recovery key restores identity; encrypted `.medikey` backups restore data. No server-side reset exists — by design. |

## Demo prep checklist
- [ ] `npm run start` (or deployed URL) — HTTPS if remote
- [ ] Two windows: patient (vault unlocked, samples loaded) and provider (blank)
- [ ] Clear old grants; create the link **live** (takes ~1 s)
- [ ] Optional: `npm run mock-ipfs` and switch Settings → IPFS to show decentralised shards
- [ ] Zoom the browser to ~110 % for the projector; dark theme reads best
