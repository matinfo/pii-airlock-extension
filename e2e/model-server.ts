import { createServer, type Server } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

export const MODEL_PORT = 4799;
/** Loopback stand-in for huggingface.co; records every path requested. */
export function startModelServer(dir: string, hits: string[]): Promise<Server> {
  const srv = createServer((req, res) => {
    const m = /\/resolve\/[0-9a-f]{40}\/(.+)$/.exec(req.url ?? '');
    res.setHeader('access-control-allow-origin', '*');
    if (!m) { res.statusCode = 404; return res.end(); }
    hits.push(req.url!);
    const file = join(dir, normalize(m[1]!).replace(/^(\.\.[/\\])+/, ''));
    try {
      res.setHeader('content-length', statSync(file).size);
      createReadStream(file).pipe(res);
    } catch { res.statusCode = 404; res.end(); }
  });
  return new Promise((r) => srv.listen(MODEL_PORT, '127.0.0.1', () => r(srv)));
}
