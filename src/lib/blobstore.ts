/**
 * Where encrypted shards live. Interchangeable back-ends:
 *   relay — the MediKey blind relay's content-addressed blob store (default)
 *   ipfs  — a Kubo/IPFS node's HTTP API (pin) + any IPFS gateway (fetch)
 * Because shards are AES-GCM ciphertext and the key-half is kept off-chain, publishing them to a
 * public network is safe; revocation deletes the key-half and the data becomes unrecoverable.
 */
import { toHex } from './bytes';
import { sha256 } from './crypto';
import { RelayError, type Relay, type ShardRef } from './relay';
import type { Settings } from './types';

export interface BlobStore {
  name: 'relay' | 'ipfs';
  put(bytes: Uint8Array): Promise<ShardRef>;
}

export function makeBlobStore(settings: Settings['storage'], relay: Relay): BlobStore {
  if (settings.backend === 'ipfs') {
    const api = settings.ipfsApi.replace(/\/+$/, '');
    return {
      name: 'ipfs',
      async put(bytes) {
        const h = toHex(sha256(bytes));
        const form = new FormData();
        form.append('file', new Blob([bytes as BlobPart]), 'shard.bin');
        let res: Response;
        try {
          res = await fetch(`${api}/api/v0/add?pin=true&cid-version=1&raw-leaves=true`, { method: 'POST', body: form });
        } catch {
          throw new RelayError(`Cannot reach the IPFS node at ${api}. Start \`ipfs daemon\` (or \`npm run mock-ipfs\`) and allow CORS.`, 0, 'ipfs');
        }
        if (!res.ok) throw new RelayError(`IPFS add failed (${res.status})`, res.status, 'ipfs');
        const { Hash } = (await res.json()) as { Hash: string };
        return { h, n: bytes.length, c: Hash };
      },
    };
  }
  return {
    name: 'relay',
    async put(bytes) {
      const h = toHex(sha256(bytes));
      await relay.putBlob(h, bytes);
      return { h, n: bytes.length };
    },
  };
}

/** Fetch one shard and verify its SHA-256 against the signed manifest. */
export async function fetchShard(ref: ShardRef, relay: Relay, gateway?: string): Promise<Uint8Array> {
  let bytes: Uint8Array;
  if (ref.c) {
    if (!gateway) throw new RelayError('This share is stored on IPFS but no gateway was provided.', 0, 'ipfs');
    let res: Response;
    try {
      res = await fetch(`${gateway.replace(/\/+$/, '')}/ipfs/${ref.c}`);
    } catch {
      throw new RelayError('Cannot reach the IPFS gateway.', 0, 'ipfs');
    }
    if (!res.ok) throw new RelayError('Shard not found on the IPFS gateway.', res.status, 'missing-shard');
    bytes = new Uint8Array(await res.arrayBuffer());
  } else {
    bytes = await relay.getBlob(ref.h);
  }
  if (toHex(sha256(bytes)) !== ref.h) throw new Error('Shard integrity check failed — data was tampered with.');
  return bytes;
}
