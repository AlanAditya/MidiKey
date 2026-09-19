import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Clock, Eye, HardDrive, KeyRound, Pencil, Plus, Search, ShieldCheck, Stethoscope, Trash2, UserRound, Users, X } from 'lucide-react';
import { CopyButton, Logo, fmtDateTime, fmtDuration, useNow } from '../components/common';
import { decodeSecret } from '../lib/share';
import { makeRelay, relayBase, RelayError } from '../lib/relay';
import { createProviderKey, deleteProviderKey, loadProviderKey, providerId, type ProviderKey } from '../lib/providerKey';
import { addLinks, loadPatients, savePatients, type ProviderPatient } from '../lib/providerPatients';

type Live = 'active' | 'expired' | 'revoked' | 'exhausted' | 'unknown' | 'offline' | 'checking';
interface Probe {
  status: string;
  expiresAt?: number;
}

/** Non-counting status check: asking never uses up a patient's view limit. */
async function probe(p: ProviderPatient): Promise<Probe> {
  try {
    const s = decodeSecret(p.secret);
    const r = await makeRelay(relayBase(s.r)).status(p.id);
    return { status: r.status, expiresAt: r.expiresAt };
  } catch (e) {
    return { status: e instanceof RelayError && e.status === 404 ? 'unknown' : 'offline' };
  }
}

function liveState(p: ProviderPatient, pr: Probe | undefined, now: number): Live {
  const expiry = pr?.expiresAt ?? p.expiresAt;
  if (!pr) return expiry && expiry <= now ? 'expired' : 'checking';
  if (pr.status === 'offline') return expiry && expiry <= now ? 'expired' : 'offline';
  if (pr.status === 'active') return expiry && expiry <= now ? 'expired' : 'active';
  return pr.status as Live;
}

const PILL: Record<Live, { cls: string; label: string }> = {
  active: { cls: 'ok', label: 'Active' },
  expired: { cls: '', label: 'Expired' },
  revoked: { cls: 'bad', label: 'Revoked' },
  exhausted: { cls: 'warn', label: 'View limit used' },
  unknown: { cls: 'bad', label: 'Not found' },
  offline: { cls: 'warn', label: 'Relay offline' },
  checking: { cls: '', label: 'Checking…' },
};
const ENDED: Live[] = ['expired', 'revoked', 'exhausted', 'unknown'];

export default function ProviderHome() {
  const nav = useNavigate();
  const [patients, setPatients] = useState<ProviderPatient[]>(loadPatients);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [paste, setPaste] = useState('');
  const [nick, setNick] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [q, setQ] = useState('');
  const [key, setKey] = useState<ProviderKey | null>(loadProviderKey());
  const [keyName, setKeyName] = useState('');
  const now = useNow(30_000); // list ordering/status only; each card runs its own 1 s countdown
  const ref = useRef(patients);
  ref.current = patients;

  const commit = useCallback((next: ProviderPatient[]) => {
    setPatients(next);
    savePatients(next);
  }, []);

  const refresh = useCallback(async () => {
    const list = ref.current;
    if (!list.length) return;
    const results = await Promise.all(list.map(async (p) => [p.id, await probe(p)] as const));
    setProbes((old) => ({ ...old, ...Object.fromEntries(results) }));
    // remember expiry so ended links still show when they ended, even offline
    const changed = ref.current.map((p) => {
      const r = results.find(([id]) => id === p.id)?.[1];
      return r?.expiresAt && r.expiresAt !== p.expiresAt ? { ...p, expiresAt: r.expiresAt } : p;
    });
    if (changed.some((p, i) => p !== ref.current[i])) commit(changed);
  }, [commit]);

  const ids = patients.map((p) => p.id).join(',');
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', refresh);
    };
  }, [ids, refresh]);

  const addFromText = (text: string, nickname?: string) => {
    const r = addLinks(ref.current, text, nickname);
    if (!r.found) return setMsg({ tone: 'bad', text: "That doesn't look like a MediKey access link." });
    commit(r.list);
    const parts: string[] = [];
    if (r.added) parts.push(`Added ${r.added} patient${r.added > 1 ? 's' : ''}`);
    if (r.duplicates) parts.push(`${r.duplicates} already on your dashboard`);
    if (r.invalid) parts.push(`${r.invalid} damaged link${r.invalid > 1 ? 's' : ''} skipped`);
    setMsg({ tone: r.added ? 'ok' : r.invalid ? 'bad' : 'info', text: parts.join(' · ') + '.' });
    if (r.added || r.duplicates) {
      setPaste('');
      setNick('');
    }
  };

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return patients
      .filter((p) => !t || p.nickname.toLowerCase().includes(t))
      .map((p) => ({ p, live: liveState(p, probes[p.id], now), at: probes[p.id]?.expiresAt ?? p.expiresAt }))
      .sort((a, b) => {
        const ea = ENDED.includes(a.live) ? 1 : 0;
        const eb = ENDED.includes(b.live) ? 1 : 0;
        return ea - eb || (a.at ?? Infinity) - (b.at ?? Infinity);
      });
  }, [patients, probes, now, q]);

  const all = patients.map((p) => liveState(p, probes[p.id], now));
  const activeN = all.filter((l) => l === 'active').length;
  const soonN = patients.filter((p, i) => all[i] === 'active' && (probes[p.id]?.expiresAt ?? p.expiresAt ?? Infinity) - now < 24 * 3600e3).length;
  const endedN = all.filter((l) => ENDED.includes(l)).length;

  return (
    <div className="landing" style={{ maxWidth: 1180 }}>
      <header className="topbar">
        <Link to="/" className="brand" style={{ padding: 0 }}><Logo /> <span>MediKey<small>Provider portal</small></span></Link>
        <span className="grow" />
        <Link to="/" className="btn ghost"><ArrowLeft size={16} /> Patient sign-in</Link>
      </header>

      <div className="page-head">
        <div>
          <h1><Stethoscope size={30} style={{ verticalAlign: '-4px' }} /> Your patients</h1>
          <p>Paste the links patients send you. Each one becomes a card you can reopen while access lasts.</p>
        </div>
      </div>

      <div className="dash">
        <div className="stack" style={{ minWidth: 0 }}>
          <section className="card glow stack" aria-labelledby="add-h">
            <h2 id="add-h" style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}><Plus size={19} /> Add patient link</h2>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text');
                if (/p\/[A-Za-z0-9_-]{16,32}\/[A-Za-z0-9_-]{8,}/.test(text) && !nick.trim()) {
                  e.preventDefault(); // paste-and-go: a pasted link is added immediately
                  addFromText(text);
                }
              }}
              placeholder="Paste one or more patient links here — they're added the moment you paste."
              aria-label="Patient links"
              spellCheck={false}
              style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', minHeight: 84 }}
            />
            <div className="row">
              <input type="text" value={nick} onChange={(e) => setNick(e.target.value)} placeholder="Nickname (optional, only you see it)" aria-label="Nickname" maxLength={60} style={{ flex: '1 1 220px' }} />
              <button className="btn primary" disabled={!paste.trim()} onClick={() => addFromText(paste, nick)}><Plus size={16} /> Add to dashboard</button>
            </div>
            {msg && <div className={`notice ${msg.tone}`} role="status">{msg.text}</div>}
          </section>

          <div className="stats" style={{ marginBottom: 0 }}>
            <div className="card stat"><b>{patients.length}</b><span>Patients</span></div>
            <div className="card stat"><b style={{ color: 'var(--ok)' }}>{activeN}</b><span>Access active</span></div>
            <div className="card stat"><b style={{ color: soonN ? 'var(--warn)' : undefined }}>{soonN}</b><span>Ending within 24 h</span></div>
            <div className="card stat"><b>{endedN}</b><span>Ended</span></div>
          </div>

          {patients.length > 5 && (
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 14, top: 15, color: 'var(--muted)' }} />
              <input type="search" placeholder="Search patients…" aria-label="Search patients" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 38 }} />
            </div>
          )}

          {patients.length === 0 ? (
            <div className="card flat center" style={{ padding: 34 }}>
              <div className="big-ico"><Users size={30} /></div>
              <h3>No patients yet</h3>
              <p className="muted small" style={{ maxWidth: 420, margin: '0 auto' }}>When a patient shares records with you, paste their link above. You'll see who's active, when access ends, and can reopen their records in one click.</p>
            </div>
          ) : (
            <div className="stack tight" aria-label="Patients">
              {rows.map(({ p, live, at }) => (
                <PatientCard
                  key={p.id}
                  p={p}
                  live={live}
                  expiresAt={at}
                  needsKey={p.mode === 'bound' && !key}
                  onOpen={() => nav(`/p/${p.id}/${p.secret}`)}
                  onRename={(nickname) => commit(ref.current.map((x) => (x.id === p.id ? { ...x, nickname } : x)))}
                  onRemove={() => commit(ref.current.filter((x) => x.id !== p.id))}
                />
              ))}
              {rows.length === 0 && <p className="muted center">No patients match.</p>}
            </div>
          )}

          {patients.length > 0 && (
            <div className="row">
              <button className="btn ghost sm" onClick={() => { if (confirm('Remove ALL patients from this dashboard? Patients keep their links; you can paste them again while they are active.')) commit([]); }}><Trash2 size={14} /> Clear dashboard</button>
            </div>
          )}
        </div>

        <aside className="stack" style={{ minWidth: 0 }}>
          <section className="card flat stack" aria-labelledby="key-h">
            <h2 id="key-h" style={{ margin: 0, fontSize: '1.1rem' }}><KeyRound size={18} style={{ verticalAlign: '-3px' }} /> Your clinician key</h2>
            <p className="small muted" style={{ margin: 0 }}>Patients can bind a link to this key so it opens <b>only</b> for you, even if the URL leaks. The private half never leaves this browser.</p>
            {key ? (
              <>
                <div className="notice ok"><ShieldCheck size={18} /><div>Key ready{key.name ? <> for <b>{key.name}</b></> : ''}. Send this ID to the patient:</div></div>
                <div className="cipher" style={{ color: 'var(--accent)' }}>{providerId(key.pub)}</div>
                <div className="row">
                  <CopyButton text={providerId(key.pub)} label="Copy clinician ID" className="btn primary sm" />
                  <button className="btn danger sm right" onClick={() => { if (confirm('Delete this clinician key? Links bound to it can no longer be opened.')) { deleteProviderKey(); setKey(null); } }}><Trash2 size={14} /> Delete</button>
                </div>
              </>
            ) : (
              <>
                <input type="text" value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Display name (optional), e.g. Dr. Chen" aria-label="Clinician display name" />
                <button className="btn" onClick={() => setKey(createProviderKey(keyName))}><KeyRound size={16} /> Generate clinician key</button>
              </>
            )}
          </section>

          <section className="card flat stack">
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}><ShieldCheck size={18} style={{ verticalAlign: '-3px' }} /> What's stored here</h2>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Only the links, your nicknames, and non-medical details (expiry, record count).</li>
              <li><b>Patient records are never saved.</b> They're decrypted in memory when you open a link and wiped when you close it or access ends.</li>
              <li>Everything stays in this browser. Anyone using this browser profile could open a saved link, so clear the dashboard on shared computers.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Ends({ at }: { at: number }) {
  const left = at - useNow(1000);
  return <b className="timer" style={{ color: left < 3600e3 ? 'var(--warn)' : 'var(--text)' }}>{fmtDuration(left)}</b>;
}

function PatientCard({ p, live, expiresAt, needsKey, onOpen, onRename, onRemove }: {
  p: ProviderPatient;
  live: Live;
  expiresAt?: number;
  needsKey: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.nickname);
  const ended = ENDED.includes(live);
  const finish = (save: boolean) => {
    const n = name.trim();
    if (save && n) onRename(n);
    else setName(p.nickname);
    setEditing(false);
  };
  return (
    <div className={`card flat patient ${ended ? 'dead' : ''}`}>
      <div className="ico"><UserRound size={22} /></div>
      <div className="who">
        <div className="row" style={{ gap: 8 }}>
          {editing ? (
            <>
              <input type="text" value={name} autoFocus maxLength={60} aria-label="Patient nickname" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); }} style={{ minHeight: 36, padding: '4px 12px', maxWidth: 240 }} />
              <button className="btn sm icon-btn" aria-label="Save name" onClick={() => finish(true)}><Check size={15} /></button>
              <button className="btn ghost sm icon-btn" aria-label="Cancel rename" onClick={() => finish(false)}><X size={15} /></button>
            </>
          ) : (
            <>
              <h3 style={{ margin: 0 }}>{p.nickname}</h3>
              <button className="btn ghost sm icon-btn" aria-label={`Rename ${p.nickname}`} onClick={() => setEditing(true)}><Pencil size={14} /></button>
            </>
          )}
          <span className={`pill ${PILL[live].cls}`}>{PILL[live].label}</span>
          {p.mode === 'passcode' && <span className="pill info"><KeyRound size={12} /> Passcode</span>}
          {p.mode === 'bound' && <span className={`pill ${needsKey ? 'warn' : 'info'}`}><ShieldCheck size={12} /> {needsKey ? 'Needs your clinician key' : 'Bound to your key'}</span>}
          {p.backend === 'ipfs' && <span className="pill info"><HardDrive size={12} /> IPFS</span>}
        </div>
        <div className="meta">
          <span><Clock size={14} /> {live === 'active' && expiresAt ? <>Access ends in <Ends at={expiresAt} /></> : ended && expiresAt ? <>Access ended {fmtDateTime(expiresAt)}</> : 'Expiry unknown until first check'}</span>
          {p.recordCount != null && <span>{p.recordCount} record{p.recordCount === 1 ? '' : 's'}</span>}
          {p.patientFp && <span title="Fingerprint of the patient's signing key">Patient <span className="mono">{p.patientFp}</span></span>}
          <span><Eye size={14} /> {p.lastOpenedAt ? `Last opened ${fmtDateTime(p.lastOpenedAt)}` : 'Not opened yet'}</span>
        </div>
      </div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <button className="btn primary" onClick={onOpen} disabled={ended}>{ended ? 'Unavailable' : 'Open records'}</button>
        <button className="btn ghost sm icon-btn" aria-label={`Remove ${p.nickname} from dashboard`} title="Remove from dashboard" onClick={() => { if (ended || confirm(`Remove “${p.nickname}” from your dashboard? You can paste their link again while access is active.`)) onRemove(); }}><Trash2 size={15} /></button>
      </div>
    </div>
  );
}
