import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Activity, Bot, Fingerprint, KeyRound, Link2, Lock, LockKeyhole, Loader2, ShieldCheck, Stethoscope, Timer, Upload, Eraser, Download, Server, EyeOff } from 'lucide-react';
import { Logo, CopyButton, download, passphraseStrength } from '../components/common';
import { useVault } from '../state/VaultContext';
import { useToast } from '../state/Toast';
import { readPublicIdentity } from '../lib/keystore';
import { fingerprintOf, pubFromString } from '../lib/identity';
import { useEffect } from 'react';

export default function Landing() {
  const v = useVault();
  if (v.status === 'unlocked') return <Navigate to="/vault" replace />;

  return (
    <div className="landing">
      <header className="topbar">
        <Link to="/" className="brand" style={{ padding: 0 }}>
          <Logo /> <span>MediKey<small>Zero-trust medical vault</small></span>
        </Link>
        <span className="grow" />
        <Link to="/provider" className="btn ghost"><Stethoscope size={17} /> I'm a provider</Link>
      </header>

      <section className="hero">
        <div>
          <span className="pill accent"><Lock size={13} /> Keys never leave your device</span>
          <h1 style={{ marginTop: 14 }}>Your medical history.<br /><em>Your keys.</em> Nobody's server.</h1>
          <p className="lead">
            MediKey gathers scattered lab reports, PDFs and wearable data into one encrypted vault, scrubs personal identifiers <b>on your device</b>,
            and lets you share with a doctor through a link that <b>expires</b>, can be <b>revoked</b>, and that the server itself cannot read.
          </p>
          <div className="trustbar">
            <span><Fingerprint size={17} /> Client-side keys (Ed25519 + AES-256)</span>
            <span><EyeOff size={17} /> PII redacted before encryption</span>
            <span><Server size={17} /> Blind relay: ciphertext only</span>
          </div>
        </div>
        <AuthPanel />
      </section>

      <section aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <div className="steps">
          <div className="card"><h3>Generate keys</h3><p className="muted small">A 256-bit secret is created in your browser. It is wrapped with your passphrase (Argon2id) and never uploaded.</p></div>
          <div className="card"><h3>Add records</h3><p className="muted small">Drop PDFs, scans, lab text or CSVs. Parsing and OCR happen locally.</p></div>
          <div className="card"><h3>Sanitize</h3><p className="muted small">The privacy engine flags names, IDs, phones, addresses and dates. You review, then only the redacted text is encrypted.</p></div>
          <div className="card"><h3>Share &amp; revoke</h3><p className="muted small">Create a time-boxed link for one clinician. Revoke any time — the key half is destroyed and the data becomes unreadable.</p></div>
        </div>
      </section>

      <section style={{ marginTop: 34 }} aria-labelledby="feat">
        <h2 id="feat">Built for patients and clinicians</h2>
        <div className="grid cols-3">
          {[
            [ShieldCheck, 'Privacy Engine', 'Layered PII detection with HIPAA Safe-Harbor mode, per-item review and manual redaction.'],
            [Link2, 'Split-key sharing', 'The decryption key is split: one half in the link fragment, one half on a relay that forgets it on expiry.'],
            [Timer, 'Time-bound access', 'Links self-destruct in 1 h – 30 days, with optional view limits and passcodes.'],
            [Stethoscope, 'Verified providers', 'Bind a link to a clinician\'s own key so a leaked URL is useless. Manifests are signed and verified.'],
            [Bot, 'On-device Copilot', 'RAG over your sanitized records explains jargon and lab flags — no data leaves the browser.'],
            [Activity, 'Vitals & ECG', 'Import BP, glucose, wearable CSVs and ECG waveforms; see trends, R-peaks, HR and HRV.'],
          ].map(([Icon, title, body]) => {
            const I = Icon as typeof ShieldCheck;
            return (
              <div className="card" key={title as string}>
                <div className="feature-ico"><I size={20} /></div>
                <h3>{title as string}</h3>
                <p className="muted small" style={{ margin: 0 }}>{body as string}</p>
              </div>
            );
          })}
        </div>
      </section>
      <p className="muted small center" style={{ marginTop: 36 }}>
        Hackathon prototype — uses synthetic sample data. Not a medical device; not a substitute for professional care.
      </p>
    </div>
  );
}

function AuthPanel() {
  const v = useVault();
  const [tab, setTab] = useState<'create' | 'restore'>('create');
  if (v.status === 'loading')
    return <div className="card glow center"><Loader2 className="spin" /> Opening secure storage…</div>;
  if (v.status === 'locked' && tab === 'create') return <Unlock onRestore={() => setTab('restore')} />;
  if (v.status === 'locked' && tab === 'restore') return <Restore onBack={() => setTab('create')} reset />;
  return (
    <div className="card glow pad-lg">
      <div className="seg" role="tablist" style={{ marginBottom: 16 }}>
        <button role="tab" aria-selected={tab === 'create'} onClick={() => setTab('create')}>Create vault</button>
        <button role="tab" aria-selected={tab === 'restore'} onClick={() => setTab('restore')}>Restore</button>
      </div>
      {tab === 'create' ? <Create /> : <Restore onBack={() => setTab('create')} />}
    </div>
  );
}

function Create() {
  const v = useVault();
  const toast = useToast();
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState('');
  const st = passphraseStrength(pass);
  const ok = st.bits >= 40 && pass === pass2;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { recoveryKey } = await v.createVault(pass);
      setRecovery(recoveryKey);
    } catch (err) {
      toast((err as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  if (recovery) {
    const groups = recovery.split('-');
    const first = groups[0];
    return (
      <div className="stack">
        <h2 style={{ margin: 0 }}>Save your recovery key</h2>
        <div className="notice warn"><KeyRound size={18} /><div>This 256-bit key is the <b>only</b> way back into your vault if you forget your passphrase. MediKey cannot recover it — there is no server copy.</div></div>
        <div className="recovery" aria-label="Recovery key">{groups.map((g, i) => <span key={i}>{g}</span>)}</div>
        <div className="row">
          <CopyButton text={recovery} label="Copy key" />
          <button className="btn sm" onClick={() => download('medikey-recovery-key.txt', new Blob([`MediKey recovery key\n\n${recovery}\n\nKeep this offline. Anyone with this key can open your vault.\n`], { type: 'text/plain' }))}><Download size={15} /> Download .txt</button>
        </div>
        <label className="field">
          <span className="lbl">Type the first group ({first.length} characters) to confirm you have it</span>
          <input type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} placeholder="e.g. ABCD" />
        </label>
        <label className="check small"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I stored this key somewhere safe and offline.</label>
        <button className="btn primary lg block" disabled={!saved || confirm.trim().toUpperCase() !== first} onClick={() => v.completeSetup().catch((e) => toast(e.message, 'bad'))}>
          <LockKeyhole size={18} /> Open my vault
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <div>
        <h2 style={{ margin: 0 }}>Create your vault</h2>
        <p className="muted small" style={{ margin: '4px 0 0' }}>Keys are generated right here in your browser.</p>
      </div>
      <label className="field" style={{ margin: 0 }}>
        <span className="lbl">Passphrase</span>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" aria-describedby="pw-hint" />
        <div className="strength" aria-hidden="true"><i style={{ width: `${pass ? st.pct : 0}%`, background: st.color }} /></div>
        <div className="hint" id="pw-hint">{pass ? `${st.label} · ~${Math.round(st.bits)} bits. Use 4+ random words for a strong, memorable passphrase.` : 'Encrypts your keys on this device. Try four random words.'}</div>
      </label>
      <label className="field" style={{ margin: 0 }}>
        <span className="lbl">Confirm passphrase</span>
        <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
        {pass2 && pass !== pass2 && <div className="hint" style={{ color: 'var(--danger)' }}>Passphrases don't match.</div>}
      </label>
      <button className="btn primary lg block" type="submit" disabled={!ok || busy}>
        {busy ? <><Loader2 size={18} className="spin" /> Deriving keys (Argon2id)…</> : <><KeyRound size={18} /> Generate keys on this device</>}
      </button>
      <p className="hint" style={{ margin: 0 }}>No email, no account, no server involved.</p>
    </form>
  );
}

function Unlock({ onRestore }: { onRestore: () => void }) {
  const v = useVault();
  const toast = useToast();
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fp, setFp] = useState('');
  useEffect(() => {
    readPublicIdentity().then((p) => p && setFp(fingerprintOf(pubFromString(p))));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await v.unlock(pass);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card glow pad-lg stack" onSubmit={submit}>
      <div>
        <h2 style={{ margin: 0 }}>Unlock your vault</h2>
        {fp && <p className="muted small" style={{ margin: '4px 0 0' }}>Identity <span className="mono" style={{ color: 'var(--accent)' }}>{fp}</span></p>}
      </div>
      <label className="field" style={{ margin: 0 }}>
        <span className="lbl">Passphrase</span>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus autoComplete="current-password" aria-invalid={!!err} aria-describedby={err ? 'unlock-err' : undefined} />
        {err && <div className="hint" id="unlock-err" role="alert" style={{ color: 'var(--danger)' }}>{err}</div>}
      </label>
      <button className="btn primary lg block" disabled={!pass || busy}>{busy ? <><Loader2 size={18} className="spin" /> Unlocking…</> : <><LockKeyhole size={18} /> Unlock</>}</button>
      <div className="row">
        <button type="button" className="btn ghost sm" onClick={onRestore}>Forgot passphrase? Use recovery key</button>
        <button
          type="button"
          className="btn ghost sm right"
          onClick={async () => {
            if (confirm('Erase the vault and ALL encrypted records from this device? This cannot be undone.')) {
              await v.eraseDevice();
              toast('Device erased.', 'ok');
            }
          }}
        ><Eraser size={14} /> Erase device</button>
      </div>
    </form>
  );
}

function Restore({ onBack, reset }: { onBack: () => void; reset?: boolean }) {
  const v = useVault();
  const [key, setKey] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const st = passphraseStrength(pass);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await v.restore(key, pass);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={reset ? 'card glow pad-lg stack' : 'stack'} onSubmit={submit}>
      <div>
        <h2 style={{ margin: 0 }}>{reset ? 'Reset passphrase' : 'Restore from recovery key'}</h2>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          {reset ? 'Enter your recovery key and choose a new passphrase. Records on this device stay readable.' : 'Re-creates your identity on this device. Import an encrypted backup afterwards to bring your records back.'}
        </p>
      </div>
      <label className="field" style={{ margin: 0 }}>
        <span className="lbl">Recovery key (14 groups)</span>
        <textarea value={key} onChange={(e) => setKey(e.target.value)} placeholder="ABCD-EFGH-…" spellCheck={false} style={{ fontFamily: 'var(--mono)', minHeight: 84 }} />
        {err && <div className="hint" role="alert" style={{ color: 'var(--danger)' }}>{err}</div>}
      </label>
      <label className="field" style={{ margin: 0 }}>
        <span className="lbl">New passphrase</span>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
        <div className="strength" aria-hidden="true"><i style={{ width: `${pass ? st.pct : 0}%`, background: st.color }} /></div>
      </label>
      <button className="btn primary lg block" disabled={!key.trim() || st.bits < 40 || busy}>{busy ? <><Loader2 size={18} className="spin" /> Deriving keys…</> : <><Upload size={18} /> Restore</>}</button>
      <button type="button" className="btn ghost sm" onClick={onBack}>← Back</button>
    </form>
  );
}
