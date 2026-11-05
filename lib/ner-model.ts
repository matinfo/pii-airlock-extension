/**
 * Opt-in NER model store: download (pinned, SHA-256 verified), query, remove.
 *
 * Files live in the Cache API under the extension origin, so the options page
 * (which downloads) and the offscreen/background host (which reads) share them.
 * Nothing is requested until `downloadModel` is called from a user click.
 * Pure of browser-extension APIs; the cache is injectable for tests.
 */
import { NER_FILES, type NerFile, NER_MODEL_ID, NER_REVISION, nerFileUrl } from './ner-manifest';

export const CACHE_NAME = `pii-airlock-ner-${NER_REVISION.slice(0, 12)}`;
const key = (path: string) => `https://ner.pii-airlock.invalid/${NER_MODEL_ID}/${NER_REVISION}/${path}`;

export interface CacheLike {
  match(k: string): Promise<Response | undefined>;
  put(k: string, r: Response): Promise<void>;
}
export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  delete(name: string): Promise<boolean>;
  keys(): Promise<string[]>;
}

export interface Progress {
  loaded: number;
  total: number;
  file: string;
}

export const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256(data: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

const defaultStorage = (): CacheStorageLike => (globalThis as unknown as { caches: CacheStorageLike }).caches;

/** True when every pinned file is present in the cache. */
export async function isInstalled(
  storage: CacheStorageLike = defaultStorage(),
  files: readonly NerFile[] = NER_FILES,
): Promise<boolean> {
  try {
    if (!(await storage.keys()).includes(CACHE_NAME)) return false;
    const cache = await storage.open(CACHE_NAME);
    for (const f of files) if (!(await cache.match(key(f.path)))) return false;
    return true;
  } catch {
    return false;
  }
}

/** Delete the model and any older revisions' caches. */
export async function removeModel(storage: CacheStorageLike = defaultStorage()): Promise<void> {
  for (const name of await storage.keys()) {
    if (name.startsWith('pii-airlock-ner-')) await storage.delete(name);
  }
}

async function fetchVerified(
  path: string,
  expected: { bytes: number; sha256: string },
  fetchFn: typeof fetch,
  onBytes: (n: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const res = await fetchFn(nerFileUrl(path), { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok || !res.body) throw new Error(`download failed: ${path} (${res.status})`);
  const out = new Uint8Array(expected.bytes);
  let n = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.length > expected.bytes) throw new Error(`size mismatch: ${path}`);
    out.set(value, n);
    n += value.length;
    onBytes(value.length);
  }
  if (n !== expected.bytes) throw new Error(`size mismatch: ${path}`);
  if ((await sha256(out)) !== expected.sha256) throw new Error(`checksum mismatch: ${path}`);
  return out;
}

/**
 * Download + verify every file, then store them. All-or-nothing: files are
 * written only after ALL verify, so a failure leaves nothing half-installed.
 */
export async function downloadModel(
  onProgress: (p: Progress) => void = () => {},
  opts: { signal?: AbortSignal; fetch?: typeof fetch; storage?: CacheStorageLike; files?: readonly NerFile[] } = {},
): Promise<void> {
  const fetchFn = opts.fetch ?? fetch;
  const storage = opts.storage ?? defaultStorage();
  const files = opts.files ?? NER_FILES;
  const total = files.reduce((n, f) => n + f.bytes, 0);
  let loaded = 0;
  const verified: Array<[string, Uint8Array]> = [];
  for (const f of files) {
    const data = await fetchVerified(f.path, f, fetchFn, (n) => {
      loaded += n;
      onProgress({ loaded, total, file: f.path });
    }, opts.signal);
    verified.push([f.path, data]);
  }
  await removeModel(storage);
  const cache = await storage.open(CACHE_NAME);
  for (const [path, data] of verified) {
    await cache.put(key(path), new Response(data as BufferSource, {
      headers: { 'content-length': String(data.length), 'content-type': 'application/octet-stream' },
    }));
  }
}

/**
 * transformers.js `env.customCache`: serves ONLY from the verified store.
 * `put` is a no-op: transformers must never write unverified bytes.
 */
export function makeModelCache(storage: CacheStorageLike = defaultStorage()) {
  return {
    async match(k: string): Promise<Response | undefined> {
      const file = NER_FILES.find((f) => k.endsWith('/' + f.path));
      if (!file) return undefined;
      const cache = await storage.open(CACHE_NAME);
      return cache.match(key(file.path));
    },
    async put(): Promise<void> {},
  };
}
