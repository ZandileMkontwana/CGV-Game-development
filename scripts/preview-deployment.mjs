import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Serve the production files as a Linux-style static subdirectory deployment.
// No Vite transforms, SPA fallback, root-level assets or case-insensitive lookup.
const buildRoot = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const prefix = '/group-game/';
const port = Number(process.env.DEPLOYMENT_PREVIEW_PORT || 4174);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};

try {
  await stat(resolve(buildRoot, 'index.html'));
} catch {
  console.error('No production build found. Run npm run build first.');
  process.exit(1);
}

const canonicalRoot = await realpath(buildRoot);
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
  }
  try {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === prefix.slice(0, -1)) {
      response.writeHead(302, { Location: prefix }); response.end(); return;
    }
    if (!pathname.startsWith(prefix)) throw new Error('Outside group folder');
    const segments = (pathname.slice(prefix.length) || 'index.html').split('/');
    let file = buildRoot;
    for (const segment of segments) {
      if (!segment || segment === '.' || segment === '..' || segment.includes('\\')) throw new Error('Invalid path');
      // Enforce exact filename case even when running this preview on Windows.
      if (!(await readdir(file)).includes(segment)) throw new Error('File not found');
      file = resolve(file, segment);
    }
    const canonicalFile = await realpath(file);
    if (!canonicalFile.startsWith(canonicalRoot + sep)) throw new Error('Outside build');
    const info = await stat(canonicalFile);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') { response.end(); return; }
    createReadStream(canonicalFile).on('error', () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found: use the group-folder URL and exact filename case.');
  }
});

server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`Production build: http://127.0.0.1:${port}${prefix}`);
  console.log('Only dist/ is served. Root asset paths and incorrect filename case return 404.');
  console.log('Press Ctrl+C to stop this local preview.');
});
