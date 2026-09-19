import { beforeEach, describe, expect, it } from 'vitest';
import { encodeSecret } from '../src/lib/share';
import { addLinks, extractLinks, loadPatients, patchPatient, savePatients } from '../src/lib/providerPatients';

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  } as Storage;
});

const link = (id: string, extra: object = {}) => `https://medikey.example/#/p/${id}/${encodeSecret({ v: 1, m: 'bearer', ka: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', ...extra })}`;
const A = 'OXgcLjr1UTxX_DqpTixk_Q';
const B = 'pqrstuvwxyz0123456789A';

describe('provider dashboard', () => {
  it('extracts one or many links from pasted text', () => {
    expect(extractLinks(link(A)).map((l) => l.id)).toEqual([A]);
    const many = `Here you go:\n${link(A)}\nand also\n${link(B)}\n${link(A)}`;
    expect(extractLinks(many).map((l) => l.id)).toEqual([A, B]); // deduped, in order
    expect(extractLinks('no links here, /app/aaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbb')).toEqual([]);
    expect(extractLinks('#/p/OXgcLjr1UTxX_DqpTixk_Q/' + encodeSecret({ v: 1, m: 'bearer', ka: 'x' }))).toHaveLength(1); // bare hash form
  });

  it('adds patients, names them, skips duplicates and damaged links', () => {
    let r = addLinks([], link(A), 'Mr. Sharma');
    expect(r).toMatchObject({ found: 1, added: 1, duplicates: 0, invalid: 0 });
    expect(r.list[0]).toMatchObject({ id: A, nickname: 'Mr. Sharma', mode: 'bearer', backend: 'relay' });

    r = addLinks(r.list, `${link(A)} ${link(B, { m: 'passcode', g: 'http://gw' })}`);
    expect(r).toMatchObject({ added: 1, duplicates: 1 });
    expect(r.list[0]).toMatchObject({ id: B, mode: 'passcode', backend: 'ipfs', nickname: 'Patient 2' });

    const bad = addLinks([], `#/p/${A}/not-a-valid-secret-blob`);
    expect(bad).toMatchObject({ found: 1, added: 0, invalid: 1 });
  });

  it('persists, patches metadata, and never stores anything but link + metadata', () => {
    savePatients(addLinks([], link(A), 'Patient X').list);
    patchPatient(A, { patientFp: 'MK-TEST', recordCount: 8, lastOpenedAt: 123 });
    patchPatient('does-not-exist', { recordCount: 1 }); // no-op
    const [p] = loadPatients();
    expect(p).toMatchObject({ id: A, patientFp: 'MK-TEST', recordCount: 8 });
    expect(Object.keys(p).sort()).toEqual(['addedAt', 'backend', 'id', 'lastOpenedAt', 'mode', 'nickname', 'patientFp', 'recordCount', 'secret']);
  });

  it('survives corrupt storage', () => {
    mem.set('medikey.provider.patients', '{not json');
    expect(loadPatients()).toEqual([]);
  });
});
