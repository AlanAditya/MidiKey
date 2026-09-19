import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, Link2, ShieldCheck, Stethoscope, Trash2 } from 'lucide-react';
import { CopyButton, Logo } from '../components/common';
import { parseShareLink } from '../lib/share';
import { createProviderKey, deleteProviderKey, loadProviderKey, providerId, type ProviderKey } from '../lib/providerKey';

export default function ProviderHome() {
  const nav = useNavigate();
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const [key, setKey] = useState<ProviderKey | null>(loadProviderKey());
  const [name, setName] = useState('');

  const go = () => {
    const p = parseShareLink(link);
    if (!p) return setErr('That does not look like a MediKey access link.');
    nav(`/p/${p.id}/${p.secret}`);
  };

  return (
    <div className="landing" style={{ maxWidth: 900 }}>
      <header className="topbar">
        <Link to="/" className="brand" style={{ padding: 0 }}><Logo /> <span>MediKey<small>Provider portal</small></span></Link>
        <span className="grow" />
        <Link to="/" className="btn ghost"><ArrowLeft size={16} /> Patient sign-in</Link>
      </header>
      <h1><Stethoscope size={30} style={{ verticalAlign: '-4px' }} /> Provider portal</h1>
      <p className="lead">Open records a patient chose to share with you. Decryption happens in <b>your</b> browser; MediKey's server cannot read them, and access ends automatically when the patient's timer runs out or they revoke it.</p>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <section className="card glow stack" aria-labelledby="open-h">
          <h2 id="open-h" style={{ margin: 0 }}><Link2 size={19} style={{ verticalAlign: '-3px' }} /> Open a shared link</h2>
          <label className="field" style={{ margin: 0 }}>
            <span className="lbl">Access link</span>
            <textarea value={link} onChange={(e) => { setLink(e.target.value); setErr(''); }} placeholder="Paste the link the patient sent you…" style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', minHeight: 100 }} spellCheck={false} />
            {err && <div className="hint" role="alert" style={{ color: 'var(--danger)' }}>{err}</div>}
          </label>
          <button className="btn primary lg" disabled={!link.trim()} onClick={go}>Continue</button>
        </section>

        <section className="card flat stack" aria-labelledby="key-h">
          <h2 id="key-h" style={{ margin: 0 }}><KeyRound size={19} style={{ verticalAlign: '-3px' }} /> Your clinician key</h2>
          <p className="small muted" style={{ margin: 0 }}>Patients can bind a link to this key so that it opens <b>only</b> for you — even if the URL leaks. The private half never leaves this browser.</p>
          {key ? (
            <>
              <div className="notice ok"><ShieldCheck size={18} /><div>Key ready{key.name ? <> for <b>{key.name}</b></> : ''}. Send this ID to the patient:</div></div>
              <div className="cipher" style={{ color: 'var(--accent)' }}>{providerId(key.pub)}</div>
              <div className="row">
                <CopyButton text={providerId(key.pub)} label="Copy clinician ID" className="btn primary sm" />
                <button className="btn danger sm right" onClick={() => { if (confirm('Delete this clinician key? Links bound to it can no longer be opened.')) { deleteProviderKey(); setKey(null); } }}><Trash2 size={14} /> Delete key</button>
              </div>
            </>
          ) : (
            <>
              <label className="field" style={{ margin: 0 }}>
                <span className="lbl">Display name (optional, stays local)</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Chen — Cardiology" />
              </label>
              <button className="btn" onClick={() => setKey(createProviderKey(name))}><KeyRound size={16} /> Generate clinician key</button>
            </>
          )}
          <p className="hint" style={{ margin: 0 }}>Prototype note: keys are self-issued. A production deployment would bind them to NPI / hospital-issued verifiable credentials.</p>
        </section>
      </div>
    </div>
  );
}
