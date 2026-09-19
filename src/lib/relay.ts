/** Thin client for the blind relay. Every owner-authenticated call is signed with the patient's Ed25519 key. */
import { toB64Url, utf8 } from './bytes';
import { sign, type Identity } from './identity';
import type { GrantStatus } from './types';

export interface ShardRef {
  /** sha256 hex of the shard ciphertext */
  h: string;
  n: number;
  /** IPFS CID when stored on IPFS */
  c?: string;
}

export interface GrantBody {
  v: 1;
  id: string;
  ownerPub: string;
  keyShare: string | null;
  createdAt: number;
  expiresAt: number;
  maxViews: number | null;
  shards: ShardRef[];
  mode: 'bearer' | 'passcode' | 'bound';
}

export class RelayError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export interface InspectResult {
  status: GrantStatus | 'exhausted' | 'unknown';
  views: number;
  log: { t: number; event: string }[];
  expiresAt: number;
}

export function relayBase(configured?: string): string {
  return (configured || (import.meta.env.VITE_RELAY_URL as string | undefined) || '').replace(/\/+$/, '');
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new RelayError('Cannot reach the MediKey relay. Is the relay server running?', 0, 'network');
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
  if (!res.ok) throw new RelayError(body.error ?? `Relay error ${res.status}`, res.status, body.status);
  return body as T;
}

export const makeRelay = (base: string) => ({
  base,
  health: () => request<{ ok: boolean; activeGrants: number }>(`${base}/api/health`),

  putBlob: (hash: string, bytes: Uint8Array) =>
    request(`${base}/api/blobs/${hash}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes as BodyInit }),

  async getBlob(hash: string): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await fetch(`${base}/api/blobs/${hash}`);
    } catch {
      throw new RelayError('Cannot reach the MediKey relay.', 0, 'network');
    }
    if (!res.ok) throw new RelayError('An encrypted shard is missing — the share may have been revoked.', res.status, 'missing-shard');
    return new Uint8Array(await res.arrayBuffer());
  },

  createGrant: (grant: GrantBody, sig: string) =>
    request(`${base}/api/grants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant, sig }) }),

  open: (id: string) =>
    request<{ status: 'active'; grant: GrantBody; sig: string; views: number; viewsLeft: number | null; serverTime: number }>(
      `${base}/api/grants/${id}/open`,
      { method: 'POST' },
    ),

  status: (id: string) => request<{ status: string; expiresAt?: number }>(`${base}/api/grants/${id}/status`),

  async inspect(identity: Identity, ids: string[]): Promise<Record<string, InspectResult>> {
    const ts = Date.now();
    const sig = toB64Url(sign(identity, utf8(`inspect:${ts}:${ids.join(',')}`)));
    const r = await request<{ grants: Record<string, InspectResult> }>(`${base}/api/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerPub: toB64Url(identity.signPub), ts, ids, sig }),
    });
    return r.grants;
  },

  async revoke(identity: Identity, id: string) {
    const ts = Date.now();
    const sig = toB64Url(sign(identity, utf8(`revoke:${id}:${ts}`)));
    return request<{ ok: boolean; status: string }>(`${base}/api/grants/${id}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts, sig }),
    });
  },
});

export type Relay = ReturnType<typeof makeRelay>;
