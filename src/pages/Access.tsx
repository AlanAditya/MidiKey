import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { AlertTriangle, Ban, CheckCircle2, Clock, Eye, HardDrive, KeyRound, Link2, Loader2, Plus, QrCode, RefreshCw, ShieldCheck, Stethoscope, Trash2, UserRound, FlaskConical, Server, ChevronDown, ChevronUp } from 'lucide-react';
import { useVault } from '../state/VaultContext';
import { useToast } from '../state/Toast';
import { CopyButton, KIND_ICON, Modal, fmtDate, fmtDateTime, fmtDuration, useNow } from '../components/common';
import { createShare } from '../lib/share';
import { fromB64Url, formatBytes } from '../lib/bytes';
import { makeRelay, relayBase } from '../lib/relay';
import type { GrantRecord } from '../lib/types';

const TTL = [
  { label: '1 hour', ms: 3600e3 },
  { label: '24 hours', ms: 24 * 3600e3 },
  { label: '48 hours', ms: 48 * 3600e3 },
  { label: '7 days', ms: 7 * 86400e3 },
  { label: '30 days', ms: 30 * 86400e3 },
];

export default function Access() {
  const v = useVault();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [relayOk, setRelayOk] = useState<null | { activeGrants: number }>(null);
  const [relayErr, setRelayErr] = useState('');
  const now = useNow(15_000); // only used to move cards between Active/History — cards tick their own countdown

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await v.refreshGrants();
      setRelayErr('');
    } catch (e) {
      setRelayErr((e as Error).message);
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.identity, v.settings.storage.relayUrl]);

  useEffect(() => {
    makeRelay(relayBase(v.settings.storage.relayUrl)).health().then(setRelayOk).catch(() => setRelayOk(null));
    refresh();
    const i = setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(i);
      window.removeEventListener('focus', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (params.get('record')) setOpen(true);
  }, [params]);

  const live = v.grants.filter((g) => g.status === 'active' && g.expiresAt > now);
  const past = v.grants.filter((g) => !live.includes(g));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Access Dashboard</h1>
          <p>Time-bound, revocable links for doctors and researchers. The relay can never read what you share.</p>
        </div>
        <div className="row right">
          <span className={`pill ${relayOk ? 'ok' : 'bad'}`} title="MediKey blind relay status"><Server size={13} /> {relayOk ? 'Relay online' : 'Relay offline'}</span>
          <button className="btn" onClick={refresh} disabled={refreshing} aria-label="Refresh status"><RefreshCw size={16} className={refreshing ? 'spin' : ''} /> Refresh</button>
          <button className="btn primary" onClick={() => setOpen(true)} disabled={!v.records.length}><Plus size={17} /> New share link</button>
        </div>
      </div>

      {relayErr && <div className="notice warn" style={{ marginBottom: 16 }}><AlertTriangle size={18} /><div>{relayErr} Start it with <code>npm run relay</code> (or <code>npm run dev</code>).</div></div>}
      {!v.records.length && <div className="notice info" style={{ marginBottom: 16 }}><AlertTriangle size={18} /><div>Add at least one record to your vault before creating a share link.</div></div>}

      <h2>Active <span className="muted" style={{ fontWeight: 500 }}>({live.length})</span></h2>
      <div className="stack">
        {live.length === 0 && <div className="card flat muted center">No active links. Create one to give a clinician time-limited access.</div>}
        {live.map((g) => <GrantCard key={g.id} g={g} />)}
      </div>

      {past.length > 0 && (
        <>
          <h2 style={{ marginTop: 28 }}>History <span className="muted" style={{ fontWeight: 500 }}>({past.length})</span></h2>
          <div className="stack">{past.map((g) => <GrantCard key={g.id} g={g} />)}</div>
        </>
      )}

      <CreateModal
        open={open}
        onClose={() => { setOpen(false); if (params.get('record')) setParams({}); }}
        preselect={params.get('record') ?? undefined}
        onCreated={() => refresh()}
      />
    </>
  );
}

function statusOf(g: GrantRecord, now: number): { label: string; cls: string; icon: typeof CheckCircle2 } {
  if (g.status === 'revoked') return { label: 'Revoked', cls: 'bad', icon: Ban };
  if (g.status === 'expired' || g.expiresAt <= now) return { label: 'Expired', cls: '', icon: Clock };
  return { label: 'Active', cls: 'ok', icon: CheckCircle2 };
}

function GrantCard({ g }: { g: GrantRecord }) {
  const now = useNow(1000);
  const v = useVault();
  const toast = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const [log, setLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = statusOf(g, now);
  const live = st.label === 'Active';
  const left = g.expiresAt - now;
  const RI = g.recipientType === 'doctor' ? Stethoscope : g.recipientType === 'researcher' ? FlaskConical : UserRound;
  const pct = Math.max(0, Math.min(100, (left / (g.expiresAt - g.createdAt)) * 100));

  return (
    <div className={`card flat grant ${live ? '' : 'dead'}`}>
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 10 }}>
          <RI size={18} color="var(--accent)" />
          <h3 style={{ margin: 0 }}>{g.label}</h3>
          <span className={`pill ${st.cls}`}><st.icon size={12} /> {st.label}</span>
          {g.passcode && <span className="pill info"><KeyRound size={12} /> Passcode</span>}
          {g.boundToProvider && <span className="pill info"><ShieldCheck size={12} /> Clinician-key bound</span>}
          {g.backend === 'ipfs' && <span className="pill info"><HardDrive size={12} /> IPFS</span>}
        </div>
        <div className="meta">
          <span><Clock size={14} /> {live ? <>Self-destructs in <b className="timer" style={{ color: left < 3600e3 ? 'var(--warn)' : 'var(--text)' }}>{fmtDuration(left)}</b></> : <>Ended {fmtDateTime(g.status === 'revoked' ? (g.log?.find((e) => e.event === 'revoked' || e.event === 'missing-on-relay')?.t ?? g.expiresAt) : g.expiresAt)}</>}</span>
          <span><Eye size={14} /> {g.views} open{g.views === 1 ? '' : 's'}{g.maxViews ? ` of ${g.maxViews}` : ''}{g.lastViewedAt ? ` · last ${fmtDateTime(g.lastViewedAt)}` : ''}</span>
          <span>{g.recordIds.length} record{g.recordIds.length === 1 ? '' : 's'} · {g.shardCount} encrypted shard{g.shardCount === 1 ? '' : 's'} ({formatBytes(g.bytes)})</span>
          <span>Created {fmtDateTime(g.createdAt)}</span>
        </div>
        {live && <div className="progress" style={{ marginTop: 10, maxWidth: 380 }} aria-hidden="true"><i style={{ width: `${pct}%`, background: left < 3600e3 ? 'var(--warn)' : undefined }} /></div>}

        {live && (
          <div className="linkbox" style={{ marginTop: 12 }}>
            <input type="text" readOnly value={g.link} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={g.link} label="Copy link" />
            <button className="btn sm" onClick={async () => setQr(qr ? null : await QRCode.toDataURL(g.link, { margin: 1, width: 352, errorCorrectionLevel: 'L' }))}><QrCode size={15} /> QR</button>
          </div>
        )}
        {qr && <div className="qr" style={{ marginTop: 10 }}><img src={qr} alt={`QR code for the link shared with ${g.label}`} /></div>}

        <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setLog(!log)} aria-expanded={log}>
          {log ? <ChevronUp size={15} /> : <ChevronDown size={15} />} Access log
        </button>
        {log && (
          <ul className="timeline" aria-label="Access log">
            {[...(g.log ?? [])].reverse().map((e, i) => (
              <li key={i}><time>{new Date(e.t).toLocaleString()}</time><span>{e.event === 'opened' ? '👁 Provider opened the records' : e.event === 'created' ? '🔐 Link created' : e.event === 'revoked' ? '⛔ You revoked access — key destroyed' : e.event === 'missing-on-relay' ? '⚠ The relay no longer has this link, so it can\'t be opened' : e.event === 'expired' ? '⏱ Link self-destructed (key destroyed)' : e.event === 'exhausted' ? '🔥 View limit reached — key destroyed' : e.event}</span></li>
            ))}
          </ul>
        )}
      </div>
      <div className="row" style={{ alignSelf: 'flex-start' }}>
        {live ? (
          <button className="btn danger" disabled={busy} onClick={async () => {
            if (!confirm(`Revoke access for “${g.label}”? The relay will destroy its key half and the link stops working immediately.`)) return;
            setBusy(true);
            try {
              const r = await v.revokeGrant(g.id);
              toast(r.alreadyGone ? 'The relay no longer had this link, so it was already unopenable. Marked as revoked.' : 'Access revoked. The key half was destroyed on the relay.');
            } catch (e) {
              toast((e as Error).message, 'bad');
            } finally {
              setBusy(false);
            }
          }}>{busy ? <Loader2 size={16} className="spin" /> : <Ban size={16} />} Revoke</button>
        ) : (
          <button className="btn ghost sm" onClick={() => v.removeGrant(g.id)}><Trash2 size={15} /> Remove</button>
        )}
      </div>
    </div>
  );
}

function CreateModal({ open, onClose, preselect, onCreated }: { open: boolean; onClose: () => void; preselect?: string; onCreated: () => void }) {
  const v = useVault();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [type, setType] = useState<GrantRecord['recipientType']>('doctor');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ttl, setTtl] = useState(TTL[1].ms);
  const [maxViews, setMaxViews] = useState<number | null>(null);
  const [mode, setMode] = useState<'bearer' | 'passcode' | 'bound'>('bearer');
  const [passcode, setPasscode] = useState('');
  const [providerId, setProviderId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState<GrantRecord | null>(null);
  const [qr, setQr] = useState('');

  useEffect(() => {
    if (open) {
      setDone(null);
      setErr('');
      setSel(new Set(preselect ? [preselect] : []));
    }
  }, [open, preselect]);

  const providerPub = useMemo(() => {
    const m = providerId.trim().match(/^MKP-([A-Za-z0-9_-]{43})$/);
    if (!m) return null;
    try {
      const b = fromB64Url(m[1]);
      return b.length === 32 ? b : null;
    } catch {
      return null;
    }
  }, [providerId]);

  const genPass = () => {
    const words = ['amber', 'birch', 'cedar', 'delta', 'ember', 'fjord', 'grove', 'harbor', 'iris', 'jade', 'kelp', 'lumen', 'maple', 'nova', 'onyx', 'pearl', 'quartz', 'river', 'sable', 'tundra', 'umber', 'violet', 'willow', 'zephyr'];
    const r = crypto.getRandomValues(new Uint32Array(3));
    setPasscode([...r].map((x) => words[x % words.length]).join('-'));
  };

  const valid = label.trim() && sel.size > 0 && (mode !== 'passcode' || passcode.length >= 6) && (mode !== 'bound' || providerPub);

  const submit = async () => {
    if (!v.identity) return;
    setBusy(true);
    setErr('');
    try {
      const g = await createShare(
        v.identity,
        v.records.filter((r) => sel.has(r.id)),
        { label: label.trim(), recipientType: type, ttlMs: ttl, maxViews, passcode: mode === 'passcode' ? passcode : undefined, providerPub: mode === 'bound' ? providerPub! : undefined, note },
        v.settings,
        setProgress,
      );
      await v.addGrant(g);
      setQr(await QRCode.toDataURL(g.link, { margin: 1, width: 352, errorCorrectionLevel: 'L' }));
      setDone(g);
      onCreated();
      toast('Encrypted share link created.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setLabel(''); setNote(''); setPasscode(''); setProviderId(''); setMode('bearer'); setMaxViews(null); setSel(new Set()); setDone(null);
  };

  return (
    <Modal
      open={open}
      onClose={() => { onClose(); if (done) reset(); }}
      title={done ? 'Link ready' : 'New secure share link'}
      wide
      footer={
        done ? (
          <button className="btn primary" onClick={() => { onClose(); reset(); }}>Done</button>
        ) : (
          <>
            <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn primary" onClick={submit} disabled={!valid || busy}>{busy ? <><Loader2 size={16} className="spin" /> {progress || 'Working…'}</> : <><Link2 size={16} /> Encrypt &amp; create link</>}</button>
          </>
        )
      }
    >
      {done ? (
        <div className="stack">
          <div className="notice ok"><CheckCircle2 size={18} /><div>Encrypted in your browser and uploaded as <b>{done.shardCount}</b> shard{done.shardCount > 1 ? 's' : ''} to {done.backend === 'ipfs' ? 'IPFS' : 'the relay'}. The decryption secret exists <b>only in this link</b>.</div></div>
          <div className="linkbox"><input type="text" readOnly value={done.link} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} /><CopyButton text={done.link} label="Copy link" className="btn primary" /></div>
          <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
            <div className="qr"><img src={qr} alt="QR code of the share link" /></div>
            <ul className="small" style={{ margin: 0, paddingLeft: 18, flex: '1 1 260px' }}>
              <li>Expires <b>{fmtDateTime(done.expiresAt)}</b>{done.maxViews ? <> or after <b>{done.maxViews}</b> open{done.maxViews > 1 ? 's' : ''}</> : null}.</li>
              {done.passcode && <li>Send the passcode <b>through a different channel</b> (phone call, SMS) — never with the link.</li>}
              {done.boundToProvider && <li>Only the clinician holding the matching key can open it — a leaked URL is useless.</li>}
              <li>You can revoke it any time from this dashboard.</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="stack">
          {err && <div className="notice bad" role="alert"><AlertTriangle size={18} /><div>{err}</div></div>}
          <div className="grid cols-2">
            <label className="field" style={{ margin: 0 }}>
              <span className="lbl">Who is this for?</span>
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Dr. Chen — cardiology referral" maxLength={80} />
              <div className="hint">Only you see this label.</div>
            </label>
            <label className="field" style={{ margin: 0 }}>
              <span className="lbl">Recipient type</span>
              <select value={type} onChange={(e) => setType(e.target.value as GrantRecord['recipientType'])}>
                <option value="doctor">Doctor / clinic</option>
                <option value="researcher">Researcher</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="lbl" style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-2)', marginBottom: 6 }}>Records to share (sanitized text only)</legend>
            <div className="row" style={{ marginBottom: 6 }}>
              <button type="button" className="btn ghost sm" onClick={() => setSel(new Set(v.records.map((r) => r.id)))}>Select all</button>
              <button type="button" className="btn ghost sm" onClick={() => setSel(new Set())}>None</button>
            </div>
            <div className="stack tight" style={{ maxHeight: 200, overflow: 'auto' }}>
              {v.records.map((r) => {
                const I = KIND_ICON[r.kind];
                return (
                  <label key={r.id} className="check card flat" style={{ padding: '8px 12px', alignItems: 'center' }}>
                    <input type="checkbox" checked={sel.has(r.id)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(r.id) : n.delete(r.id); return n; })} />
                    <I size={16} color="var(--accent-2)" /> <span className="grow">{r.title}</span><small className="muted">{fmtDate(r.date)}</small>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="grid cols-2">
            <label className="field" style={{ margin: 0 }}>
              <span className="lbl">Self-destructs after</span>
              <select value={ttl} onChange={(e) => setTtl(+e.target.value)}>{TTL.map((t) => <option key={t.ms} value={t.ms}>{t.label}</option>)}</select>
            </label>
            <label className="field" style={{ margin: 0 }}>
              <span className="lbl">View limit</span>
              <select value={maxViews ?? 0} onChange={(e) => setMaxViews(+e.target.value || null)}>
                <option value={0}>Unlimited (until expiry)</option>
                <option value={1}>1 open (burn after reading)</option>
                <option value={3}>3 opens</option>
                <option value={10}>10 opens</option>
              </select>
            </label>
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="lbl" style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-2)', marginBottom: 6 }}>Who can open the link?</legend>
            <div className="stack tight">
              {([
                ['bearer', 'Anyone with the link', 'Simplest. Treat the link like a key.'],
                ['passcode', 'Link + passcode', 'A second secret, stretched with Argon2id, shared out-of-band.'],
                ['bound', 'Only a verified clinician key', 'Bound to the clinician\'s own key from the Provider Portal — the URL alone is useless.'],
              ] as const).map(([val, title, desc]) => (
                <label key={val} className="check card flat" style={{ padding: '10px 12px' }}>
                  <input type="radio" name="mode" checked={mode === val} onChange={() => setMode(val)} />
                  <span><b>{title}</b><br /><small className="muted">{desc}</small></span>
                </label>
              ))}
            </div>
            {mode === 'passcode' && (
              <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
                <label className="field grow" style={{ margin: 0 }}><span className="lbl">Passcode (6+ characters)</span><input type="text" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoComplete="off" /></label>
                <button type="button" className="btn" onClick={genPass}>Generate</button>
              </div>
            )}
            {mode === 'bound' && (
              <label className="field" style={{ marginTop: 10, marginBottom: 0 }}>
                <span className="lbl">Clinician key (from the provider's portal)</span>
                <input type="text" value={providerId} onChange={(e) => setProviderId(e.target.value)} placeholder="MKP-…" spellCheck={false} style={{ fontFamily: 'var(--mono)' }} />
                <div className="hint" style={{ color: providerId && !providerPub ? 'var(--danger)' : undefined }}>{providerId && !providerPub ? 'Not a valid clinician key.' : providerPub ? '✓ Valid key. Only its holder can decrypt.' : 'The provider generates this at /#/provider and sends it to you.'}</div>
              </label>
            )}
          </fieldset>

          <label className="field" style={{ margin: 0 }}>
            <span className="lbl">Note for the provider (optional, encrypted)</span>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Chest tightness on exertion for 3 weeks" maxLength={200} />
          </label>
          <p className="hint" style={{ margin: 0 }}>Storage: {v.settings.storage.backend === 'ipfs' ? 'IPFS (content-addressed shards)' : 'MediKey blind relay'}. Change in Settings.</p>
        </div>
      )}
    </Modal>
  );
}
