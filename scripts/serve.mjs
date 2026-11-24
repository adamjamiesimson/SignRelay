import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.wasm':'application/wasm', '.json':'application/json', '.mp4':'video/mp4',
  '.webp':'image/webp', '.png':'image/png', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf',
  '.onnx':'application/octet-stream', '.task':'application/octet-stream', '.txt':'text/plain; charset=utf-8' };
const dist = fileURLToPath(new URL('../dist/', import.meta.url));

export function serve({ port = 0, fixtures, directory = dist } = {}) {
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let root = resolve(directory);
      let path = decodeURIComponent(url.pathname);
      if (fixtures && path.startsWith('/fixtures/')) {
        root = resolve(fixtures);
        path = path.slice('/fixtures/'.length);
      }
      const file = resolve(root, '.' + sep + (path === '/' ? 'index.html' : path.replace(/^\/+/, '')));
      if (!file.startsWith(root + sep)) return res.writeHead(403).end();
      const { size } = await stat(file);
      const contentType = types[extname(file)];
      if (!contentType) return res.writeHead(404).end();
      const headers = { 'Content-Type': contentType, 'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
      let start = 0;
      let end = size - 1;
      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return res.writeHead(416, { 'Content-Range': 'bytes */' + size }).end();
        start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end;
        if (start > end || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
          return res.writeHead(416, { 'Content-Range': 'bytes */' + size }).end();
        }
        headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
      }
      res.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD' || !size) return res.end();
      const stream = createReadStream(file, { start, end });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => done({ server, url: 'http://127.0.0.1:' + server.address().port }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { url } = await serve({ port: Number(process.argv[2] || 8787) });
  console.log('Local ' + url);
}

