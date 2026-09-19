import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { destroyDevice, createKeystore, hasKeystore, unlockKeystore } from '../lib/keystore';
import { decodeRecoveryKey, encodeRecoveryKey, type Identity } from '../lib/identity';
import { randomBytes } from '../lib/bytes';
import * as vault from '../lib/vault';
import { refreshGrants as refreshGrantsRemote, revokeShare } from '../lib/share';
import { DEFAULT_SETTINGS, type GrantRecord, type HealthRecord, type Settings } from '../lib/types';

export type Status = 'loading' | 'none' | 'locked' | 'unlocked';

interface Ctx {
  status: Status;
  identity: Identity | null;
  records: HealthRecord[];
  grants: GrantRecord[];
  settings: Settings;
  createVault(passphrase: string): Promise<{ recoveryKey: string }>;
  completeSetup(): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  restore(recoveryKey: string, newPassphrase: string): Promise<void>;
  lock(): void;
  addRecord(r: HealthRecord): Promise<void>;
  removeRecord(id: string): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  addGrant(g: GrantRecord): Promise<void>;
  refreshGrants(): Promise<void>;
  revokeGrant(id: string): Promise<void>;
  removeGrant(id: string): Promise<void>;
  exportBackup(): Promise<Blob>;
  importBackup(f: File): Promise<number>;
  eraseDevice(): Promise<void>;
}

const VaultCtx = createContext<Ctx | null>(null);
export const useVault = () => {
  const c = useContext(VaultCtx);
  if (!c) throw new Error('VaultProvider missing');
  return c;
};

export function VaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [grants, setGrants] = useState<GrantRecord[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const pending = useRef<Identity | null>(null);
  const lastActive = useRef(Date.now());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    hasKeystore().then((h) => setStatus(h ? 'locked' : 'none'));
  }, []);

  useEffect(() => {
    const theme = status === 'unlocked' ? settings.theme : (localStorage.getItem('medikey.theme') as 'dark' | 'light' | null) ?? settings.theme;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('medikey.theme', theme);
    } catch {
      /* private mode */
    }
  }, [settings.theme, status]);

  const load = useCallback(async (id: Identity) => {
    const [r, g, s] = await Promise.all([vault.listRecords(id), vault.listGrants(id), vault.loadSettings(id)]);
    setRecords(r);
    setGrants(g);
    setSettings(s);
    setIdentity(id);
    lastActive.current = Date.now();
    setStatus('unlocked');
  }, []);

  const lock = useCallback(() => {
    setIdentity(null);
    setRecords([]);
    setGrants([]);
    pending.current = null;
    setStatus('locked');
  }, []);

  // auto-lock on inactivity
  useEffect(() => {
    if (status !== 'unlocked') return;
    const bump = () => (lastActive.current = Date.now());
    const evs = ['pointerdown', 'keydown', 'scroll'] as const;
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const iv = setInterval(() => {
      const mins = settingsRef.current.autoLockMinutes;
      if (mins > 0 && Date.now() - lastActive.current > mins * 60_000) lock();
    }, 10_000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(iv);
    };
  }, [status, lock]);

  const need = () => {
    if (!identity) throw new Error('Vault is locked');
    return identity;
  };

  const value = useMemo<Ctx>(
    () => ({
      status,
      identity,
      records,
      grants,
      settings,
      async createVault(passphrase) {
        const seed = randomBytes(32);
        pending.current = await createKeystore(seed, passphrase);
        return { recoveryKey: encodeRecoveryKey(seed) };
      },
      async completeSetup() {
        if (!pending.current) throw new Error('No vault pending');
        await load(pending.current);
        pending.current = null;
      },
      async unlock(passphrase) {
        await load(await unlockKeystore(passphrase));
      },
      async restore(recoveryKey, newPassphrase) {
        const seed = decodeRecoveryKey(recoveryKey);
        await load(await createKeystore(seed, newPassphrase));
      },
      lock,
      async addRecord(r) {
        await vault.saveRecord(need(), r);
        setRecords(await vault.listRecords(need()));
      },
      async removeRecord(id) {
        await vault.deleteRecord(need(), id);
        setRecords((x) => x.filter((r) => r.id !== id));
      },
      async updateSettings(patch) {
        const next = { ...settings, ...patch, storage: { ...settings.storage, ...patch.storage } };
        setSettings(next);
        await vault.saveSettings(need(), next);
      },
      async addGrant(g) {
        await vault.saveGrant(need(), g);
        setGrants(await vault.listGrants(need()));
      },
      async refreshGrants() {
        const id = need();
        const current = await vault.listGrants(id);
        if (!current.length) return setGrants([]);
        try {
          const next = await refreshGrantsRemote(id, current, settings);
          await Promise.all(next.map((g, i) => (g !== current[i] ? vault.saveGrant(id, g) : null)));
          setGrants(next);
        } catch {
          setGrants(current); // relay offline — keep local view
          throw new Error('Relay unreachable — showing last known status.');
        }
      },
      async revokeGrant(gid) {
        const id = need();
        await revokeShare(id, gid, settings);
        const g = (await vault.listGrants(id)).find((x) => x.id === gid);
        if (g) await vault.saveGrant(id, { ...g, status: 'revoked', log: [...(g.log ?? []), { t: Date.now(), event: 'revoked' }] });
        setGrants(await vault.listGrants(id));
      },
      async removeGrant(gid) {
        await vault.deleteGrant(need(), gid);
        setGrants((x) => x.filter((g) => g.id !== gid));
      },
      exportBackup: () => vault.exportBackup(need()),
      async importBackup(f) {
        const id = need();
        const { records: n } = await vault.importBackup(id, f);
        await load(id);
        return n;
      },
      async eraseDevice() {
        await destroyDevice();
        lock();
        setStatus('none');
        setSettings(DEFAULT_SETTINGS);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, identity, records, grants, settings, load, lock],
  );

  return <VaultCtx.Provider value={value}>{children}</VaultCtx.Provider>;
}
