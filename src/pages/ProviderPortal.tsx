import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, Clock, Eye, FileLock2, Loader2, LockKeyhole, MessageSquareText, ShieldCheck, Ban, TimerOff, Search, X } from 'lucide-react';
import { Logo, KIND_ICON, PlaceholderText, fmtDate, fmtDuration, useNow } from '../components/common';
import { VitalsView } from './Vitals';
import { decodeSecret, NeedsPasscode, NeedsProviderKey, openShare, WrongCredential, type LinkSecret, type OpenedShare } from '../lib/share';
import { makeRelay, relayBase, RelayError } from '../lib/relay';
import { loadProviderKey } from '../lib/providerKey';
import { RECORD_KINDS } from '../lib/types';

type Phase = 'gate' | 'opening' | 'open' | 'dead';

export default function ProviderPortal() {
  const { id = '', secret = '' } = useParams();
  const [phase, setPhase] = useState<Phase>('gate');
  const [share, setShare] = useState<OpenedShare | null>(null);
  const [skew, setSkew] = useState(0);
  const [passcode, setPasscode] = useState('');
  const [err, setErr] = useState('');
  const [dead, setDead] = useState<{ kind: 'expired' | 'revoked' | 'exhausted' | 'unknown'; msg: string } | null>(null);
  const [preflight, setPreflight] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const providerKey = loadProviderKey();

  const link = useMemo<{ s: LinkSecret | null; bad: string }>(() => {
    try {
      return { s: decodeSecret(secret), bad: '' };
    } catch (e) {
      return { s: null, bad: (e as Error).message };
    }
  }, [secret]);

  // non-counting status probe so a dead link is reported before the provider does anything
  useEffect(() => {
    if (!link.s) return;
    makeRelay(relayBase(link.s.r)).status(id).then((r) => {
      if (r.status !== 'active') setDead({ kind: r.status as 'expired', msg: '' });
    }).catch((e) => {
      if (e instanceof RelayError && e.status === 404) setDead({ kind: 'unknown', msg: '' });
      else if (e instanceof RelayError && e.code === 'network') setPreflight(e.message);
    });
  }, [id, link.s]);

  const open = async () => {
    setPhase('opening');
    setErr('');
    try {
      const s = await openShare(id, secret, { passcode: passcode || undefined, providerPriv: providerKey?.priv });
      setSkew(s.serverTime - Date.now());
      setShare(s);
      setPhase('open');
    } catch (e) {
      setPhase('gate');
      if (e instanceof NeedsPasscode) setErr('Enter the passcode the patient gave you.');
      else if (e instanceof NeedsProviderKey) setErr('This link is bound to a clinician key. Generate or restore your key in the provider portal first.');
      else if (e instanceof WrongCredential) setErr((e as Error).message);
      else if (e instanceof RelayError && ['expired', 'revoked', 'exhausted', 'unknown'].includes(e.code ?? '')) setDead({ kind: e.code as 'expired', msg: e.message });
      else if (e instanceof RelayError && e.status === 404) setDead({ kind: 'unknown', msg: e.message });
      else setErr((e as Error).message);
    }
  };

  if (!link.s) return <Centered><DeadCard kind="unknown" title="Invalid link" body={link.bad} /></Centered>;
  if (closed)
    return (
      <Centered>
        <div className="card glow pad-lg gate center">
          <div className="big-ico"><ShieldCheck size={32} /></div>
          <h1 style={{ fontSize: '1.5rem' }}>Session closed</h1>
          <p className="muted">The decrypted records were wiped from this tab's memory. Re-opening the link may count as another view.</p>
          <Link className="btn" to="/provider">Provider portal</Link>
        </div>
      </Centered>
    );
  if (dead) return <Centered><DeadCard kind={dead.kind} /></Centered>;

  if (phase === 'open' && share) return <Viewer share={share} skew={skew} onClose={() => { setShare(null); setPhase('gate'); setClosed(true); }} />;

  const s = link.s;
  return (
    <Centered>
      <div className="card glow pad-lg gate stack">
        <div className="center">
          <div className="big-ico"><FileLock2 size={32} /></div>
          <h1 style={{ fontSize: '1.6rem' }}>A patient shared records with you</h1>
          <p className="muted">They are end-to-end encrypted. Your browser will decrypt them locally — MediKey's server cannot read them.</p>
        </div>
        {preflight && <div className="notice warn"><AlertTriangle size={18} /><div>{preflight}</div></div>}
        {s.m === 'passcode' && (
          <label className="field" style={{ margin: 0 }}>
            <span className="lbl">Passcode</span>
            <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoComplete="off" autoFocus onKeyDown={(e) => e.key === 'Enter' && passcode && open()} />
          </label>
        )}
        {s.m === 'bound' && (
          <div className={`notice ${providerKey ? 'ok' : 'warn'}`}>
            <ShieldCheck size={18} />
            <div>{providerKey ? <>Bound to a clinician key. Using your key{providerKey.name ? <> (<b>{providerKey.name}</b>)</> : ''}.</> : <>This link is bound to a specific clinician key. <Link to="/provider">Open the provider portal</Link> to use your key.</>}</div>
          </div>
        )}
        {err && <div className="notice bad" role="alert"><AlertTriangle size={18} /><div>{err}</div></div>}
        <button className="btn primary lg block" disabled={phase === 'opening' || (s.m === 'passcode' && !passcode)} onClick={open}>
          {phase === 'opening' ? <><Loader2 size={18} className="spin" /> Fetching &amp; decrypting…</> : <><LockKeyhole size={18} /> Decrypt &amp; open</>}
        </button>
        <ul className="hint" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Opening is logged for the patient (time only — no identity, no IP).</li>
          <li>Access is read-only and ends when the patient's timer expires or they revoke it.</li>
        </ul>
        <p className="center small" style={{ margin: 0 }}><Link to="/provider">Provider portal home</Link></p>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="center-screen">{children}</div>;
}

function DeadCard({ kind, title, body }: { kind: 'expired' | 'revoked' | 'exhausted' | 'unknown'; title?: string; body?: string }) {
  const map = {
    expired: { I: TimerOff, t: 'This access has expired', b: 'The patient set a time limit and it has passed. The decryption key was destroyed, so these records can no longer be opened by anyone. Ask the patient for a new link if you still need access.' },
    revoked: { I: Ban, t: 'Access was revoked', b: 'The patient withdrew access. The decryption key has been destroyed.' },
    exhausted: { I: Eye, t: 'View limit reached', b: 'This link could only be opened a limited number of times, and that limit has been used.' },
    unknown: { I: AlertTriangle, t: 'Link not found', b: 'This link does not exist or has been deleted.' },
  }[kind];
  return (
    <div className="card glow pad-lg gate center">
      <div className="big-ico bad"><map.I size={32} /></div>
      <h1 style={{ fontSize: '1.5rem' }}>{title ?? map.t}</h1>
      <p className="muted">{body ?? map.b}</p>
      <Link className="btn" to="/provider">Provider portal</Link>
    </div>
  );
}

/** Ticks on its own so only this tiny pill re-renders each second. */
function Countdown({ expiresAt, skew }: { expiresAt: number; skew: number }) {
  const left = expiresAt - (useNow(1000) + skew);
  return <span className={`timer pill ${left < 300e3 ? 'bad' : ''}`}><Clock size={13} /> Access ends in {fmtDuration(left)}</span>;
}

function Viewer({ share, skew, onClose }: { share: OpenedShare; skew: number; onClose: () => void }) {
  const [sel, setSel] = useState<string>('overview');
  const [q, setQ] = useState('');
  const [wiped, setWiped] = useState(false);
  const b = share.bundle;

  // Expiry is checked on a timer that only touches state when access actually ends,
  // so the (large) document is not re-rendered every second.
  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() + skew >= share.expiresAt) setWiped(true);
    }, 1000);
    return () => clearInterval(t);
  }, [skew, share.expiresAt]);

  // best-effort hygiene: drop the secret from the address bar so it isn't left in history/screenshares
  useEffect(() => {
    const t = setTimeout(() => history.replaceState(null, '', location.pathname + '#/provider'), 1500);
    return () => clearTimeout(t);
  }, []);

  const records = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? b.records.filter((r) => r.title.toLowerCase().includes(t) || r.text.toLowerCase().includes(t)) : b.records;
  }, [b, q]);
  const cur = b.records.find((r) => r.id === sel);

  if (wiped) return <Centered><DeadCard kind="expired" /></Centered>;

  const watermark = useMemo(() => {
    const wm = `MediKey · read-only · shared with ${b.recipient.label} · ${share.ownerFingerprint} · ${new Date(Date.now() + skew).toLocaleDateString()}`;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='190'><text x='0' y='110' transform='rotate(-24 210 95)' font-family='sans-serif' font-size='15' font-weight='700' fill='%23888'>${wm.replace(/[<>&']/g, '')}</text></svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  }, [b.recipient.label, share.ownerFingerprint, skew]);

  return (
    <div className="readonly">
      <div className="provider-bar">
        <Logo size={28} />
        <b>MediKey</b>
        <span className="pill info"><Eye size={12} /> Read-only</span>
        {share.verified && <span className="pill ok" title="The Ed25519 signature on the manifest verified against the patient's public key"><BadgeCheck size={13} /> Signature verified · {share.ownerFingerprint}</span>}
        <span className="pill"><ShieldCheck size={12} /> {share.mode === 'bound' ? 'Clinician-key bound' : share.mode === 'passcode' ? 'Passcode protected' : 'Link access'} · {share.backend === 'ipfs' ? 'IPFS shards' : 'relay shards'}</span>
        <span className="grow" />
        <Countdown expiresAt={share.expiresAt} skew={skew} />
        {share.viewsLeft !== null && <span className="pill warn">{share.viewsLeft} open{share.viewsLeft === 1 ? '' : 's'} left</span>}
        <button className="btn sm" onClick={onClose}><X size={14} /> Close &amp; wipe</button>
      </div>

      <div className="provider-wrap">
        <aside className="stack">
          <div className="card flat">
            <div className="small muted">Prepared for</div>
            <b>{b.recipient.label}</b>
            <div className="small muted" style={{ marginTop: 6 }}>{b.records.length} record{b.records.length === 1 ? '' : 's'} · shared {new Date(b.createdAt).toLocaleString()}</div>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 11, top: 13, color: 'var(--muted)' }} />
            <input type="search" placeholder="Search records…" aria-label="Search shared records" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 32 }} />
          </div>
          <nav className="card flat side-list" aria-label="Shared records">
            <button aria-current={sel === 'overview'} onClick={() => setSel('overview')}><b>Overview</b></button>
            {records.map((r) => {
              const I = KIND_ICON[r.kind];
              return (
                <button key={r.id} aria-current={sel === r.id} onClick={() => setSel(r.id)}>
                  <I size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} color="var(--accent-2)" />{r.title}
                  <br /><small className="muted">{RECORD_KINDS.find((k) => k.value === r.kind)?.label}{r.date ? ` · ${fmtDate(r.date)}` : ''}</small>
                </button>
              );
            })}
            {records.length === 0 && <p className="small muted" style={{ padding: 8 }}>No matches.</p>}
          </nav>
        </aside>

        <main className="provider-doc card flat" style={{ minWidth: 0 }} aria-live="polite">
          <div className="watermark" style={{ backgroundImage: watermark }} aria-hidden="true" />
          {sel === 'overview' || !cur ? (
            <>
              <h1 style={{ fontSize: '1.5rem' }}>Shared health summary</h1>
              {b.note && <div className="notice info" style={{ marginBottom: 16 }}><MessageSquareText size={18} /><div><b>Note from the patient:</b> {b.note}</div></div>}
              <div className="notice ok" style={{ marginBottom: 16 }}><ShieldCheck size={18} /><div>Personal identifiers were removed <b>on the patient's device</b> before encryption. Placeholders such as <span className="ph">[PERSON_1]</span> mark redactions.</div></div>
              <div className="stack tight">
                {b.records.map((r) => {
                  const I = KIND_ICON[r.kind];
                  return (
                    <button key={r.id} className="rec" style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer', width: '100%' }} onClick={() => setSel(r.id)}>
                      <div className="ico"><I size={20} /></div>
                      <div className="grow">
                        <h3>{r.title}</h3>
                        <div className="meta" style={{ marginTop: 0 }}><span className="pill">{RECORD_KINDS.find((k) => k.value === r.kind)?.label}</span>{r.date && <span>{fmtDate(r.date)}</span>}<span>{r.redaction.total} identifiers removed</span></div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: '1.5rem' }}>{cur.title}</h1>
              <p className="muted">{RECORD_KINDS.find((k) => k.value === cur.kind)?.label}{cur.date ? ` · ${fmtDate(cur.date)}` : ''} · {cur.redaction.total} identifiers removed ({cur.redaction.mode})</p>
              {cur.vitals && <div style={{ marginBottom: 18 }}><VitalsView ds={cur.vitals} readOnly /></div>}
              <div className="doc" style={{ maxHeight: 'none' }} tabIndex={0}><PlaceholderText text={cur.text} /></div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
