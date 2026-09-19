import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, FileText, FlaskConical, HeartPulse, Pill, ScanLine, Stethoscope, ClipboardList, X } from 'lucide-react';
import { PLACEHOLDER_RE } from '../lib/pii/engine';
import type { RecordKind } from '../lib/types';

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#64d2ff" />
          <stop offset="1" stopColor="#0a84ff" />
        </linearGradient>
      </defs>
      <defs>
        <linearGradient id="lr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.7" /><stop offset="0.45" stopColor="#fff" stopOpacity="0.05" /><stop offset="1" stopColor="#fff" stopOpacity="0.35" /></linearGradient>
        <linearGradient id="lb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.16" /><stop offset="1" stopColor="#fff" stopOpacity="0.04" /></linearGradient>
      </defs>
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="18" fill="url(#lb)" stroke="url(#lr)" strokeWidth="1.5" />
      <path d="M32 11 15 18v12.5c0 10.6 7.2 20 17 22.5 9.8-2.5 17-11.9 17-22.5V18z" fill="url(#lg)" />
      <path d="M32 11 15 18v12.5c0 3 .4 5.8 1.2 8.4C22 36 27 30 32 30s10 6 15.8 8.9c.8-2.6 1.2-5.4 1.2-8.4V18z" fill="#fff" opacity="0.18" />
      <path d="M25.5 32l5 5 9-11" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" style={wide ? { width: 'min(860px, calc(100vw - 24px))' } : undefined} onClose={onClose} onCancel={onClose} aria-label={title}>
      {open && (
        <>
          <div className="modal-head">
            <h2>{title}</h2>
            <button className="btn ghost icon-btn" onClick={onClose} aria-label="Close dialog">
              <X size={18} />
            </button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function CopyButton({ text, label = 'Copy', className = 'btn sm' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const t = document.createElement('textarea');
          t.value = text;
          document.body.appendChild(t);
          t.select();
          document.execCommand('copy');
          t.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? <Check size={15} /> : <Copy size={15} />} {done ? 'Copied' : label}
    </button>
  );
}

export const KIND_ICON: Record<RecordKind, typeof FileText> = {
  lab: FlaskConical,
  'clinical-note': Stethoscope,
  discharge: ClipboardList,
  prescription: Pill,
  imaging: ScanLine,
  vitals: HeartPulse,
  other: FileText,
};

/** Renders text with [PLACEHOLDER] tokens shown as chips. */
export function PlaceholderText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span key={m.index} className="ph" title="Removed by the privacy engine">
        {m[0]}
      </span>,
    );
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(i);
  }, [intervalMs]);
  return now;
}

export function fmtDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

export const fmtDateTime = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDate = (iso?: string) => (iso ? new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');

export function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function passphraseStrength(p: string): { bits: number; label: string; color: string; pct: number } {
  const pool = (/[a-z]/.test(p) ? 26 : 0) + (/[A-Z]/.test(p) ? 26 : 0) + (/\d/.test(p) ? 10 : 0) + (/[^A-Za-z0-9]/.test(p) ? 32 : 0);
  const unique = new Set(p).size;
  const bits = pool ? Math.log2(pool) * Math.min(p.length, unique * 2 + 2) : 0;
  if (bits < 40) return { bits, label: 'Too weak', color: 'var(--danger)', pct: Math.max(8, (bits / 80) * 100) };
  if (bits < 60) return { bits, label: 'Fair', color: 'var(--warn)', pct: (bits / 80) * 100 };
  if (bits < 80) return { bits, label: 'Strong', color: 'var(--ok)', pct: (bits / 80) * 100 };
  return { bits, label: 'Excellent', color: 'var(--ok)', pct: 100 };
}
