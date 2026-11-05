import { describe, it, expect } from 'bun:test';
import { downloadModel, isInstalled, removeModel, makeModelCache, sha256, CACHE_NAME, type CacheStorageLike, type CacheLike } from '../lib/ner-model';
import type { NerFile } from '../lib/ner-manifest';

function fakeStorage(): CacheStorageLike & { names(): string[] } {
  const stores = new Map<string, Map<string, Response>>();
  return {
    names: () => [...stores.keys()],
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); },
    async open(n): Promise<CacheLike> {
      if (!stores.has(n)) stores.set(n, new Map());
      const m = stores.get(n)!;
      return {
        async match(k) { return m.get(k)?.clone(); },
        async put(k, r) { m.set(k, r); },
      };
    },
  };
}

const enc = (s: string) => new TextEncoder().encode(s);
async function files(contents: Record<string, string>): Promise<NerFile[]> {
  return Promise.all(Object.entries(contents).map(async ([path, c]) => ({
    path, bytes: enc(c).length, sha256: await sha256(enc(c)),
  })));
}
const serve = (contents: Record<string, string>, tamper?: string): typeof fetch =>
  (async (url: string) => {
    const path = Object.keys(contents).find((p) => url.endsWith('/' + p))!;
    const body = path === tamper ? 'X'.repeat(contents[path]!.length) : contents[path]!;
    return new Response(enc(body));
  }) as unknown as typeof fetch;

describe('ner-model store', () => {
  const C = { 'config.json': '{"a":1}', 'onnx/model_quantized.onnx': 'weights-weights' };

  it('downloads, verifies, stores, reports progress; then isInstalled', async () => {
    const storage = fakeStorage();
    const f = await files(C);
    const seen: number[] = [];
    expect(await isInstalled(storage, f)).toBe(false);
    await downloadModel((p) => seen.push(p.loaded), { fetch: serve(C), storage, files: f });
    expect(seen.at(-1)).toBe(f.reduce((n, x) => n + x.bytes, 0));
    expect(await isInstalled(storage, f)).toBe(true);
  });

  it('checksum mismatch: throws and stores NOTHING', async () => {
    const storage = fakeStorage();
    const f = await files(C);
    await expect(
      downloadModel(() => {}, { fetch: serve(C, 'onnx/model_quantized.onnx'), storage, files: f }),
    ).rejects.toThrow(/checksum mismatch/);
    expect(storage.names()).toEqual([]);
    expect(await isInstalled(storage, f)).toBe(false);
  });

  it('truncated download is rejected', async () => {
    const storage = fakeStorage();
    const f = await files(C);
    const short = (async () => new Response(enc('x'))) as unknown as typeof fetch;
    await expect(downloadModel(() => {}, { fetch: short, storage, files: f })).rejects.toThrow(/size mismatch/);
  });

  it('HTTP error rejected', async () => {
    const storage = fakeStorage();
    const f = await files(C);
    const bad = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch;
    await expect(downloadModel(() => {}, { fetch: bad, storage, files: f })).rejects.toThrow(/download failed/);
  });

  it('removeModel deletes it (and older revisions)', async () => {
    const storage = fakeStorage();
    const f = await files(C);
    await downloadModel(() => {}, { fetch: serve(C), storage, files: f });
    await storage.open('pii-airlock-ner-oldrev');
    await removeModel(storage);
    expect(storage.names()).toEqual([]);
  });

  it('only requests pinned-revision HF URLs, with no credentials/referrer', async () => {
    const storage = fakeStorage();
    const f = await files(C);
    const calls: Array<[string, RequestInit]> = [];
    const spy = (async (u: string, init: RequestInit) => { calls.push([u, init]); return serve(C)(u, init); }) as unknown as typeof fetch;
    await downloadModel(() => {}, { fetch: spy, storage, files: f });
    for (const [u, init] of calls) {
      expect(u).toMatch(/^https:\/\/huggingface\.co\/Xenova\/[^/]+\/resolve\/[0-9a-f]{40}\//);
      expect(init.credentials).toBe('omit');
      expect(init.referrerPolicy).toBe('no-referrer');
    }
  });

  it('customCache serves only known files; put is a no-op', async () => {
    const storage = fakeStorage();
    const real = await files({ 'config.json': 'x' });
    // install under the real manifest key space by writing through downloadModel with real paths
    await downloadModel(() => {}, { fetch: serve({ 'config.json': 'x' }), storage, files: real });
    const cache = makeModelCache(storage);
    expect(await cache.match('https://huggingface.co/m/resolve/main/config.json')).toBeDefined();
    expect(await cache.match('https://evil.example/other.bin')).toBeUndefined();
    await cache.put();
    expect(storage.names()).toEqual([CACHE_NAME]);
  });
});
